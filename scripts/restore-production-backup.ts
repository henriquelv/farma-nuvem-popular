#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const args = process.argv.slice(2);
const APPLY_CONFIRMATION = 'RESTORE_PRODUCTION_BACKUP';

function hasFlag(name: string) { return args.includes(name); }
function readValue(name: string) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

const manifestArgument = readValue('--manifest');
const apply = hasFlag('--apply');
const confirmation = readValue('--confirm');
if (!manifestArgument) {
  console.error('Informe --manifest backups/production/.../manifest.json');
  process.exit(1);
}
if (apply && confirmation !== APPLY_CONFIRMATION) {
  console.error(`Restore real exige --apply --confirm ${APPLY_CONFIRMATION}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.');
  process.exit(1);
}

const manifestPath = path.resolve(manifestArgument);
const backupRoot = path.dirname(manifestPath);
const reportRoot = path.join(backupRoot, 'restore-reports');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const report: any = {
  mode: apply ? 'apply' : 'dry-run',
  status: 'running',
  manifest: manifestPath,
  startedAt: new Date().toISOString(),
  completedAt: null,
  tables: [],
  storage: [],
  criticalFailures: [],
};

function sha256(data: Buffer | string) { return crypto.createHash('sha256').update(data).digest('hex'); }
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function equalRows(left: any, right: any) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function localFile(relativePath: string) {
  const absolute = path.resolve(backupRoot, relativePath);
  if (absolute !== backupRoot && !absolute.startsWith(`${backupRoot}${path.sep}`)) throw new Error(`Arquivo fora do backup: ${relativePath}`);
  return absolute;
}
function chunks<T>(values: T[], size = 100) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
function isMissingObject(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return error?.statusCode === '404' || message.includes('not found') || message.includes('does not exist');
}

const missingRows = new Map<string, any[]>();
const missingStorage: any[] = [];
const CORE_TABLES = ['clientes', 'vendas', 'vendas_documentos'];
const RESTORE_ORDER = ['farmacias', 'user_profiles', ...CORE_TABLES];

function verifyManifest() {
  if (manifest.kind !== 'farma-nuvem-production-backup' || manifest.version !== 1) throw new Error('Formato de manifesto incompatível.');
  if (manifest.status !== 'success' || manifest.criticalFailures?.length) throw new Error('O backup não foi concluído com sucesso. Restore bloqueado.');
  const hashFile = `${manifestPath}.sha256`;
  if (!fs.existsSync(hashFile)) throw new Error('Hash do manifesto ausente.');
  const expected = fs.readFileSync(hashFile, 'utf8').trim().split(/\s+/)[0];
  if (sha256(fs.readFileSync(manifestPath)) !== expected) throw new Error('Hash do manifesto divergente.');
}

async function preflightTables() {
  for (const table of RESTORE_ORDER) {
    const entry = manifest.tables.find((candidate: any) => candidate.table === table);
    if (!entry) {
      if (CORE_TABLES.includes(table)) throw new Error(`Tabela ${table} ausente no manifesto.`);
      continue;
    }
    const filePath = localFile(entry.file);
    const buffer = fs.readFileSync(filePath);
    if (buffer.length !== entry.sizeBytes || sha256(buffer) !== entry.sha256) throw new Error(`Backup da tabela ${table} está corrompido.`);
    const rows = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(rows) || rows.length !== entry.rowCount) throw new Error(`Contagem inválida na tabela ${table}.`);

    const existing = new Map<string, any>();
    for (const idChunk of chunks(rows.map((row: any) => row.id))) {
      const { data, error } = await supabase.from(table).select('*').in('id', idChunk);
      if (error) throw new Error(`${table} preflight: ${error.message}`);
      for (const row of data || []) existing.set(row.id, row);
    }

    const missing: any[] = [];
    let identical = 0;
    for (const row of rows) {
      const current = existing.get(row.id);
      if (!current) missing.push(row);
      else if (equalRows(current, row)) identical += 1;
      else throw new Error(`${table}/${row.id} já existe com dados diferentes. Nenhum overwrite será feito.`);
    }
    missingRows.set(table, missing);
    report.tables.push({ table, total: rows.length, identical, missing: missing.length, inserted: 0 });
  }
}

async function preflightStorage() {
  const inspectEntry = async (entry: any) => {
    const filePath = localFile(entry.file);
    const buffer = fs.readFileSync(filePath);
    if (buffer.length !== entry.sizeBytes || sha256(buffer) !== entry.sha256) throw new Error(`Arquivo local corrompido: ${entry.path}`);
    const { data, error } = await supabase.storage.from(manifest.bucket).download(entry.path);
    if (error) {
      if (!isMissingObject(error)) throw new Error(`Falha ao verificar ${entry.path}: ${error.message}`);
      return { entry: { ...entry, buffer }, report: { path: entry.path, status: 'missing' } };
    }
    if (!data) throw new Error(`Storage sem resposta para ${entry.path}.`);
    const current = Buffer.from(await data.arrayBuffer());
    if (sha256(current) !== entry.sha256) throw new Error(`${entry.path} já existe com conteúdo diferente. Nenhum overwrite será feito.`);
    return { entry: null, report: { path: entry.path, status: 'identical' } };
  };

  const entries = manifest.storage || [];
  for (let index = 0; index < entries.length; index += 4) {
    const batch = await Promise.all(entries.slice(index, index + 4).map(inspectEntry));
    for (const result of batch) {
      if (result.entry) missingStorage.push(result.entry);
      report.storage.push(result.report);
    }
  }
}

async function applyRestore() {
  for (const table of RESTORE_ORDER) {
    if (!missingRows.has(table)) continue;
    const rows = missingRows.get(table) || [];
    for (const rowChunk of chunks(rows)) {
      const { error } = await supabase.from(table).insert(rowChunk);
      if (error) throw new Error(`${table} insert: ${error.message}`);
    }
    const tableReport = report.tables.find((entry: any) => entry.table === table);
    tableReport.inserted = rows.length;
  }

  for (const entry of missingStorage) {
    const { error } = await supabase.storage.from(manifest.bucket).upload(entry.path, entry.buffer, {
      contentType: entry.contentType,
      upsert: false,
    });
    if (error) throw new Error(`Storage upload ${entry.path}: ${error.message}`);
    const item = report.storage.find((candidate: any) => candidate.path === entry.path);
    item.status = 'restored';
  }
}

async function postValidate() {
  for (const table of RESTORE_ORDER) {
    if (!missingRows.has(table)) continue;
    const rows = missingRows.get(table) || [];
    for (const idChunk of chunks(rows.map((row: any) => row.id))) {
      if (!idChunk.length) continue;
      const { data, error } = await supabase.from(table).select('id').in('id', idChunk);
      if (error || data?.length !== idChunk.length) throw new Error(`Validação pós-restore falhou em ${table}.`);
    }
  }
  for (const entry of missingStorage) {
    const { data, error } = await supabase.storage.from(manifest.bucket).download(entry.path);
    if (error || !data) throw new Error(`Validação pós-restore falhou em ${entry.path}.`);
    const restored = Buffer.from(await data.arrayBuffer());
    if (sha256(restored) !== entry.sha256) throw new Error(`Hash pós-restore divergente em ${entry.path}.`);
  }
}

async function main() {
  try {
    verifyManifest();
    await preflightTables();
    await preflightStorage();
    if (apply) {
      await applyRestore();
      await postValidate();
    }
    report.status = 'success';
  } catch (error: any) {
    report.status = 'failed';
    report.criticalFailures.push(error.message);
  } finally {
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(reportRoot, { recursive: true });
    const destination = path.join(reportRoot, `${report.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Relatorio: ${destination}`);
    console.log(`Modo: ${report.mode}; status: ${report.status}`);
  }
  if (report.status !== 'success') {
    console.error(report.criticalFailures.join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Falha fatal: ${error.message}`);
  process.exit(1);
});
