/**
 * Comprime imagens no navegador antes do upload para reduzir drasticamente
 * o consumo de Supabase Storage. Um scan de documento comum de 8-15 MB
 * passa a ocupar ~100-800 KB mantendo legibilidade para fins fiscais.
 */

export type CompressOptions = {
  maxWidthOrHeight?: number;
  quality?: number;
  outputType?: 'image/jpeg' | 'image/webp';
};

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_OPTIONS: Required<CompressOptions> = {
  maxWidthOrHeight: 1280,
  quality: 0.75,
  outputType: 'image/jpeg',
};

function getFileNameWithoutExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Tenta comprimir uma imagem via Canvas.
 * - Só processa arquivos com MIME type de imagem.
 * - Redimensiona mantendo proporção.
 * - Se a versão comprimida for maior que a original, retorna original.
 * - Se falhar, retorna original — nunca quebra o fluxo.
 */
export async function compressImage(
  file: File,
  options?: CompressOptions
): Promise<{ file: File; originalSize: number; finalSize: number; compressed: boolean }> {
  const { maxWidthOrHeight, quality, outputType } = { ...DEFAULT_OPTIONS, ...options };
  const isImage = IMAGE_MIME_TYPES.includes(file.type);
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isImage || isPdf) {
    return { file, originalSize: file.size, finalSize: file.size, compressed: false };
  }

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;

    const ratio = Math.min(maxWidthOrHeight / width, maxWidthOrHeight / height, 1);
    if (ratio >= 1) {
      bitmap.close();
      return { file, originalSize: file.size, finalSize: file.size, compressed: false };
    }

    width = Math.round(width * ratio);
    height = Math.round(height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return { file, originalSize: file.size, finalSize: file.size, compressed: false };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        outputType,
        quality
      );
    });

    if (!blob || blob.size >= file.size) {
      return { file, originalSize: file.size, finalSize: file.size, compressed: false };
    }

    const ext = outputType === 'image/jpeg' ? '.jpg' : '.webp';
    const name = getFileNameWithoutExt(file.name) + ext;
    const compressedFile = new File([blob], name, { type: outputType });

    return { file: compressedFile, originalSize: file.size, finalSize: blob.size, compressed: true };
  } catch {
    return { file, originalSize: file.size, finalSize: file.size, compressed: false };
  }
}

/**
 * Valida o tamanho do arquivo antes do upload.
 * - Imagens comprimidas: máximo 5 MB (após compressão idealmente < 1 MB)
 * - PDFs: máximo 10 MB
 * Retorna null se OK, ou string de erro se bloquear.
 */
export function validateFileSize(file: File, maxSizeMB: number = 5): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const limitMB = isPdf ? 10 : maxSizeMB;
  if (file.size > limitMB * 1024 * 1024) {
    return `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Limite: ${limitMB} MB. Envie uma imagem comprimida ou um PDF menor.`;
  }
  return null;
}