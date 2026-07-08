#!/usr/bin/env tsx
/**
 * Script de backfill/otimizacao para documentos existentes no bucket "documentos"
 * do Supabase Storage da Farmacia Popular.
 *
 * Uso:
 *   npm run storage:optimize:dry                                     # dry-run completo
 *   npm run storage:optimize -- --dry-run --include-images --include-pdfs
 *   npm run storage:optimize -- --apply --include-images --limit 5
 *   npm run storage:optimize -- --apply --include-pdfs --limit 5
 *   npm run storage:optimize -- --apply --include-images --include-pdfs
 *   npm run storage:optimize -- --list-remote-backups
 *   npm run storage:restore -- --manifest <path> --limit 1
 *
 * Variaveis de ambiente:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { jsPDF } from 'jspdf';
import { createCanvas } from 'canvas';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

// ─── Config ───────────────────────────────────────────────────────────────────────

const BUCKET = 'documentos';
const ALLOWED = ['cadastros', 'receita', 'cupom', 'identidades'];
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMG_MAX = 1800;
const PDF_MAX = 1800;
const JPG_Q = 78;
const PDF_JPG_Q = 0.76;
const MIN_SAVE = 5;
const CONCUR = 3;
const BACKUP_DIR = 'backups/storage-optimization';

// ─── CLI ─────────────────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2);
const IS_DRY = !ARGV.includes('--apply') || ARGV.includes('--dry-run');
const INC_IMG = ARGV.includes('--include-images');
const INC_PDF = ARGV.includes('--include-pdfs');
const BACKUP_RMT = ARGV.includes('--backup-remote');
const LIST_RMT = ARGV.includes('--list-remote-backups');
const LIMIT = (() => {
  const i = ARGV.findIndex((a) => a.startsWith('--limit'));
  if (i !== -1 && i + 1 < ARGV.length) return parseInt(ARGV[i + 1], 10);
  if (i !== -1 && ARGV[i].includes('=')) return parseInt(ARGV[i].split('=')[1], 10);
  return Infinity;
})();
const FOLDERS = (() => {
  const i = ARGV.findIndex((a) => a.startsWith('--folders'));
  if (i !== -1 && i + 1 < ARGV.length) return ARGV[i + 1].split(',').map((s) => s.trim());
  return ALLOWED;
})();

const DATE_TAG = new Date().toISOString().slice(0, 10);

// ─── Supabase ────────────────────────────────────────────────────────────────────────

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatorios no .env');
  process.exit(1);
}
const sb = createClient(SB_URL, SB_KEY);

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function extOf(n: string) { const d = n.lastIndexOf('.'); return d > 0 ? n.slice(d).toLowerCase() : ''; }
function isImg(m: string, e: string) { return m.startsWith('image/') || IMG_EXTS.has(e); }
function isPdf(m: string, e: string) { return m === 'application/pdf' || e === '.pdf'; }
function fmt(n: number) { if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`; if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`; if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`; return `${n} B`; }
function sha256(b: Buffer) { return crypto.createHash('sha256').update(b).digest('hex'); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Report ─────────────────────────────────────────────────────────────────────

const rows: any[] = [];
const manis: any[] = [];
let totB4 = 0, totAf = 0, okN = 0, skipN = 0, failN = 0, backN = 0;
let imgB4 = 0, imgAf = 0, imgOk = 0;
let pdfB4 = 0, pdfAf = 0, pdfOk = 0;

function addRow(r: any) {
  rows.push(r);
  totB4 += r.originalSize; totAf += r.finalSize;
  if (r.fileType === 'image') { imgB4 += r.originalSize; imgAf += r.finalSize; if (r.action === 'optimized') imgOk++; }
  if (r.fileType === 'pdf') { pdfB4 += r.originalSize; pdfAf += r.finalSize; if (r.action === 'optimized') pdfOk++; }
  if (r.action === 'optimized') okN++;
  else if (r.action.startsWith('skip')) skipN++;
  else failN++;
  if (r.backupType !== 'none') backN++;
}

// ─── List ──────────────────────────────────────────────────────────────────────

async function listAll(): Promise<any[]> {
  console.log(`Listando bucket "${BUCKET}"...`);
  const out: any[] = [];
  for (const f of FOLDERS) {
    console.log(`  ${f}/...`);
    let off = 0, total = 0;
    for (let p = 0; p < 200; p++) {
      const { data, error } = await sb.storage.from(BUCKET).list(f + '/', { limit: 100, offset: off, sortBy: { column: 'name', order: 'asc' } });
      if (error) { console.warn(`  erro: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      for (const item of data) { if (item.id) out.push({ ...item, name: f + '/' + item.name }); }
      total += data.length;
      if (data.length < 100) break;
      off += 100;
    }
    console.log(`    ${total} arquivos`);
  }
  console.log(`\nTotal: ${out.length}`);
  return out;
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function dl(name: string): Promise<{ buf: Buffer; mime: string } | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(name);
  if (error || !data) { console.error(`    download error: ${error?.message}`); return null; }
  return { buf: Buffer.from(await data.arrayBuffer()), mime: data.type || 'application/octet-stream' };
}

// ─── Optimize image ────────────────────────────────────────────────────────────

async function optImg(buf: Buffer): Promise<Buffer | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const ro: any = { fit: 'inside', withoutEnlargement: true };
    if ((meta.width || 0) > IMG_MAX || (meta.height || 0) > IMG_MAX) { ro.width = IMG_MAX; ro.height = IMG_MAX; }
    const out = await sharp(buf).rotate().resize(ro).jpeg({ quality: JPG_Q, mozjpeg: true }).withMetadata({ exif: undefined, icc: undefined }).toBuffer();
    const vm = await sharp(out).metadata();
    if (!vm.width || !vm.height) return null;
    return out;
  } catch { return null; }
}

// ─── Optimize PDF ──────────────────────────────────────────────────────────────

async function optPdf(buf: Buffer): Promise<{ buf: Buffer; pages: number } | null> {
  try {
    const pdf = await getDocument({ data: buf }).promise;
    const n = pdf.numPages;
    if (n > 100) { pdf.destroy(); return null; }
    const doc = new jsPDF({ unit: 'px', format: [PDF_MAX, PDF_MAX * 1.4] });
    let first = true;
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const s = Math.min(PDF_MAX / vp.width, PDF_MAX / vp.height);
      const svp = page.getViewport({ scale: s });
      const cvs = createCanvas(Math.round(svp.width), Math.round(svp.height));
      const ctx = cvs.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: svp }).promise;
      page.cleanup();
      const dataUrl = cvs.toDataURL('image/jpeg', PDF_JPG_Q);
      if (first) { doc.addImage(dataUrl, 'JPEG', 0, 0, svp.width, svp.height, undefined, 'FAST'); first = false; }
      else { doc.addPage([svp.width, svp.height]); doc.addImage(dataUrl, 'JPEG', 0, 0, svp.width, svp.height, undefined, 'FAST'); }
    }
    pdf.destroy();
    const blob = doc.output('arraybuffer');
    const result = Buffer.from(blob);
    if (!result || result.length < 10) return null;
    if (result.slice(0, 5).toString() !== '%PDF-') return null;
    // Validate resulting PDF
    const check = await getDocument({ data: result }).promise;
    check.destroy();
    return { buf: result, pages: n };
  } catch { return null; }
}

// ─── Backup local ────────────────────────────────────────────────────────────────

function saveLocal(origPath: string, buf: Buffer): string | null {
  const rel = path.posix.join(BACKUP_DIR, DATE_TAG, origPath);
  const full = path.resolve(rel);
  try { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, buf); return rel; } catch { return null; }
}

// ─── Backup remoto ──────────────────────────────────────────────────────────────

async function saveRemote(origPath: string, buf: Buffer): Promise<string | null> {
  const p = path.posix.join('_backups', 'storage-optimization', DATE_TAG, origPath);
  const { error } = await sb.storage.from(BUCKET).upload(p, buf, { contentType: 'application/octet-stream', upsert: true });
  return error ? null : p;
}

// ─── Upload ────────────────────────────────────────────────────────────────────

async function doUpload(name: string, buf: Buffer, ct: string): Promise<boolean> {
  const { error } = await sb.storage.from(BUCKET).upload(name, buf, { contentType: ct, upsert: true });
  return !error;
}

// ─── Validate post-upload ──────────────────────────────────────────────────

async function valUp(name: string, ct: string): Promise<boolean> {
  const d = await dl(name);
  if (!d || d.buf.length === 0) return false;
  if (ct.startsWith('image/')) { const m = await sharp(d.buf).metadata().catch(() => null); if (!m || !m.width) return false; }
  if (ct === 'application/pdf') {
    if (d.buf.slice(0, 5).toString() !== '%PDF-') return false;
    const pdf = await getDocument({ data: d.buf }).promise.catch(() => null);
    if (!pdf) return false;
    pdf.destroy();
  }
  return true;
}

// ─── Process file ──────────────────────────────────────────────────────────────

async function processFile(f: any) {
  const start = Date.now();
  const e = extOf(f.name);
  const mime = (f.metadata?.mimetype as string) || '';
  const folder = f.name.split('/')[0];
  console.log(`\n${f.name}`);
  console.log(`  Tipo: ${mime || '?'} | Tam: ${fmt((f.metadata?.size as number) || 0)}`);

  const image = isImg(mime, e);
  const pdf = isPdf(mime, e);
  const fileType = image ? 'image' : pdf ? 'pdf' : 'unsupported';

  if (fileType === 'unsupported') {
    console.log('  Pulado — tipo nao suportado');
    addRow({ path: f.name, folder, fileType, originalSize: (f.metadata?.size as number) || 0, finalSize: (f.metadata?.size as number) || 0, saved: 0, savedPct: 0, action: 'skipped-unsupported', backupType: 'none' });
    return;
  }

  // Dry-run
  if (IS_DRY) {
    console.log('  [DRY-RUN] Seria processado');
    addRow({ path: f.name, folder, fileType, originalSize: (f.metadata?.size as number) || 0, finalSize: 0, saved: 0, savedPct: 0, action: 'optimized', backupType: 'none' });
    return;
  }

  // Apply — check flags
  if (image && !INC_IMG) { console.log('  Pulado — --include-images nao ativado'); addRow({ path: f.name, folder, fileType, originalSize: (f.metadata?.size as number) || 0, finalSize: (f.metadata?.size as number) || 0, saved: 0, savedPct: 0, action: 'skipped-unsupported', backupType: 'none' }); return; }
  if (pdf && !INC_PDF) { console.log('  Pulado — --include-pdfs nao ativado'); addRow({ path: f.name, folder, fileType, originalSize: (f.metadata?.size as number) || 0, finalSize: (f.metadata?.size as number) || 0, saved: 0, savedPct: 0, action: 'skipped-unsupported', backupType: 'none' }); return; }

  // Download
  console.log('  Baixando...');
  const down = await dl(f.name);
  if (!down) { addRow({ path: f.name, folder, fileType, originalSize: (f.metadata?.size as number) || 0, finalSize: (f.metadata?.size as number) || 0, saved: 0, savedPct: 0, action: 'failed-upload', backupType: 'none', error: 'download-failed' }); return; }

  let size = down.buf.length;
  let result: Buffer | null = null;
  let pages: number | undefined;
  let finalCT = down.mime;

  if (image) {
    console.log(`  Otimizando imagem (${fmt(size)})...`);
    result = await optImg(down.buf);
    finalCT = 'image/jpeg';
  } else {
    console.log(`  Otimizando PDF (${fmt(size)})...`);
    const r = await optPdf(down.buf);
    if (r) { result = r.buf; pages = r.pages; }
  }

  if (!result) {
    console.log('  Falha na otimizacao — mantendo');
    addRow({ path: f.name, folder, fileType, originalSize: size, finalSize: size, saved: 0, savedPct: 0, action: pdf ? 'skipped-pdf-error' : 'failed-validation', backupType: 'none', error: 'optimization-null' });
    return;
  }

  const saved = size - result.length;
  const pct = (saved / size) * 100;

  if (result.length >= size || pct < MIN_SAVE) {
    console.log(`  Economia pequena (${pct.toFixed(1)}%) — mantendo`);
    addRow({ path: f.name, folder, fileType, originalSize: size, finalSize: size, saved: 0, savedPct: 0, action: 'skipped-small', backupType: 'none', pageCount: pages });
    return;
  }

  // Backup local
  console.log('  Backup local...');
  const lp = saveLocal(f.name, down.buf);
  if (!lp) {
    addRow({ path: f.name, folder, fileType, originalSize: size, finalSize: size, saved: 0, savedPct: 0, action: 'failed-backup', backupType: 'none', error: 'local-backup-failed' });
    return;
  }

  let bt = 'local' as const;
  let rp: string | undefined;
  if (BACKUP_RMT) {
    console.log('  Backup remoto...');
    const r = await saveRemote(f.name, down.buf);
    if (r) { bt = 'both'; rp = r; }
  }

  // Upload
  console.log(`  Upload (${fmt(result.length)})...`);
  const up = await doUpload(f.name, result, finalCT);
  if (!up) {
    addRow({ path: f.name, folder, fileType, originalSize: size, finalSize: size, saved: 0, savedPct: 0, action: 'failed-upload', backupType: bt, localBackup: lp, remoteBackup: rp, error: 'upload-failed' });
    return;
  }

  // Validate
  console.log('  Validando...');
  const valid = await valUp(f.name, finalCT);
  if (!valid) {
    console.log('  ERRO: validacao pos-upload falhou! Backup mantido.');
    addRow({ path: f.name, folder, fileType, originalSize: size, finalSize: result.length, saved, savedPct: pct, action: 'failed-validation', backupType: bt, localBackup: lp, remoteBackup: rp, error: 'post-upload-validation-failed' });
    return;
  }

  const el = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  OK! ${fmt(size)} -> ${fmt(result.length)} (-${pct.toFixed(1)}%)${pages ? ` [${pages}p]` : ''} [${el}s]`);

  addRow({ path: f.name, folder, fileType, originalSize: size, finalSize: result.length, saved, savedPct: pct, action: 'optimized', backupType: bt, localBackup: lp, remoteBackup: rp, pageCount: pages });

  manis.push({
    originalPath: f.name,
    localBackupPath: lp,
    originalSize: size,
    finalSize: result.length,
    contentTypeBefore: down.mime,
    contentTypeAfter: finalCT,
    sha256Original: sha256(down.buf),
    sha256Optimized: sha256(result),
    optimizedAt: new Date().toISOString(),
    action: 'optimized',
  });
}

// ─── Save reports ──────────────────────────────────────────────────────────────

async function saveReports() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join('reports', 'storage-optimization');
  fs.mkdirSync(dir, { recursive: true });

  const totalSav = totB4 - totAf;
  const sum = {
    totalFiles: rows.length,
    optimized: okN, skipped: skipN, failed: failN, backups: backN,
    bytesBefore: totB4, bytesAfter: totAf, bytesSaved: totalSav,
    pctSaved: totB4 ? Number(((totalSav / totB4) * 100).toFixed(2)) : 0,
    images: { before: imgB4, after: imgAf, optimized: imgOk },
    pdfs: { before: pdfB4, after: pdfAf, optimized: pdfOk },
  };

  const pack = { timestamp: ts, dryRun: IS_DRY, limit: LIMIT === Infinity ? 'all' : LIMIT, folders: FOLDERS, backupRemote: BACKUP_RMT, summary: sum, entries: rows };
  const jp = path.join(dir, `report-${ts}.json`);
  fs.writeFileSync(jp, JSON.stringify(pack, null, 2));

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const hdr = 'path,folder,fileType,originalSize,finalSize,saved,savedPct,action,backupType,localBackup,remoteBackup,pageCount,error\n';
  const csvRows = rows.map((r: any) => [esc(r.path), esc(r.folder), r.fileType, r.originalSize, r.finalSize, r.saved, r.savedPct.toFixed(2), esc(r.action), esc(r.backupType), esc(r.localBackup || ''), esc(r.remoteBackup || ''), r.pageCount ?? '', esc(r.error || '')].join(','));
  const cp = path.join(dir, `report-${ts}.csv`);
  fs.writeFileSync(cp, hdr + csvRows.join('\n'));

  const mp = path.join(dir, `manifest-${ts}.json`);
  fs.writeFileSync(mp, JSON.stringify({ timestamp: ts, entries: manis }, null, 2));

  console.log(`\nRelatorios:`);
  console.log(`  JSON: ${jp}`);
  console.log(`  CSV:  ${cp}`);
  console.log(`  Manifesto: ${mp}`);
}

// ─── List remote backups ──────────────────────────────────────────────────────

async function listRemote() {
  console.log('Listando _backups/storage-optimization/...');
  let total = 0, files = 0;
  async function scan(pre: string) {
    let off = 0;
    while (true) {
      const { data, error } = await sb.storage.from(BUCKET).list(pre, { limit: 100, offset: off, sortBy: { column: 'name', order: 'asc' } });
      if (error || !data || data.length === 0) break;
      for (const item of data) {
        const fn = pre + item.name;
        if (item.id && item.metadata) { total += (item.metadata?.size as number) || 0; files++; console.log(`  ${fn} (${fmt((item.metadata?.size as number) || 0)})`); }
        else await scan(fn + '/');
      }
      if (data.length < 100) break;
      off += 100;
    }
  }
  await scan('_backups/storage-optimization/');
  if (files === 0) console.log('  Nenhum backup remoto encontrado.');
  else console.log(`\nTotal: ${files} arquivos, ${fmt(total)}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function summary() {
  const sv = totB4 - totAf;
  const p = totB4 ? `${((sv / totB4) * 100).toFixed(2)}%` : '0%';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESUMO${IS_DRY ? ' (DRY-RUN)' : ''}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Analisados: ${rows.length}`);
  console.log(`  Otimizados.: ${okN} (img: ${imgOk}, pdf: ${pdfOk})`);
  console.log(`  Pulados....: ${skipN}`);
  console.log(`  Erros......: ${failN}`);
  console.log(`  Backups....: ${backN}`);
  console.log(`  Antes......: ${fmt(totB4)}`);
  console.log(`  Depois.....: ${fmt(totAf)}`);
  console.log(`  Economia...: ${fmt(sv)} (${p})`);
  console.log(`  Imagens....: ${fmt(imgB4)} -> ${fmt(imgAf)}`);
  console.log(`  PDFs.......: ${fmt(pdfB4)} -> ${fmt(pdfAf)}`);
  console.log(`${'='.repeat(60)}`);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  if (LIST_RMT) { await listRemote(); return; }

  console.log(`=${'='.repeat(58)}=`);
  console.log(`OTIMIZACAO DE STORAGE — FARMACIA POPULAR`);
  console.log(`  Bucket: ${BUCKET}`);
  console.log(`  Pastas: ${FOLDERS.join(', ')}`);
  console.log(`  Modo: ${IS_DRY ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`  Incluir imagens: ${INC_IMG ? 'sim' : IS_DRY ? 'auto (dry)' : 'nao'}`);
  console.log(`  Incluir PDFs....: ${INC_PDF ? 'sim' : IS_DRY ? 'auto (dry)' : 'nao'}`);
  console.log(`  Backup remoto...: ${BACKUP_RMT ? 'sim' : 'nao'}`);
  console.log(`  Limite.........: ${LIMIT === Infinity ? 'todos' : LIMIT}`);
  console.log(`  Data: ${DATE_TAG}`);
  console.log(`=${'='.repeat(58)}=`);

  if (!IS_DRY) {
    if (!INC_IMG && !INC_PDF) { console.error('\nErro: No apply sem --include-images e/ou --include-pdfs'); process.exit(1); }
    console.log(`\nATENCAO: Modo APPLY! Backup local: ${BACKUP_DIR}/${DATE_TAG}/`);
    console.log('Ctrl+C para cancelar (5s)...');
    await sleep(5000);
  }

  const files = await listAll();
  if (files.length === 0) { console.log('Nada a fazer.'); return; }

  const toProc = LIMIT < Infinity ? files.slice(0, LIMIT) : files;
  console.log(`\nProcessando ${toProc.length} arquivos (conc: ${CONCUR})...`);

  for (let i = 0; i < toProc.length; i += CONCUR) {
    await Promise.all(toProc.slice(i, i + CONCUR).map((f: any) => processFile(f)));
  }

  await saveReports();
  summary();
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });