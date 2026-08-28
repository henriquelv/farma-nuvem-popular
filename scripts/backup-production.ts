#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const BUCKET = 'documentos';
const CORE_TABLES = ['vendas_documentos', 'vendas', 'clientes'] as const;
const TENANT_TABLES = ['user_profiles', 'farmacias'] as const;
const TABLES = [...CORE_TABLES, ...TENANT_TABLES] as const;
const PAGE_SIZE = 500;
const args = process.argv.slice(2);

function readValue(name: string, fallback?: string) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.resolve(readValue('--output', 'backups/production')!, timestamp);
const databaseRoot = path.join(backupRoot, 'database');
const storageRoot = path.join(backupRoot, 'storage', BUCKET);
const manifestPath = path.join(backupRoot, 'manifest.json');

type TableManifest = {
  table: string;
  file: string;
  rowCount: number;
  countAfterRead: number;
  sizeBytes: number;
  sha256: string;
};

type StorageManifest = {
  path: string;
  file: string;
  contentType: string;
  sizeBytes: number;
  listedSizeBytes: number | null;
  sha256: string;
  lastModified: string | null;
};

const manifest: {
  version: 1;
  kind: 'farma-nuvem-production-backup';
  status: 'running' | 'success' | 'failed';
  bucket: string;
  startedAt: string;
  completedAt: string | null;
  sourceUrl: string;
  tables: TableManifest[];
  storage: StorageManifest[];
  totals: { tableRows: number; storageFiles: number; storageBytes: number };
  criticalFailures: Array<{ scope: string; error: string }>;
} = {
  version: 1,
  kind: 'farma-nuvem-production-backup',
  status: 'running',
  bucket: BUCKET,
  startedAt: new Date().toISOString(),
  completedAt: null,
  sourceUrl: new URL(supabaseUrl).origin,
  tables: [],
  storage: [],
  totals: { tableRows: 0, storageFiles: 0, storageBytes: 0 },
  criticalFailures: [],
};

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sha256(data: Buffer | string) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function writeAtomic(filePath: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function writeManifest() {
  writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function relativeToBackup(absolutePath: string) {
  return path.relative(backupRoot, absolutePath).replace(/\\/g, '/');
}

function localStoragePath(objectPath: string) {
  const normalized = objectPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Path de storage inseguro: ${objectPath}`);
  }
  const destination = path.resolve(storageRoot, ...normalized.split('/'));
  if (destination !== storageRoot && !destination.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error(`Path fora do backup: ${objectPath}`);
  }
  return destination;
}

async function backupTable(table: typeof TABLES[number]) {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  const { count, error: countError } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`${table} count: ${countError.message}`);
  if (count !== rows.length) {
    throw new Error(`${table} mudou durante o backup: lidas ${rows.length}, existentes ${count ?? 'n/a'}. Execute novamente.`);
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error(`${table}: IDs duplicados detectados no backup.`);
  }

  const content = `${JSON.stringify(rows, null, 2)}\n`;
  const destination = path.join(databaseRoot, `${table}.json`);
  writeAtomic(destination, content);
  manifest.tables.push({
    table,
    file: relativeToBackup(destination),
    rowCount: rows.length,
    countAfterRead: count || 0,
    sizeBytes: Buffer.byteLength(content),
    sha256: sha256(content),
  });
  manifest.totals.tableRows += rows.length;
  writeManifest();
  console.log(`Tabela ${table}: ${rows.length} linha(s)`);
}

async function tableAvailable(table: typeof TENANT_TABLES[number]) {
  const { error } = await supabase.from(table).select('id').limit(0);
  if (!error) return true;
  const message = error.message.toLowerCase();
  if (error.code === 'PGRST205' || message.includes('could not find the table')) return false;
  throw new Error(`${table} availability: ${error.message}`);
}

type ListedObject = { name: string; metadata?: { size?: number; mimetype?: string }; updated_at?: string; id?: string | null };

async function listStorage(prefix = ''): Promise<Array<{ path: string; item: ListedObject }>> {
  const files: Array<{ path: string; item: ListedObject }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`Storage list ${prefix || '/'}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data as ListedObject[]) {
      const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id || item.metadata) files.push({ path: objectPath, item });
      else files.push(...await listStorage(objectPath));
    }
    offset += data.length;
    if (data.length < 100) break;
  }
  return files;
}

