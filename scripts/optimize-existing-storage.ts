#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { jsPDF } from 'jspdf';
import puppeteer from 'puppeteer-core';
import express from 'express';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as process from 'node:process';

const BUCKET = 'documentos';
const ALLOWED_FOLDERS = ['cadastros', 'receita', 'cupom', 'identidades', 'documentos', 'procuracao'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const IMAGE_MAX_SIDE = 1800;
const PDF_MAX_SIDE = 1700;
const IMAGE_QUALITY = 78;
const PDF_JPEG_QUALITY = 0.76;
const MIN_SAVING_PERCENT = 5;
const BACKUP_ROOT = 'backups/storage-optimization';
const REPORT_ROOT = 'reports/storage-optimization';
const DATE_TAG = new Date().toISOString().slice(0, 10);

type FileType = 'image' | 'pdf' | 'unsupported';
type BackupType = 'local' | 'remote' | 'both' | 'none';
type Action =
  | 'optimized'
  | 'skipped-small'
  | 'skipped-not-worth-it'
  | 'skipped-unsupported'
  | 'skipped-pdf-error'
  | 'failed-backup'
  | 'failed-validation'
  | 'failed-upload'
  | 'not-estimated';

type StorageItem = {
  name: string;
  metadata?: {
    size?: number;
    mimetype?: string;
  };
};

type ReportRow = {
  path: string;
  folder: string;
  fileType: FileType;
  originalSizeBytes: number;
  finalSizeBytes: number | null;
  savedBytes: number | null;
  savedPercent: number | null;
  action: Action;
  backupType: BackupType;
  localBackupPath: string | null;
  remoteBackupPath: string | null;
  pageCount: number | null;
  contentTypeBefore: string | null;
  contentTypeAfter: string | null;
  error: string | null;
};

type OptimizedPayload = {
  buffer: Buffer;
  contentType: string;
  pageCount: number | null;
};

type RenderedPdfPage = {
  dataUrl: string;
  width: number;
  height: number;
};

type PdfRenderer = {
  browser: any;
  page: any;
  server: http.Server;
};

type Cli = {
  dryRun: boolean;
  apply: boolean;
  includeImages: boolean;
  includePdfs: boolean;
  backupRemote: boolean;
  listRemoteBackups: boolean;
  estimate: boolean;
  folders: string[];
  limit: number;
  concurrency: number;
  largest: boolean;
  minSizeMb: number | null;
  onlyPath: string | null;
};

const args = process.argv.slice(2);

function hasFlag(flag: string) {
  return args.includes(flag);
}

function readValue(name: string, fallback?: string) {
  const exact = args.findIndex((arg) => arg === name);
  if (exact !== -1 && args[exact + 1]) return args[exact + 1];
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`));
  return withEquals ? withEquals.split('=').slice(1).join('=') : fallback;
}

function readNumber(name: string, fallback: number) {
  const raw = readValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCli(): Cli {
  const apply = hasFlag('--apply');
  const dryRun = !apply || hasFlag('--dry-run');
  const onlyPath = readValue('--only-path')?.trim().replace(/\\/g, '/') || null;
  const requestedFolders = (readValue('--folders') || ALLOWED_FOLDERS.join(','))
    .split(',')
    .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);

  const folders = requestedFolders.filter((folder) => ALLOWED_FOLDERS.includes(folder));
  const invalidFolders = requestedFolders.filter((folder) => !ALLOWED_FOLDERS.includes(folder));
  if (invalidFolders.length) {
    console.warn(`Pastas fora do escopo ignoradas: ${invalidFolders.join(', ')}`);
  }

  return {
    dryRun,
    apply,
    includeImages: hasFlag('--include-images'),
    includePdfs: hasFlag('--include-pdfs'),
    backupRemote: hasFlag('--backup-remote'),
    listRemoteBackups: hasFlag('--list-remote-backups'),
    estimate: hasFlag('--estimate'),
    folders: folders.length ? folders : ALLOWED_FOLDERS,
    limit: readNumber('--limit', Infinity),
    concurrency: Math.min(readNumber('--concurrency', 2), 4),
    largest: hasFlag('--largest'),
    minSizeMb: readValue('--min-size-mb') ? readNumber('--min-size-mb', 0) : null,
    onlyPath,
  };
}

const cli = parseCli();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows: ReportRow[] = [];
const manifestEntries: any[] = [];
let changedCount = 0;
let criticalUploadFailures = 0;
let pdfRenderer: PdfRenderer | null = null;

function formatBytes(bytes: number | null) {
  if (bytes === null) return 'n/a';
  if (bytes >= 1000 ** 3) return `${(bytes / 1000 ** 3).toFixed(2)} GB`;
  if (bytes >= 1000 ** 2) return `${(bytes / 1000 ** 2).toFixed(2)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function sha256(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extOf(filePath: string) {
  return path.posix.extname(filePath).toLowerCase();
}

function folderOf(filePath: string) {
  return filePath.split('/')[0] || '';
}

function contentTypeOf(item: StorageItem) {
  return item.metadata?.mimetype || null;
}

function sizeOf(item: StorageItem) {
  return Number(item.metadata?.size || 0);
}

function detectFileType(item: StorageItem): FileType {
  const contentType = contentTypeOf(item) || '';
  const ext = extOf(item.name);
  if (contentType.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (contentType === 'application/pdf' || PDF_EXTENSIONS.has(ext)) return 'pdf';
  return 'unsupported';
}

function baseRow(item: StorageItem, action: Action, extra: Partial<ReportRow> = {}): ReportRow {
  const originalSizeBytes = sizeOf(item);
  const fileType = detectFileType(item);
  return {
    path: item.name,
    folder: folderOf(item.name),
    fileType,
    originalSizeBytes,
    finalSizeBytes: originalSizeBytes,
    savedBytes: 0,
    savedPercent: 0,
    action,
    backupType: 'none',
    localBackupPath: null,
    remoteBackupPath: null,
    pageCount: null,
    contentTypeBefore: contentTypeOf(item),
    contentTypeAfter: contentTypeOf(item),
    error: null,
    ...extra,
  };
}

function addRow(row: ReportRow) {
  rows.push(row);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listFolderRecursive(prefix: string): Promise<StorageItem[]> {
  const out: StorageItem[] = [];

  async function scan(currentPrefix: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(currentPrefix, {
          limit: 100,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });

      if (error) throw new Error(`Falha ao listar ${currentPrefix}: ${error.message}`);
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const fullName = `${currentPrefix}${entry.name}`;
        if (fullName.startsWith('_backups/')) continue;
        if (entry.id) {
          out.push({ ...entry, name: fullName });
        } else {
          await scan(`${fullName}/`);
        }
      }

      if (data.length < 100) break;
      offset += 100;
    }
  }

  await scan(prefix.endsWith('/') ? prefix : `${prefix}/`);
  return out;
}

async function listRootFolders() {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } });

  if (error || !data) return [];
  return data.map((entry) => entry.name).filter(Boolean);
}

async function downloadFile(filePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).download(filePath);
  if (error || !data) {
    throw new Error(error?.message || 'download-failed');
  }

  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || 'application/octet-stream',
  };
}

