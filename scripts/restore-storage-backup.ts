#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as fs from 'node:fs';
import * as process from 'node:process';

const args = process.argv.slice(2);

function readValue(name: string) {
  const exact = args.findIndex((arg) => arg === name);
  if (exact !== -1 && args[exact + 1]) return args[exact + 1];
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`));
  return withEquals ? withEquals.split('=').slice(1).join('=') : undefined;
}

function readNumber(name: string, fallback: number) {
  const raw = readValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const manifestPath = readValue('--manifest');
const limit = readNumber('--limit', Infinity);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!manifestPath) {
  console.error('Informe --manifest reports/storage-optimization/manifest-XXXX.json');
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function validate(buffer: Buffer, contentType: string) {
  if (buffer.length <= 0) throw new Error('arquivo vazio');
  if (contentType.startsWith('image/')) {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error('imagem invalida');
  }
  if (contentType === 'application/pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('assinatura PDF invalida');
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    pdf.destroy();
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bucket = manifest.bucket || 'documentos';
  const entries = Array.isArray(manifest.entries) ? manifest.entries.slice(0, limit) : [];
  const report: any[] = [];

  console.log(`Restaurando ${entries.length} arquivo(s) a partir de ${manifestPath}`);

  for (const entry of entries) {
    try {
      if (!entry.originalPath || !entry.localBackupPath) throw new Error('manifesto sem path/backup local');
      const buffer = fs.readFileSync(entry.localBackupPath);
      const contentType = entry.contentTypeBefore || 'application/octet-stream';
      await validate(buffer, contentType);

      const { error } = await supabase.storage.from(bucket).upload(entry.originalPath, buffer, {
        contentType,
        upsert: true,
      });
      if (error) throw error;

      const { data, error: downloadError } = await supabase.storage.from(bucket).download(entry.originalPath);
      if (downloadError || !data) throw downloadError || new Error('download pos-restore falhou');
      const restored = Buffer.from(await data.arrayBuffer());
      await validate(restored, contentType);

      report.push({
        originalPath: entry.originalPath,
        localBackupPath: entry.localBackupPath,
        restoredBytes: restored.length,
        status: 'restored',
        restoredAt: new Date().toISOString(),
      });
      console.log(`OK ${entry.originalPath}`);
    } catch (error: any) {
      report.push({
        originalPath: entry.originalPath,
        localBackupPath: entry.localBackupPath,
        status: 'failed',
        error: error.message,
      });
      console.error(`Falhou ${entry.originalPath}: ${error.message}`);
    }
  }

  fs.mkdirSync('reports/storage-optimization', { recursive: true });
  const out = `reports/storage-optimization/restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  fs.writeFileSync(out, JSON.stringify({ manifestPath, entries: report }, null, 2));
  console.log(`Relatorio de restore: ${out}`);
}

main().catch((error) => {
  console.error('Fatal:', error.message);
  process.exit(1);
});