async function backupStorage() {
  const objects = await listStorage();
  const seen = new Set<string>();
  for (const { path: objectPath } of objects) {
    if (seen.has(objectPath)) throw new Error(`Storage listou path duplicado: ${objectPath}`);
    seen.add(objectPath);
  }

  const downloadObject = async ({ path: objectPath, item }: { path: string; item: ListedObject }): Promise<StorageManifest> => {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
    if (error || !data) throw new Error(`Storage download ${objectPath}: ${error?.message || 'sem dados'}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    const listedSize = Number.isFinite(Number(item.metadata?.size)) ? Number(item.metadata?.size) : null;
    if (listedSize !== null && listedSize !== buffer.length) {
      throw new Error(`Storage ${objectPath}: tamanho listado ${listedSize}, baixado ${buffer.length}`);
    }

    const destination = localStoragePath(objectPath);
    writeAtomic(destination, buffer);
    const diskBuffer = fs.readFileSync(destination);
    if (sha256(diskBuffer) !== sha256(buffer)) throw new Error(`Storage ${objectPath}: hash local divergente`);

    return {
      path: objectPath,
      file: relativeToBackup(destination),
      contentType: item.metadata?.mimetype || data.type || 'application/octet-stream',
      sizeBytes: buffer.length,
      listedSizeBytes: listedSize,
      sha256: sha256(buffer),
      lastModified: item.updated_at || null,
    };
  };

  const concurrency = 4;
  for (let index = 0; index < objects.length; index += concurrency) {
    const batch = await Promise.all(objects.slice(index, index + concurrency).map(downloadObject));
    for (const entry of batch) {
      manifest.storage.push(entry);
      manifest.totals.storageFiles += 1;
      manifest.totals.storageBytes += entry.sizeBytes;
      console.log(`Storage ${manifest.totals.storageFiles}/${objects.length}: ${entry.path}`);
    }
    writeManifest();
  }
}

function validateRelations() {
  const readRows = (table: string) => JSON.parse(fs.readFileSync(path.join(databaseRoot, `${table}.json`), 'utf8')) as any[];
  const clientRows = readRows('clientes');
  const clients = new Set(clientRows.map((row) => row.id));
  const sales = readRows('vendas');
  const saleIds = new Set(sales.map((row) => row.id));
  const documents = readRows('vendas_documentos');
  const pharmaciesFile = path.join(databaseRoot, 'farmacias.json');
  const pharmacies = fs.existsSync(pharmaciesFile)
    ? new Set(readRows('farmacias').map((row) => row.id))
    : null;
  const tenantColumnsPresent = clientRows.every((row) => typeof row.farmacia_id === 'string');
  const clientPharmacies = new Map(clientRows.map((row) => [row.id, row.farmacia_id]));
  const salePharmacies = new Map(sales.map((row) => [row.id, row.farmacia_id]));
  if (pharmacies && tenantColumnsPresent) {
    for (const client of clientRows) {
      if (!pharmacies.has(client.farmacia_id)) throw new Error(`Cliente ${client.id} referencia farmacia ausente.`);
    }
    const profilesFile = path.join(databaseRoot, 'user_profiles.json');
    if (fs.existsSync(profilesFile)) {
      for (const profile of readRows('user_profiles')) {
        if (!pharmacies.has(profile.farmacia_id)) throw new Error(`Perfil ${profile.id} referencia farmacia ausente.`);
      }
    }
  }
  for (const sale of sales) {
    if (sale.cliente_id && !clients.has(sale.cliente_id)) throw new Error(`Venda ${sale.id} referencia cliente ausente.`);
    if (tenantColumnsPresent && sale.cliente_id && sale.farmacia_id !== clientPharmacies.get(sale.cliente_id)) throw new Error(`Venda ${sale.id} cruza farmacias.`);
  }
  for (const document of documents) {
    if (document.cliente_id && !clients.has(document.cliente_id)) throw new Error(`Documento ${document.id} referencia cliente ausente.`);
    if (document.venda_id && !saleIds.has(document.venda_id)) throw new Error(`Documento ${document.id} referencia venda ausente.`);
    if (tenantColumnsPresent && document.cliente_id && document.farmacia_id !== clientPharmacies.get(document.cliente_id)) throw new Error(`Documento ${document.id} cruza farmacias.`);
    if (tenantColumnsPresent && document.venda_id && document.farmacia_id !== salePharmacies.get(document.venda_id)) throw new Error(`Documento ${document.id} cruza vendas de outra farmacia.`);
  }
}

async function main() {
  fs.mkdirSync(backupRoot, { recursive: true });
  writeManifest();
  try {
    for (const table of CORE_TABLES) await backupTable(table);
    for (const table of TENANT_TABLES) {
      if (await tableAvailable(table)) await backupTable(table);
    }
    validateRelations();
    await backupStorage();
    manifest.status = 'success';
  } catch (error: any) {
    manifest.status = 'failed';
    manifest.criticalFailures.push({ scope: 'backup', error: error.message });
  } finally {
    manifest.completedAt = new Date().toISOString();
    writeManifest();
    const manifestHash = sha256(fs.readFileSync(manifestPath));
    writeAtomic(`${manifestPath}.sha256`, `${manifestHash}  manifest.json\n`);
  }

  console.log(`Manifesto: ${manifestPath}`);
  console.log(`Status: ${manifest.status}`);
  if (manifest.status !== 'success') {
    console.error(manifest.criticalFailures.map((failure) => failure.error).join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Falha fatal: ${error.message}`);
  process.exit(1);
});