async function optimizeImage(buffer: Buffer): Promise<OptimizedPayload | null> {
  const original = sharp(buffer, { failOn: 'none' });
  const metadata = await original.metadata();
  if (!metadata.width || !metadata.height) return null;

  const output = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: IMAGE_MAX_SIDE,
      height: IMAGE_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
    .toBuffer();

  const validation = await sharp(output).metadata();
  if (!validation.width || !validation.height) return null;

  return {
    buffer: output,
    contentType: 'image/jpeg',
    pageCount: null,
  };
}

function findChromeExecutable() {
  const candidates = [
    process.env.PDF_CHROME_PATH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : '',
  ].filter(Boolean) as string[];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chrome/Edge nao encontrado. Defina PDF_CHROME_PATH para otimizar PDFs com seguranca.');
  }

  return found;
}

async function getPdfRenderer(): Promise<PdfRenderer> {
  if (pdfRenderer) return pdfRenderer;

  const app = express();
  app.get('/', (_req, res) => res.send('<!doctype html><html><body>pdf-renderer</body></html>'));
  app.use('/pdfjs', express.static(path.resolve('node_modules/pdfjs-dist/build')));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Falha ao iniciar servidor local do PDF.js.');

  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });

  pdfRenderer = { browser, page, server };
  return pdfRenderer;
}

