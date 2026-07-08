#!/usr/bin/env tsx
/**
 * Script de migração/backfill para otimizar documentos já existentes
 * no bucket "documentos" do Supabase Storage.
 *
 * Uso:
 *   npm run storage:optimize:dry              # dry-run (padrão)
 *   npm run storage:optimize -- --apply        # executa de verdade
 *   npm run storage:optimize -- --apply --limit 5   # só 5 arquivos
 *
 * Requer variáveis de ambiente:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';

// ─── Config ───────────────────────────────────────────────────────────────────

const BUCKET_NAME = 'documentos';
const ALLOWED_PATHS = ['cadastros/', 'receita/', 'cupom/', 'identidades/'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_MIME_PREFIX = 'image/';
const IMAGE_MAX_WH = 1800;
const JPEG_QUALITY = 78;
/** Só substitui se economizar pelo menos este percentual */
const MIN_SAVINGS_PERCENT = 5;
/** Máximo de downloads/processamentos simultâneos */
const CONCURRENCY = 3;

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DRY_RUN = !args.includes('--apply');
const LIMIT = (() => {
  const idx = args.findIndex((a) => a.startsWith('--limit'));
  if (idx !== -1 && idx + 1 < args.length) {
    return parseInt(args[idx + 1], 10);
  }
  return Infinity;
})();

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ReportEntry = {
  path: string;
  mimeType: string;
  originalSizeBytes: number;
  finalSizeBytes: number;
  savedBytes: number;
  savedPercent: number;
  action: Action;
  error?: string;
};

type Action =
  | 'optimized'
  | 'skipped-small'
  | 'skipped-unsupported'
  | 'skipped-pdf'
  | 'failed'
  | 'backed-up';

