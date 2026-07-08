#!/usr/bin/env tsx
/**
 * Backfill de otimização para documentos existentes no bucket "documentos".
 *
 * Uso:
 *   npm run storage:optimize:dry                         # dry-run (padrão)
 *   npm run storage:optimize -- --apply                   # executa com backup local
 *   npm run storage:optimize -- --apply --limit 5         # teste com 5 arquivos
 *   npm run storage:optimize -- --apply --backup-remote   # backup local + remoto (consome storage)
 *   npm run storage:optimize -- --list-remote-backups     # lista backups remotos existentes
 *
 * Requer variáveis de ambiente:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

// ─── Config ───────────────────────────────────────────────────────────────────

const BUCKET_NAME = 'documentos';
const ALLOWED_PATHS = ['cadastros/', 'receita/', 'cupom/', 'identidades/'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_MIME_PREFIX = 'image/';
const IMAGE_MAX_WH = 1800;
const JPEG_QUALITY = 78;
const MIN_SAVINGS_PERCENT = 5;
const CONCURRENCY = 3;
const BACKUP_ROOT = 'backups';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_DRY_RUN = !args.includes('--apply');
const LIMIT = (() => {
  const idx = args.findIndex((a) => a.startsWith('--limit'));
  if (idx !== -1 && idx + 1 < args.length) {
    return parseInt(args[idx + 1], 10);
  }
  if (idx !== -1 && args[idx].includes('=')) {
    return parseInt(args[idx].split('=')[1], 10);
  }
  return Infinity;
})();
const BACKUP_REMOTE = args.includes('--backup-remote');
const LIST_REMOTE_BACKUPS = args.includes('--list-remote-backups');

// ─── Tipos ────────────────────────────────────────────────────────────────────

type BackupType = 'local' | 'remote' | 'both' | 'none';

type ReportEntry = {
  path: string;
  mimeType: string;
  originalSizeBytes: number;
  finalSizeBytes: number;
  savedBytes: number;
  savedPercent: number;
  action: Action;
  backupType: BackupType;
  localBackupPath?: string;
  remoteBackupPath?: string;
  error?: string;
};

type Action =
  | 'optimized'
  | 'skipped-small'
  | 'skipped-unsupported'
  | 'skipped-pdf'
  | 'failed'
  | 'backed-up';

/** Tipo compatível com FileObject do Supabase list() */
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
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios no .env');
  console.error('Adicione ao .env ou exporte antes de rodar.');
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
let totalPdfBytes = 0;

function addReport(entry: ReportEntry): void {
  reports.push(entry);
  totalOriginal += entry.originalSizeBytes;
  totalFinal += entry.finalSizeBytes;
  if (entry.action === 'optimized') totalOptimized++;
  else if (entry.action === 'failed') totalFailed++;
  else totalSkipped++;
  if (entry.backupType !== 'none') totalBackedUp++;
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
    pdfBytes: totalPdfBytes,
  };

  const data = {
    timestamp: now,
    dryRun: IS_DRY_RUN,
    backupRemote: BACKUP_REMOTE,
    limit: LIMIT === Infinity ? 'all' : LIMIT,
    summary,
    entries: reports,
  };

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = 'path,mimeType,originalSizeBytes,finalSizeBytes,savedBytes,savedPercent,action,backupType,localBackupPath,remoteBackupPath,error\n';
  const rows = reports.map((r) => [
    esc(r.path), esc(r.mimeType),
    r.originalSizeBytes, r.finalSizeBytes,
    r.savedBytes, r.savedPercent.toFixed(2),
    esc(r.action), esc(r.backupType),
    esc(r.localBackupPath || ''), esc(r.remoteBackupPath || ''),
    esc(r.error || ''),
  ].join(','));
  fs.writeFileSync(csvPath, header + rows.join('\n'));

  console.log(`\nRelatorio salvo:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);
}

function printSummary(): void {
  const saved = totalOriginal - totalFinal;
  const pct = totalOriginal > 0 ? `${((saved / totalOriginal) * 100).toFixed(2)}%` : '0%';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESUMO FINAL${IS_DRY_RUN ? ' (DRY-RUN — nada alterado)' : ''}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Total analisados: ${reports.length}`);
  console.log(`  Otimizados......: ${totalOptimized}`);
  console.log(`  Pulados.........: ${totalSkipped}`);
  console.log(`  Com erro........: ${totalFailed}`);
  console.log(`  Backups salvos..: ${totalBackedUp}`);
  console.log(`  Tamanho antes...: ${formatBytes(totalOriginal)}`);
  console.log(`  Tamanho depois..: ${formatBytes(totalFinal)}`);
  console.log(`  Economia........: ${formatBytes(saved)} (${pct})`);
  if (totalPdfBytes > 0) {
    console.log(`  PDFs (pulados)..: ${formatBytes(totalPdfBytes)} — requer etapa separada`);
  }
  console.log(`${'='.repeat(60)}`);
}