async function closePdfRenderer() {
  if (!pdfRenderer) return;
  const renderer = pdfRenderer;
  pdfRenderer = null;
  await renderer.browser.close().catch(() => undefined);
  await new Promise<void>((resolve) => renderer.server.close(() => resolve()));
}

async function renderPdfPagesInBrowser(buffer: Buffer): Promise<{ pageCount: number; pages: RenderedPdfPage[] } | null> {
  const renderer = await getPdfRenderer();
  const pdfBase64 = buffer.toString('base64');

  return renderer.page.evaluate(async ({ pdfBase64, maxSide, quality }) => {
    const win = window as any;
    const pdfjs = win.__pdfjs || await (new Function('return import("/pdfjs/pdf.mjs")')() as Promise<any>);
    win.__pdfjs = pdfjs;
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pageCount = pdf.numPages;
    if (pageCount <= 0 || pageCount > 100) {
      await pdf.destroy();
      return null;
    }

    const pages: RenderedPdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(maxSide / viewport.width, maxSide / viewport.height);
      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(scaledViewport.width));
      canvas.height = Math.max(1, Math.round(scaledViewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas-context-unavailable');

      await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
      pages.push({
        dataUrl: canvas.toDataURL('image/jpeg', quality),
        width: canvas.width,
        height: canvas.height,
      });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }

    await pdf.destroy();
    return { pageCount, pages };
  }, { pdfBase64, maxSide: PDF_MAX_SIDE, quality: PDF_JPEG_QUALITY });
}

async function optimizePdf(buffer: Buffer): Promise<OptimizedPayload | null> {
  if (buffer.subarray(0, 5).toString() !== '%PDF-') return null;

  const rendered = await renderPdfPagesInBrowser(buffer);
  if (!rendered || rendered.pages.length === 0) return null;

  const [firstPage, ...otherPages] = rendered.pages;
  const doc = new jsPDF({ unit: 'px', compress: true, format: [firstPage.width, firstPage.height] });
  doc.addImage(firstPage.dataUrl, 'JPEG', 0, 0, firstPage.width, firstPage.height, undefined, 'FAST');

  for (const page of otherPages) {
    doc.addPage([page.width, page.height]);
    doc.addImage(page.dataUrl, 'JPEG', 0, 0, page.width, page.height, undefined, 'FAST');
  }

  const output = Buffer.from(doc.output('arraybuffer'));
  if (output.length <= 0 || output.subarray(0, 5).toString() !== '%PDF-') return null;

  const validation = await getDocument({ data: new Uint8Array(output) }).promise;
  const validPageCount = validation.numPages;
  validation.destroy();
  if (validPageCount !== rendered.pageCount) return null;

  return {
    buffer: output,
    contentType: 'application/pdf',
    pageCount: rendered.pageCount,
  };
}

async function optimizeByType(fileType: FileType, buffer: Buffer) {
  if (fileType === 'image') return optimizeImage(buffer);
  if (fileType === 'pdf') return optimizePdf(buffer);
  return null;
}