/** O Supabase.FileObject retorna `name`, `id`, `metadata` e `created_at` */
type FileObject = {
  name: string;
  id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateStamp = new Date().toISOString().slice(0, 10);

function extFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function isImage(mimeType: string, ext: string): boolean {
  return mimeType.startsWith(IMAGE_MIME_PREFIX) || IMAGE_EXTENSIONS.has(ext);
}

function isPdf(mimeType: string, ext: string): boolean {
  return mimeType === 'application/pdf' || ext === '.pdf';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Supabase init ─────────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env');
  console.error('   Adicione ao .env ou exporte antes de rodar.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ─── Relatório ─────────────────────────────────────────────────────────────────

const reports: ReportEntry[] = [];
let totalOriginal = 0;
let totalFinal = 0;
let totalOptimized = 0;
let totalSkipped = 0;
let totalFailed = 0;
let totalBackedUp = 0;

function addReport(entry: ReportEntry): void {
  reports.push(entry);
  totalOriginal += entry.originalSizeBytes;
  totalFinal += entry.finalSizeBytes;
  if (entry.action === 'optimized') totalOptimized++;
  else if (entry.action === 'failed') totalFailed++;
  else totalSkipped++;
  if (entry.action === 'backed-up') totalBackedUp++;
}

async function saveReport(): Promise<void> {
  const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = path.join('reports', 'storage-optimization');
  const jsonPath = path.join(reportDir, `report-${now}.json`);
  const csvPath = path.join(reportDir, `report-${now}.csv`);

  fs.mkdirSync(reportDir, { recursive: true });

  const summary = {
    totalFiles: reports.length,
    optimized: totalOptimized,
    skipped: totalSkipped,
    failed: totalFailed,
    backedUp: totalBackedUp,
    bytesBefore: totalOriginal,
    bytesAfter: totalFinal,
    bytesSaved: totalOriginal - totalFinal,
    percentSaved:
      totalOriginal > 0
        ? Number(((totalOriginal - totalFinal) / totalOriginal * 100).toFixed(2))
        : 0,
  };

  const data = {
    timestamp: now,
    dryRun: IS_DRY_RUN,
    limit: LIMIT === Infinity ? 'all' : LIMIT,
    summary,
    entries: reports,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  const header = 'path,mimeType,originalSizeBytes,finalSizeBytes,savedBytes,savedPercent,action,error\n';
  const rows = reports.map((r) => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [
      esc(r.path), esc(r.mimeType),
      r.originalSizeBytes, r.finalSizeBytes,
      r.savedBytes, r.savedPercent.toFixed(2),
      esc(r.action), esc(r.error || ''),
    ].join(',');
  });
  fs.writeFileSync(csvPath, header + rows.join('\n'));

  console.log(`\n📄 Relatório salvo:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   CSV : ${csvPath}`);
}

function printSummary(): void {
  const saved = totalOriginal - totalFinal;
  const pct = totalOriginal > 0 ? `${((saved / totalOriginal) * 100).toFixed(2)}%` : '0%';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 RESUMO FINAL${IS_DRY_RUN ? ' (DRY-RUN — nada foi alterado)' : ''}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Total analisados: ${reports.length}`);
  console.log(`   Otimizados......: ${totalOptimized}`);
  console.log(`   Pulados.........: ${totalSkipped}`);
  console.log(`   Com erro........: ${totalFailed}`);
  console.log(`   Backups salvos..: ${totalBackedUp}`);
  console.log(`   Tamanho antes...: ${formatBytes(totalOriginal)}`);
  console.log(`   Tamanho depois..: ${formatBytes(totalFinal)}`);
  console.log(`   Economia........: ${formatBytes(saved)} (${pct})`);
  console.log(`${'='.repeat(60)}`);
}

// ─── Etapa 1: listar arquivos ────────────────────────────────────────────────

async function listBucketFiles(): Promise<FileObject[]> {
  console.log(`🔍 Listando arquivos do bucket "${BUCKET_NAME}"...`);

  const files: FileObject[] = [];

  for (const folder of ALLOWED_PATHS) {
    console.log(`   📁 Listando ${folder}...`);

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(folder, { limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });

    if (error) {
      console.warn(`   ⚠️  Erro ao listar ${folder}: ${error.message}`);
      continue;
    }

    if (!data || data.length === 0) {
      console.log(`      (vazio)`);
      continue;
    }

    for (const item of data) {
      if (item.id) {
        files.push({ ...item, name: folder + item.name } as FileObject);
      }
    }

    console.log(`      ${data.length} arquivos encontrados`);
  }

  console.log(`\n📦 Total de arquivos no bucket (pastas permitidas): ${files.length}`);

  if (LIMIT < Infinity) {
    console.log(`   (limitado a ${LIMIT} arquivos via --limit)`);
    return files.slice(0, LIMIT);
  }

  return files;
}

// ─── Etapa 2: baixar um arquivo ─────────────────────────────────────────────

async function downloadFile(file: FileObject): Promise<{ data: Buffer; mimeType: string } | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(file.name);

  if (error || !data) {
    console.error(`      ❌ Erro ao baixar: ${error?.message || 'sem dados'}`);
    return null;
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const mimeType = (file.metadata?.mimetype as string) || data.type || 'application/octet-stream';

  return { data: buf, mimeType };
}

// ─── Etapa 3: otimizar imagem ───────────────────────────────────────────────

async function optimizeImage(buf: Buffer): Promise<Buffer | null> {
  try {
    const sharpInstance = sharp(buf);
    const metadata = await sharpInstance.metadata();
    if (!metadata.width || !metadata.height) return null;

    const w = metadata.width;
    const h = metadata.height;

    // Só redimensiona se exceder o limite
    const resizeOpts: sharp.ResizeOptions = {
      fit: 'inside',
      withoutEnlargement: true,
    };

    if (w > IMAGE_MAX_WH || h > IMAGE_MAX_WH) {
      resizeOpts.width = IMAGE_MAX_WH;
      resizeOpts.height = IMAGE_MAX_WH;
    }

    const optimized = await sharp(buf)
      .rotate()
      .resize(resizeOpts)
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .withMetadata({ exif: undefined, icc: undefined })
      .toBuffer();

    // Validação pós-processamento: tenta ler metadados do resultado
    const resultMeta = await sharp(optimized).metadata();
    if (!resultMeta.width || !resultMeta.height) return null;

    return optimized;
  } catch (err) {
    console.error(`      ❌ Falha ao otimizar imagem:`, (err as Error).message);
    return null;
  }
}

// ─── Etapa 4: backup ────────────────────────────────────────────────────────

async function saveBackup(originalPath: string, buffer: Buffer): Promise<boolean> {
  const backupRelPath = path.posix.join('_backups', 'storage-optimization', dateStamp, originalPath);
  const fullPath = path.resolve(backupRelPath);

  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buffer);
    return true;
  } catch (err) {
    console.error(`      ❌ Erro ao salvar backup: ${(err as Error).message}`);
    return false;
  }
}

// ─── Etapa 5: upload otimizado ───────────────────────────────────────────────

async function uploadOptimized(
  originalPath: string,
  optimizedBuf: Buffer,
  contentType: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(originalPath, optimizedBuf, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`      ❌ Erro ao fazer upload: ${error.message}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`      ❌ Erro ao fazer upload: ${(err as Error).message}`);
    return false;
  }
}

// ─── Etapa principal: processar um arquivo ───────────────────────────────────

async function processFile(file: FileObject): Promise<void> {
  const startTime = Date.now();
  const ext = extFromName(file.name);
  const mimeFromMeta = (file.metadata?.mimetype as string) || '';
  const indent = '   ';

  console.log(`\n📄 ${file.name}`);
  console.log(`${indent}Tipo: ${mimeFromMeta || 'desconhecido'} | Tamanho: ${formatBytes((file.metadata?.size as number) || 0)}`);

  // Detectar tipo
  const isImageFile = isImage(mimeFromMeta, ext);
  const isPdfFile = isPdf(mimeFromMeta, ext);

  // Tamanho default do metadata (pode ser impreciso)
  let originalSize = (file.metadata?.size as number) || 0;

  if (!isImageFile && !isPdfFile) {
    console.log(`${indent}⏭️  Tipo não suportado`);
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'skipped-unsupported' });
    return;
  }

  if (isPdfFile) {
    console.log(`${indent}⏭️  PDF — otimização server-side não implementada (consulte relatório)`);
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'skipped-pdf' });
    return;
  }

  // ── Processar imagem ──
  if (IS_DRY_RUN) {
    console.log(`${indent}🔍 [DRY-RUN] Seria processado como imagem`);
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: 0, savedBytes: 0, savedPercent: 0, action: 'optimized' });
    return;
  }

  // Modo apply
  console.log(`${indent}⬇️  Baixando...`);
  const downloaded = await downloadFile(file);
  if (!downloaded) {
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', error: 'download failed' });
    return;
  }

  originalSize = downloaded.data.length;
  console.log(`${indent}Tamanho real: ${formatBytes(originalSize)}`);

  console.log(`${indent}🖼️  Otimizando...`);
  const optimized = await optimizeImage(downloaded.data);
  if (!optimized) {
    console.log(`${indent}❌ Falha na otimização — mantendo original`);
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', error: 'optimization returned null' });
    return;
  }

  const savedBytes = originalSize - optimized.length;
  const savedPercent = (savedBytes / originalSize) * 100;

  if (optimized.length >= originalSize || savedPercent < MIN_SAVINGS_PERCENT) {
    console.log(`${indent}⏭️  Economia muito pequena (${savedPercent.toFixed(1)}%) — mantendo original`);
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'skipped-small' });
    return;
  }

  // Backup
  console.log(`${indent}💾 Salvando backup...`);
  const backedUp = await saveBackup(file.name, downloaded.data);
  if (!backedUp) {
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', error: 'backup failed — aborting to avoid data loss' });
    return;
  }

  // Upload
  console.log(`${indent}⬆️  Substituindo original (mesmo path)...`);
  const uploaded = await uploadOptimized(file.name, optimized, 'image/jpeg');

  if (!uploaded) {
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', error: 'upload failed (backup exists)' });
    return;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${indent}✅ Otimizado! ${formatBytes(originalSize)} → ${formatBytes(optimized.length)} (-${savedPercent.toFixed(1)}%) [${elapsed}s]`);

  addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: optimized.length, savedBytes, savedPercent, action: 'optimized' });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log(`🚀 OTIMIZAÇÃO DE STORAGE EXISTENTE`);
  console.log(`   Bucket: ${BUCKET_NAME}`);
  console.log(`   Modo: ${IS_DRY_RUN ? '🔍 DRY-RUN (nada será alterado)' : '⚡ APPLY (irá modificar o storage)'}`);
  console.log(`   Limite: ${LIMIT === Infinity ? 'todos' : LIMIT}`);
  console.log(`   Data: ${dateStamp}`);
  console.log('='.repeat(60));

  if (!IS_DRY_RUN) {
    console.log(`\n⚠️  ATENÇÃO: Modo APPLY ativo! Este script irá:`);
    console.log(`   1. Baixar arquivos do storage`);
    console.log(`   2. Otimizar imagens (sharp)`);
    console.log(`   3. Salvar backup dos originais em _backups/storage-optimization/${dateStamp}/`);
    console.log(`   4. Substituir versões otimizadas no storage (mesmo path, upsert)`);
    console.log(``);
    console.log(`   Pressione Ctrl+C para cancelar nos próximos 5s...`);
    await sleep(5000);
    console.log(`   ✅ Prosseguindo...`);
  }

  const files = await listBucketFiles();

  if (files.length === 0) {
    console.log(`Nenhum arquivo encontrado. Nada a fazer.`);
    return;
  }

  console.log(`\n🔄 Processando arquivos (concorrência: ${CONCURRENCY})...`);

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((f) => processFile(f)));
  }

  await saveReport();
  printSummary();

  if (!IS_DRY_RUN) {
    console.log(`\n🔔 Lembre-se de verificar manualmente alguns arquivos no Supabase.`);
    console.log(`   Backups em: _backups/storage-optimization/${dateStamp}/`);
    console.log(`   Para restaurar, faça upload manualmente.`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});