// ─── LISTAGEM ──────────────────────────────────────────────────────────────────

async function listBucketFiles(): Promise<FileObject[]> {
  console.log(`Listando bucket "${BUCKET_NAME}"...`);

  const files: FileObject[] = [];

  for (const folder of ALLOWED_PATHS) {
    console.log(`  ${folder}...`);
    let offset = 0;
    let totalInFolder = 0;

    for (let page = 0; page < 200; page++) {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .list(folder, { limit: 200, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) {
        console.warn(`  Erro ao listar ${folder} (offset ${offset}): ${error.message}`);
        break;
      }

      if (!data || data.length === 0) break;

      for (const item of data) {
        if (item.id) {
          files.push({ ...item, name: folder + item.name } as FileObject);
        }
      }

      totalInFolder += data.length;

      // Se veio menos que o limite, é a última página
      if (data.length < 100) break;
      offset += 100;
    }

    console.log(`    ${totalInFolder} arquivos`);
  }

  console.log(`\nTotal (pastas permitidas): ${files.length}`);

  if (LIMIT < Infinity) {
    console.log(`  (limitado a ${LIMIT} via --limit)`);
    return files.slice(0, LIMIT);
  }

  return files;
}

// ─── LISTAR BACKUPS REMOTOS ────────────────────────────────────────────────────

async function listRemoteBackups(): Promise<void> {
  console.log(`Listando backups remotos em _backups/storage-optimization/...`);

  let totalBytes = 0;
  let totalFiles = 0;

  async function scanFolder(prefix: string): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error || !data || data.length === 0) break;

      for (const item of data) {
        const fullName = prefix + item.name;
        if (item.id && item.metadata) {
          const size = (item.metadata?.size as number) || 0;
          totalBytes += size;
          totalFiles++;
          console.log(`  ${fullName} (${formatBytes(size)})`);
        } else {
          // Subpasta
          await scanFolder(fullName + '/');
        }
      }

      if (data.length < 100) break;
      offset += 100;
    }
  }

  await scanFolder('_backups/storage-optimization/');

  if (totalFiles === 0) {
    console.log('  Nenhum backup remoto encontrado.');
    return;
  }

  console.log(`\nTotal: ${totalFiles} arquivos, ${formatBytes(totalBytes)}`);
  console.log('  NOTA: Backups remotos dentro do mesmo bucket contam no uso de storage.');
  console.log('  Para reduzir storage de verdade, remova backups remotos apos confirmar que os otimizados estao ok.');
}

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────

async function downloadFile(file: FileObject): Promise<{ data: Buffer; mimeType: string } | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(file.name);

  if (error || !data) {
    console.error(`    Erro ao baixar: ${error?.message || 'sem dados'}`);
    return null;
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const mimeType = (file.metadata?.mimetype as string) || data.type || 'application/octet-stream';

  return { data: buf, mimeType };
}

// ─── OTIMIZAR IMAGEM ──────────────────────────────────────────────────────────

async function optimizeImage(buf: Buffer): Promise<Buffer | null> {
  try {
    const metadata = await sharp(buf).metadata();
    if (!metadata.width || !metadata.height) return null;

    const resizeOpts: sharp.ResizeOptions = {
      fit: 'inside',
      withoutEnlargement: true,
    };

    if ((metadata.width || 0) > IMAGE_MAX_WH || (metadata.height || 0) > IMAGE_MAX_WH) {
      resizeOpts.width = IMAGE_MAX_WH;
      resizeOpts.height = IMAGE_MAX_WH;
    }

    const optimized = await sharp(buf)
      .rotate()
      .resize(resizeOpts)
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .withMetadata({ exif: undefined, icc: undefined })
      .toBuffer();

    // Validação
    const resultMeta = await sharp(optimized).metadata();
    if (!resultMeta.width || !resultMeta.height) return null;

    return optimized;
  } catch (err) {
    console.error(`    Falha ao otimizar:`, (err as Error).message);
    return null;
  }
}