function saveLocalBackup(originalPath: string, buffer: Buffer) {
  const relativePath = path.join(BACKUP_ROOT, DATE_TAG, ...originalPath.split('/'));
  const fullPath = path.resolve(relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return relativePath.replace(/\\/g, '/');
}

async function saveRemoteBackup(originalPath: string, buffer: Buffer) {
  const remotePath = path.posix.join('_backups/storage-optimization', DATE_TAG, originalPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(remotePath, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (error) throw new Error(error.message);
  return remotePath;
}

async function uploadOptimized(originalPath: string, payload: OptimizedPayload) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(originalPath, payload.buffer, {
      contentType: payload.contentType,
      upsert: true,
    });

  if (error) throw new Error(error.message);
}

async function uploadBuffer(originalPath: string, buffer: Buffer, contentType: string) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(originalPath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) throw new Error(error.message);
}

async function validatePostUpload(originalPath: string, expectedType: FileType, contentType: string, expectedPageCount: number | null) {
  const downloaded = await downloadFile(originalPath);
  if (downloaded.buffer.length <= 0) throw new Error('post-upload-empty-file');

  if (expectedType === 'image') {
    const metadata = await sharp(downloaded.buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error('post-upload-invalid-image');
  }

  if (expectedType === 'pdf') {
    if (downloaded.buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('post-upload-invalid-pdf-signature');
    const pdf = await getDocument({ data: new Uint8Array(downloaded.buffer) }).promise;
    const pageCount = pdf.numPages;
    pdf.destroy();
    if (expectedPageCount !== null && pageCount !== expectedPageCount) throw new Error('post-upload-pdf-page-count-mismatch');
  }

  if (contentType === 'application/pdf' && downloaded.contentType && !downloaded.contentType.includes('pdf')) {
    throw new Error(`post-upload-content-type-mismatch:${downloaded.contentType}`);
  }
}

async function restoreOriginalAfterFailure(originalPath: string, originalBuffer: Buffer, originalContentType: string, expectedType: FileType) {
  await uploadBuffer(originalPath, originalBuffer, originalContentType || 'application/octet-stream');
  await validatePostUpload(
    originalPath,
    expectedType,
    originalContentType || 'application/octet-stream',
    expectedType === 'pdf' ? null : null,
  );
}

function rowFromOptimization(
  item: StorageItem,
  original: Buffer,
  payload: OptimizedPayload,
  action: Action,
  extra: Partial<ReportRow> = {},
) {
  const savedBytes = original.length - payload.buffer.length;
  const savedPercent = original.length > 0 ? (savedBytes / original.length) * 100 : 0;

  return baseRow(item, action, {
    originalSizeBytes: original.length,
    finalSizeBytes: action === 'optimized' ? payload.buffer.length : original.length,
    savedBytes: action === 'optimized' ? savedBytes : 0,
    savedPercent: action === 'optimized' ? Number(savedPercent.toFixed(2)) : 0,
    pageCount: payload.pageCount,
    contentTypeAfter: payload.contentType,
    ...extra,
  });
}

async function processItem(item: StorageItem) {
  const fileType = detectFileType(item);
  const originalSize = sizeOf(item);

  if (!cli.dryRun && (fileType === 'image' || fileType === 'pdf')) {
    console.log(`[${changedCount + 1}/${Number.isFinite(cli.limit) ? cli.limit : 'todos'}] ${item.name} (${fileType}, ${formatBytes(originalSize)})`);
  }

  if (fileType === 'unsupported') {
    addRow(baseRow(item, 'skipped-unsupported'));
    return;
  }

  if (!cli.dryRun && fileType === 'image' && !cli.includeImages) {
    addRow(baseRow(item, 'skipped-unsupported', { error: 'include-images-not-set' }));
    return;
  }

  if (!cli.dryRun && fileType === 'pdf' && !cli.includePdfs) {
    addRow(baseRow(item, 'skipped-unsupported', { error: 'include-pdfs-not-set' }));
    return;
  }

  if (cli.dryRun && !cli.estimate) {
    addRow(baseRow(item, 'not-estimated', {
      finalSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      contentTypeAfter: null,
    }));
    return;
  }

  if (!cli.dryRun && changedCount >= cli.limit) {
    addRow(baseRow(item, 'not-estimated', {
      finalSizeBytes: null,
      savedBytes: null,
      savedPercent: null,
      error: 'limit-reached',
    }));
    return;
  }

  let downloaded: { buffer: Buffer; contentType: string };
  try {
    downloaded = await downloadFile(item.name);
  } catch (error: any) {
    addRow(baseRow(item, 'failed-upload', { error: `download:${error.message}` }));
    return;
  }

  let optimized: OptimizedPayload | null = null;
  try {
    optimized = await optimizeByType(fileType, downloaded.buffer);
  } catch (error: any) {
    addRow(baseRow(item, fileType === 'pdf' ? 'skipped-pdf-error' : 'failed-validation', {
      originalSizeBytes: downloaded.buffer.length,
      finalSizeBytes: downloaded.buffer.length,
      error: error.message,
      contentTypeBefore: downloaded.contentType,
    }));
    return;
  }

  if (!optimized) {
    addRow(baseRow(item, fileType === 'pdf' ? 'skipped-pdf-error' : 'failed-validation', {
      originalSizeBytes: downloaded.buffer.length,
      finalSizeBytes: downloaded.buffer.length,
      contentTypeBefore: downloaded.contentType,
      error: 'optimization-returned-null',
    }));
    return;
  }

  const savedBytes = downloaded.buffer.length - optimized.buffer.length;
  const savedPercent = downloaded.buffer.length > 0 ? (savedBytes / downloaded.buffer.length) * 100 : 0;
  if (optimized.buffer.length >= downloaded.buffer.length) {
    addRow(rowFromOptimization(item, downloaded.buffer, optimized, 'skipped-not-worth-it', {
      contentTypeBefore: downloaded.contentType,
      contentTypeAfter: downloaded.contentType,
    }));
    return;
  }

  if (savedPercent < MIN_SAVING_PERCENT) {
    addRow(rowFromOptimization(item, downloaded.buffer, optimized, 'skipped-small', {
      contentTypeBefore: downloaded.contentType,
      contentTypeAfter: downloaded.contentType,
    }));
    return;
  }

  if (cli.dryRun) {
    addRow(baseRow(item, 'not-estimated', {
      originalSizeBytes: downloaded.buffer.length,
      finalSizeBytes: optimized.buffer.length,
      savedBytes,
      savedPercent: Number(savedPercent.toFixed(2)),
      pageCount: optimized.pageCount,
      contentTypeBefore: downloaded.contentType,
      contentTypeAfter: optimized.contentType,
      error: 'estimate-only',
    }));
    return;
  }

  let localBackupPath: string;
  try {
    localBackupPath = saveLocalBackup(item.name, downloaded.buffer);
  } catch (error: any) {
    addRow(baseRow(item, 'failed-backup', {
      originalSizeBytes: downloaded.buffer.length,
      finalSizeBytes: downloaded.buffer.length,
      contentTypeBefore: downloaded.contentType,
      error: error.message,
    }));
    return;
  }

  let backupType: BackupType = 'local';
  let remoteBackupPath: string | null = null;
  if (cli.backupRemote) {
    try {
      remoteBackupPath = await saveRemoteBackup(item.name, downloaded.buffer);
      backupType = 'both';
    } catch (error: any) {
      console.warn(`Backup remoto falhou para ${item.name}: ${error.message}`);
    }
  }

  try {
    await uploadOptimized(item.name, optimized);
  } catch (error: any) {
    criticalUploadFailures += 1;
    try {
      await restoreOriginalAfterFailure(item.name, downloaded.buffer, downloaded.contentType, fileType);
    } catch (restoreError: any) {
      console.error(`ERRO CRITICO: upload falhou e restore tambem falhou em ${item.name}: ${restoreError.message}`);
    }
    addRow(rowFromOptimization(item, downloaded.buffer, optimized, 'failed-upload', {
      backupType,
      localBackupPath,
      remoteBackupPath,
      contentTypeBefore: downloaded.contentType,
      error: error.message,
    }));
    return;
  }

  try {
    await validatePostUpload(item.name, fileType, optimized.contentType, optimized.pageCount);
  } catch (error: any) {
    criticalUploadFailures += 1;
    try {
      await restoreOriginalAfterFailure(item.name, downloaded.buffer, downloaded.contentType, fileType);
      console.error(`Validacao falhou em ${item.name}; original restaurado a partir do backup local.`);
    } catch (restoreError: any) {
      console.error(`ERRO CRITICO: validacao falhou e restore tambem falhou em ${item.name}: ${restoreError.message}`);
    }
    addRow(rowFromOptimization(item, downloaded.buffer, optimized, 'failed-validation', {
      backupType,
      localBackupPath,
      remoteBackupPath,
      contentTypeBefore: downloaded.contentType,
      error: error.message,
    }));
    return;
  }

  changedCount += 1;
  addRow(rowFromOptimization(item, downloaded.buffer, optimized, 'optimized', {
    backupType,
    localBackupPath,
    remoteBackupPath,
    contentTypeBefore: downloaded.contentType,
  }));

  manifestEntries.push({
    originalPath: item.name,
    localBackupPath,
    originalSizeBytes: downloaded.buffer.length,
    finalSizeBytes: optimized.buffer.length,
    contentTypeBefore: downloaded.contentType,
    contentTypeAfter: optimized.contentType,
    sha256Original: sha256(downloaded.buffer),
    sha256Optimized: sha256(optimized.buffer),
    optimizedAt: new Date().toISOString(),
    action: 'optimized',
  });

  console.log(`  OK ${formatBytes(downloaded.buffer.length)} -> ${formatBytes(optimized.buffer.length)} (-${Number(savedPercent.toFixed(2))}%)`);
}

function summarize(foldersOutOfScope: string[]) {
  const summary = {
    totalAnalyzed: rows.length,
    totalEligible: rows.filter((row) => row.fileType !== 'unsupported').length,
    totalOptimized: rows.filter((row) => row.action === 'optimized').length,
    totalSkipped: rows.filter((row) => row.action.startsWith('skipped') || row.action === 'not-estimated').length,
    totalErrors: rows.filter((row) => row.action.startsWith('failed')).length,
    totalBeforeBytes: rows.reduce((sum, row) => sum + row.originalSizeBytes, 0),
    totalAfterBytesCalculated: rows.reduce((sum, row) => sum + (row.finalSizeBytes ?? 0), 0),
    totalSavedBytesCalculated: rows.reduce((sum, row) => sum + (row.savedBytes ?? 0), 0),
    byFolder: {} as Record<string, any>,
    byType: {} as Record<string, any>,
    foldersOutOfScope,
  };

  for (const row of rows) {
    summary.byFolder[row.folder] ||= { files: 0, bytes: 0, images: 0, pdfs: 0, unsupported: 0, savedBytesCalculated: 0 };
    summary.byFolder[row.folder].files += 1;
    summary.byFolder[row.folder].bytes += row.originalSizeBytes;
    summary.byFolder[row.folder].savedBytesCalculated += row.savedBytes ?? 0;
    if (row.fileType === 'image') summary.byFolder[row.folder].images += 1;
    if (row.fileType === 'pdf') summary.byFolder[row.folder].pdfs += 1;
    if (row.fileType === 'unsupported') summary.byFolder[row.folder].unsupported += 1;

    summary.byType[row.fileType] ||= { files: 0, bytes: 0, savedBytesCalculated: 0 };
    summary.byType[row.fileType].files += 1;
    summary.byType[row.fileType].bytes += row.originalSizeBytes;
    summary.byType[row.fileType].savedBytesCalculated += row.savedBytes ?? 0;
  }

  return summary;
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function saveReports(summary: any) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.mkdirSync(REPORT_ROOT, { recursive: true });

  const reportPath = path.join(REPORT_ROOT, `report-${timestamp}.json`);
  const csvPath = path.join(REPORT_ROOT, `report-${timestamp}.csv`);
  const manifestPath = path.join(REPORT_ROOT, `manifest-${timestamp}.json`);

  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp,
    bucket: BUCKET,
    dryRun: cli.dryRun,
    estimate: cli.estimate,
    apply: cli.apply && !cli.dryRun,
    includeImages: cli.includeImages,
    includePdfs: cli.includePdfs,
    folders: cli.folders,
    limit: Number.isFinite(cli.limit) ? cli.limit : 'all',
    backupRemote: cli.backupRemote,
    summary,
    entries: rows,
  }, null, 2));

  const headers = [
    'path',
    'folder',
    'fileType',
    'originalSizeBytes',
    'finalSizeBytes',
    'savedBytes',
    'savedPercent',
    'action',
    'backupType',
    'localBackupPath',
    'remoteBackupPath',
    'pageCount',
    'contentTypeBefore',
    'contentTypeAfter',
    'error',
  ];
  const csvRows = rows.map((row) => headers.map((key) => csvEscape((row as any)[key])).join(','));
  fs.writeFileSync(csvPath, `${headers.join(',')}\n${csvRows.join('\n')}`);
  fs.writeFileSync(manifestPath, JSON.stringify({ timestamp, bucket: BUCKET, entries: manifestEntries }, null, 2));

  return { reportPath, csvPath, manifestPath };
}

