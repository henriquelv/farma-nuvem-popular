import { getSupabase } from './supabase';

const DOCUMENT_BUCKET = 'documentos';
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function documentPathFromReference(reference: string | null | undefined): string | null {
  const value = String(reference || '').trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    return safeDecode(value.replace(/^\/+/, '').replace(/^documentos\//, ''));
  }

  try {
    const url = new URL(value);
    const markers = [
      `/storage/v1/object/public/${DOCUMENT_BUCKET}/`,
      `/storage/v1/object/sign/${DOCUMENT_BUCKET}/`,
      `/storage/v1/object/authenticated/${DOCUMENT_BUCKET}/`,
    ];
    for (const marker of markers) {
      const index = url.pathname.indexOf(marker);
      if (index >= 0) return safeDecode(url.pathname.slice(index + marker.length));
    }
  } catch {
    return null;
  }

  return null;
}

export async function resolveDocumentUrl(reference: string | null | undefined): Promise<string | null> {
  const value = String(reference || '').trim();
  if (!value) return null;

  const storagePath = documentPathFromReference(value);
  if (!storagePath) {
    // Compatibilidade temporária para referências externas que não pertencem ao bucket.
    return /^https?:\/\//i.test(value) ? value : null;
  }

  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;

  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase indisponível para assinar o documento.');

  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw error || new Error('Não foi possível abrir o documento privado.');

  signedUrlCache.set(storagePath, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

export async function resolveDocumentRows<T extends { url?: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async (row) => ({
    ...row,
    url: await resolveDocumentUrl(row.url) || row.url,
  })));
}

export function clearDocumentUrlCache() {
  signedUrlCache.clear();
}

export const documentBucket = DOCUMENT_BUCKET;