// ─── BACKUP LOCAL ────────────────────────────────────────────────────────────

function saveLocalBackup(originalPath: string, buffer: Buffer): boolean {
  const relPath = path.posix.join(BACKUP_ROOT, 'storage-optimization', dateStamp, originalPath);
  const fullPath = path.resolve(relPath);

  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buffer);
    return true;
  } catch (err) {
    console.error(`    Erro backup local: ${(err as Error).message}`);
    return false;
  }
}

function getLocalBackupPath(originalPath: string): string {
  return path.posix.join(BACKUP_ROOT, 'storage-optimization', dateStamp, originalPath);
}

// ─── BACKUP REMOTO (opcional) ───────────────────────────────────────────────

async function saveRemoteBackup(originalPath: string, buffer: Buffer): Promise<boolean> {
  const remotePath = path.posix.join('_backups', 'storage-optimization', dateStamp, originalPath);
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(remotePath, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    console.error(`    Erro backup remoto: ${error.message}`);
    return false;
  }

  return true;
}

function getRemoteBackupPath(originalPath: string): string {
  return path.posix.join('_backups', 'storage-optimization', dateStamp, originalPath);
}

// ─── UPLOAD OTIMIZADO ────────────────────────────────────────────────────────

async function uploadOptimized(originalPath: string, optimizedBuf: Buffer, contentType: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(originalPath, optimizedBuf, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`    Erro ao fazer upload: ${error.message}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`    Erro ao fazer upload: ${(err as Error).message}`);
    return false;
  }
}

// ─── PROCESSAR ARQUIVO ───────────────────────────────────────────────────────

async function processFile(file: FileObject): Promise<void> {
  const startTime = Date.now();
  const ext = extFromName(file.name);
  const mimeFromMeta = (file.metadata?.mimetype as string) || '';
  const indent = '  ';

  console.log(`\n${file.name}`);
  console.log(`${indent}Tipo: ${mimeFromMeta || 'desconhecido'} | Tam: ${formatBytes((file.metadata?.size as number) || 0)}`);

  const isImageFile = isImage(mimeFromMeta, ext);
  const isPdfFile = isPdf(mimeFromMeta, ext);
  let originalSize = (file.metadata?.size as number) || 0;

  if (!isImageFile && !isPdfFile) {
    console.log(`${indent}Pulado — tipo nao suportado`);
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'skipped-unsupported', backupType: 'none' });
    return;
  }

  if (isPdfFile) {
    totalPdfBytes += originalSize;
    console.log(`${indent}Pulado — PDF (sem otimizacao server-side)`);
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'skipped-pdf', backupType: 'none' });
    return;
  }

  // Imagem
  if (IS_DRY_RUN) {
    console.log(`${indent}[DRY-RUN] Seria processado`);
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: 0, savedBytes: 0, savedPercent: 0, action: 'optimized', backupType: 'none' });
    return;
  }

  console.log(`${indent}Baixando...`);
  const downloaded = await downloadFile(file);
  if (!downloaded) {
    addReport({ path: file.name, mimeType: mimeFromMeta, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', backupType: 'none', error: 'download failed' });
    return;
  }

  originalSize = downloaded.data.length;

  // Determinar contentType para o upload otimizado
  const finalContentType = 'image/jpeg';

  console.log(`${indent}Otimizando (${formatBytes(originalSize)})...`);
  const optimized = await optimizeImage(downloaded.data);
  if (!optimized) {
    console.log(`${indent}Falha na otimizacao — mantendo original`);
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', backupType: 'none', error: 'optimization returned null' });
    return;
  }

  const savedBytes = originalSize - optimized.length;
  const savedPercent = (savedBytes / originalSize) * 100;

  if (optimized.length >= originalSize || savedPercent < MIN_SAVINGS_PERCENT) {
    console.log(`${indent}Economia pequena (${savedPercent.toFixed(1)}%) — mantendo original`);
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'skipped-small', backupType: 'none' });
    return;
  }

  // Backup local (sempre)
  console.log(`${indent}Backup local...`);
  const localPath = getLocalBackupPath(file.name);
  const backedUpLocal = saveLocalBackup(file.name, downloaded.data);
  if (!backedUpLocal) {
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', backupType: 'none', error: 'local backup failed — aborting' });
    return;
  }

  let backupType: BackupType = 'local';
  let remotePath: string | undefined;

  // Backup remoto (opcional)
  if (BACKUP_REMOTE) {
    console.log(`${indent}Backup remoto...`);
    const ok = await saveRemoteBackup(file.name, downloaded.data);
    if (ok) {
      backupType = 'both';
      remotePath = getRemoteBackupPath(file.name);
    } else {
      console.log(`${indent}  (backup remoto falhou, local mantido)`);
    }
  }

  // Upload otimizado
  console.log(`${indent}Substituindo (${formatBytes(originalSize)} -> ${formatBytes(optimized.length)})...`);
  const uploaded = await uploadOptimized(file.name, optimized, finalContentType);

  if (!uploaded) {
    addReport({ path: file.name, mimeType: downloaded.mimeType, originalSizeBytes: originalSize, finalSizeBytes: originalSize, savedBytes: 0, savedPercent: 0, action: 'failed', backupType, localBackupPath: localPath, remoteBackupPath: remotePath, error: 'upload failed (backup exists)' });
    return;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`${indent}OK! ${formatBytes(originalSize)} -> ${formatBytes(optimized.length)} (-${savedPercent.toFixed(1)}%) [${elapsed}s]`);

  addReport({ path: file.name, mimeType: finalContentType, originalSizeBytes: originalSize, finalSizeBytes: optimized.length, savedBytes, savedPercent, action: 'optimized', backupType, localBackupPath: localPath, remoteBackupPath: remotePath });
}

// ─── MAIN ───────────────────────────────────────────────────────────────────────

async function main() {
  // Modo listar backups remotos
  if (LIST_REMOTE_BACKUPS) {
    await listRemoteBackups();
    return;
  }

  console.log('='.repeat(60));
  console.log('OTIMIZACAO DE STORAGE EXISTENTE');
  console.log(`  Bucket: ${BUCKET_NAME}`);
  console.log(`  Modo: ${IS_DRY_RUN ? 'DRY-RUN (nada alterado)' : 'APPLY'}`);
  console.log(`  Backup remoto: ${BACKUP_REMOTE ? 'sim' : 'nao (apenas local)'}`);
  console.log(`  Limite: ${LIMIT === Infinity ? 'todos' : LIMIT}`);
  console.log(`  Data: ${dateStamp}`);
  console.log('='.repeat(60));

  if (!IS_DRY_RUN) {
    console.log(`\nATENCAO: Modo APPLY ativo!`);
    console.log(`  1. Baixar arquivos`);
    console.log(`  2. Otimizar imagens (sharp)`);
    console.log(`  3. Backup LOCAL em backups/storage-optimization/${dateStamp}/`);
    if (BACKUP_REMOTE) {
      console.log(`  4. Backup REMOTO em _backups/storage-optimization/${dateStamp}/ (opcional)`);
      console.log(`  5. Substituir versao otimizada no storage (mesmo path, upsert)`);
    } else {
      console.log(`  4. Substituir versao otimizada no storage (mesmo path, upsert)`);
    }
    console.log(`\n  Ctrl+C para cancelar (5s)...`);
    await sleep(5000);
    console.log(`  Prosseguindo...`);
  }

  const allFiles = await listBucketFiles();

  if (allFiles.length === 0) {
    console.log('Nenhum arquivo para processar.');
    return;
  }

  console.log(`\nProcessando (concorrencia: ${CONCURRENCY})...`);

  for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
    const batch = allFiles.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((f) => processFile(f)));
  }

  await saveReport();
  printSummary();

  if (!IS_DRY_RUN) {
    console.log(`\nBackups locais: backups/storage-optimization/${dateStamp}/`);
    if (BACKUP_REMOTE) {
      console.log(`Backups remotos: _backups/storage-optimization/${dateStamp}/`);
      console.log(`    NOTA: Backups remotos consomem storage do Supabase.`);
      console.log(`    Para reducao real, remova-os apos confirmar que os otimizados abrem.`);
      console.log(`    Use: npm run storage:optimize -- --list-remote-backups`);
    }
    console.log(`\nVerifique manualmente alguns arquivos antes de limpar backups.`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});