async function listRemoteBackups() {
  const files = await listFolderRecursive('_backups/storage-optimization');
  const totalBytes = files.reduce((sum, file) => sum + sizeOf(file), 0);
  console.log(`Backups remotos: ${files.length} arquivo(s), ${formatBytes(totalBytes)}`);
  files.forEach((file) => console.log(`- ${file.name} (${formatBytes(sizeOf(file))})`));
}

async function processWithConcurrency(items: StorageItem[]) {
  if (!cli.dryRun) {
    for (const item of items) {
      if (changedCount >= cli.limit) {
        addRow(baseRow(item, 'not-estimated', {
          finalSizeBytes: null,
          savedBytes: null,
          savedPercent: null,
          error: 'limit-reached',
        }));
        continue;
      }
      await processItem(item);
      if (criticalUploadFailures >= 3) {
        throw new Error('Tres falhas criticas de upload/validacao ocorreram. Execucao interrompida.');
      }
    }
    return;
  }

  for (let index = 0; index < items.length; index += cli.concurrency) {
    await Promise.all(items.slice(index, index + cli.concurrency).map((item) => processItem(item)));
  }
}

function validateOnlyPath() {
  if (!cli.onlyPath) return;
  if (cli.onlyPath.startsWith('/') || cli.onlyPath.includes('..')) {
    throw new Error('--only-path invalido.');
  }
  const folder = folderOf(cli.onlyPath);
  if (!ALLOWED_FOLDERS.includes(folder)) {
    throw new Error(`--only-path fora do escopo permitido: ${cli.onlyPath}`);
  }
}

function selectCandidates(files: StorageItem[]) {
  let candidates = [...files];

  if (cli.onlyPath) {
    candidates = candidates.filter((file) => file.name === cli.onlyPath);
  }

  if (cli.includeImages && !cli.includePdfs) {
    candidates = candidates.filter((file) => detectFileType(file) === 'image');
  } else if (cli.includePdfs && !cli.includeImages) {
    candidates = candidates.filter((file) => detectFileType(file) === 'pdf');
  } else if (cli.includeImages && cli.includePdfs) {
    candidates = candidates.filter((file) => detectFileType(file) === 'image' || detectFileType(file) === 'pdf');
  }

  if (cli.minSizeMb !== null) {
    const minBytes = cli.minSizeMb * 1000 * 1000;
    candidates = candidates.filter((file) => sizeOf(file) >= minBytes);
  }

  if (cli.largest) {
    candidates.sort((a, b) => sizeOf(b) - sizeOf(a));
  }

  return candidates;
}

async function main() {
  if (cli.listRemoteBackups) {
    await listRemoteBackups();
    return;
  }

  if (!cli.dryRun && !cli.includeImages && !cli.includePdfs) {
    console.error('No modo --apply, informe --include-images e/ou --include-pdfs.');
    process.exit(1);
  }

  if (cli.dryRun && cli.backupRemote) {
    console.warn('--backup-remote ignorado no dry-run.');
  }

  console.log('OTIMIZACAO DE STORAGE - FARMACIA POPULAR');
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Modo: ${cli.dryRun ? (cli.estimate ? 'DRY-RUN COM ESTIMATIVA' : 'DRY-RUN SEM ESTIMATIVA') : 'APPLY'}`);
  console.log(`Pastas: ${cli.folders.join(', ')}`);
  console.log(`Tipos: imagens=${cli.includeImages ? 'sim' : 'nao'} pdfs=${cli.includePdfs ? 'sim' : 'nao'}`);
  console.log(`Limite de alteracoes: ${Number.isFinite(cli.limit) ? cli.limit : 'todos'}`);
  if (cli.largest) console.log('Ordenacao: maiores arquivos primeiro');
  if (cli.minSizeMb !== null) console.log(`Tamanho minimo: ${cli.minSizeMb} MB`);
  if (cli.onlyPath) console.log(`Arquivo especifico: ${cli.onlyPath}`);

  validateOnlyPath();

  if (!cli.dryRun) {
    console.log(`Backup local obrigatorio: ${BACKUP_ROOT}/${DATE_TAG}/`);
    console.log('Aguardando 5s antes de alterar Storage...');
    await sleep(5000);
  }

  const rootFolders = await listRootFolders();
  const foldersOutOfScope = rootFolders.filter((folder) => !ALLOWED_FOLDERS.includes(folder) && folder !== '_backups');
  const scopedFiles = (await Promise.all(cli.folders.map((folder) => listFolderRecursive(folder)))).flat();
  const candidates = selectCandidates(scopedFiles);

  console.log(`Arquivos encontrados no escopo: ${scopedFiles.length}`);
  console.log(`Arquivos candidatos apos filtros: ${candidates.length}`);
  if (cli.onlyPath && candidates.length === 0) throw new Error(`Arquivo nao encontrado no escopo: ${cli.onlyPath}`);
  await processWithConcurrency(candidates);

  const summary = summarize(foldersOutOfScope);
  const reportFiles = saveReports(summary);

  console.log('\nRESUMO');
  console.log(`Analisados: ${summary.totalAnalyzed}`);
  console.log(`Elegiveis: ${summary.totalEligible}`);
  console.log(`Otimizados: ${summary.totalOptimized}`);
  console.log(`Pulados: ${summary.totalSkipped}`);
  console.log(`Erros: ${summary.totalErrors}`);
  console.log(`Total atual medido: ${formatBytes(summary.totalBeforeBytes)}`);
  if (summary.totalSavedBytesCalculated > 0) {
    const pct = (summary.totalSavedBytesCalculated / summary.totalBeforeBytes) * 100;
    console.log(`Economia calculada/estimada: ${formatBytes(summary.totalSavedBytesCalculated)} (${pct.toFixed(2)}%)`);
  } else if (cli.dryRun && !cli.estimate) {
    console.log('Economia nao estimada neste dry-run. Use --estimate para baixar/processar sem upload.');
  }

  for (const [folder, data] of Object.entries<any>(summary.byFolder)) {
    console.log(`- ${folder}: ${data.files} arquivo(s), ${formatBytes(data.bytes)}, imagens=${data.images}, PDFs=${data.pdfs}`);
  }

  if (foldersOutOfScope.length) {
    console.log(`Pastas fora do escopo encontradas: ${foldersOutOfScope.join(', ')}`);
  }

  console.log(`Relatorio JSON: ${reportFiles.reportPath}`);
  console.log(`Relatorio CSV: ${reportFiles.csvPath}`);
  console.log(`Manifesto: ${reportFiles.manifestPath}`);
}

main()
  .catch((error) => {
    console.error('Fatal:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePdfRenderer();
  });
