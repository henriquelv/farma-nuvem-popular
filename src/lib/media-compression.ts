/**
 * Otimização automática de documentos (imagens e PDFs escaneados)
 * antes do upload para o Supabase Storage.
 *
 * O usuário escaneia normalmente (qualquer DPI, cor, formato) e o
 * sistema reduz o tamanho automaticamente mantendo legibilidade.
 *
 * Para referência: scans comuns de 8-15 MB caem para ~100-800 KB.
 */

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// Configura o worker do pdfjs (CDN, compatível com Vite bundler)
GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs`;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ImageOptions = {
  maxWidthOrHeight?: number;
  quality?: number;
  outputType?: 'image/jpeg' | 'image/webp';
};

export type PdfOptions = {
  maxWidthOrHeight?: number;
  jpegQuality?: number;
};

export type DocumentResult = {
  file: File;
  originalSize: number;
  finalSize: number;
  optimized: boolean;
  optimizationType: 'image-compression' | 'pdf-compression' | 'none';
};

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function getFileNameWithoutExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function logStats(file: File, result: DocumentResult): void {
  if (process.env.NODE_ENV === 'development') {
    const reduction = result.optimized
      ? ` (-${Math.round((1 - result.finalSize / result.originalSize) * 100)}%)`
      : ' (sem otimização)';
    console.log(
      `📄 ${file.name} | ${file.type} | ${(result.originalSize / 1024).toFixed(1)} KB → ${(result.finalSize / 1024).toFixed(1)} KB${reduction} | ${result.optimizationType}`
    );
  }
}

// ─── Tarefa 1: compressImage ────────────────────────────────────────────────

/**
 * Comprime imagem via Canvas.
 * - Redimensiona mantendo proporção (padrão 1800 px).
 * - Converte para JPEG quality 0.78.
 * - Se a versão comprimida for maior, mantém original.
 * - Retorna original em caso de erro — nunca quebra o fluxo.
 */
async function compressImage(
  file: File,
  options?: ImageOptions
): Promise<DocumentResult> {
  const maxWidthOrHeight = options?.maxWidthOrHeight ?? 1800;
  const quality = options?.quality ?? 0.78;
  const outputType = options?.outputType ?? 'image/jpeg';

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;

    const ratio = Math.min(maxWidthOrHeight / width, maxWidthOrHeight / height, 1);
    if (ratio >= 1) {
      bitmap.close();
      return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
    }

    width = Math.round(width * ratio);
    height = Math.round(height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), outputType, quality);
    });

    if (!blob || blob.size >= file.size) {
      return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
    }

    const ext = '.jpg';
    const name = getFileNameWithoutExt(file.name) + ext;
    const compressedFile = new File([blob], name, { type: outputType });

    return { file: compressedFile, originalSize: file.size, finalSize: blob.size, optimized: true, optimizationType: 'image-compression' };
  } catch {
    return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
  }
}

// ─── Tarefa 2: optimizeScannedPdf ───────────────────────────────────────────

/**
 * Otimiza PDF escaneado renderizando cada página como imagem JPEG e
 * recriando um novo PDF. Útil para PDFs vindos de scanner que são
 * basicamente fotos encapsuladas em PDF.
 *
 * Se falhar (arquivo corrompido, muitas páginas, falta de memória),
 * retorna o original com optimizationType='none'.
 */
async function optimizeScannedPdf(
  file: File,
  options?: PdfOptions
): Promise<DocumentResult> {
  const maxWidthOrHeight = options?.maxWidthOrHeight ?? 1800;
  const jpegQuality = options?.jpegQuality ?? 0.78;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: arrayBuffer }).promise;

    // Limite técnico: se tiver mais de 50 páginas, não tenta otimizar
    if (pdf.numPages > 50) {
      pdf.destroy();
      return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
    }

    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'px', format: [maxWidthOrHeight, maxWidthOrHeight * 1.4] });

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });

      // Redimensionar mantendo proporção
      const scale = Math.min(maxWidthOrHeight / viewport.width, maxWidthOrHeight / viewport.height);
      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        continue;
      }

      await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
      page.cleanup();

      const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);

      if (i === 1) {
        doc.addImage(dataUrl, 'JPEG', 0, 0, scaledViewport.width, scaledViewport.height, undefined, 'FAST');
      } else {
        doc.addPage([scaledViewport.width, scaledViewport.height]);
        doc.addImage(dataUrl, 'JPEG', 0, 0, scaledViewport.width, scaledViewport.height, undefined, 'FAST');
      }

      // Limpeza de memória
      canvas.width = 0;
      canvas.height = 0;
    }

    pdf.destroy();

    const pdfBlob = doc.output('blob');
    const optimizedFile = new File([pdfBlob], getFileNameWithoutExt(file.name) + '.pdf', { type: 'application/pdf' });

    // Se ficou maior que o original, mantém original
    if (pdfBlob.size >= file.size) {
      return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
    }

    return { file: optimizedFile, originalSize: file.size, finalSize: pdfBlob.size, optimized: true, optimizationType: 'pdf-compression' };
  } catch {
    return { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
  }
}

// ─── Tarefa 3: prepareDocumentForUpload (função centralizada) ────────────────

export type PrepareStatus = 'preparing' | 'optimizing' | 'uploading' | 'done';

export type PrepareCallback = (status: PrepareStatus) => void;

/**
 * Função única de preparação de documentos para upload.
 * - Imagens: compressImage
 * - PDFs: optimizeScannedPdf (com fallback)
 * - Outros: mantém original
 *
 * @param file Arquivo original selecionado pelo usuário
 * @param onStatus Callback opcional para feedback de UI
 */
export async function prepareDocumentForUpload(
  file: File,
  onStatus?: PrepareCallback
): Promise<DocumentResult> {
  onStatus?.('preparing');

  const isImage = IMAGE_MIME_TYPES.includes(file.type);
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  let result: DocumentResult;

  if (isImage) {
    onStatus?.('optimizing');
    result = await compressImage(file);
  } else if (isPdf) {
    onStatus?.('optimizing');
    result = await optimizeScannedPdf(file);
  } else {
    result = { file, originalSize: file.size, finalSize: file.size, optimized: false, optimizationType: 'none' };
  }

  onStatus?.('uploading');

  if (process.env.NODE_ENV === 'development') {
    logStats(file, result);
  }

  return result;
}

// ─── Tarefa 4: Limite técnico generoso (fallback para casos extremos) ────────

/**
 * Verifica se o arquivo é razoável para processamento no navegador.
 * Retorna null se ok, ou mensagem amigável se bloquear.
 *
 * Limites generosos:
 * - Arquivos > 100 MB são rejeitados (evita trava do navegador)
 * - PDFs com mais de 100 páginas são rejeitados (limite de memória)
 *
 * A mensagem é amigável e não técnica.
 */
export async function checkFileFeasibility(file: File): Promise<string | null> {
  if (file.size > 100 * 1024 * 1024) {
    return 'Não foi possível otimizar este arquivo automaticamente. Tente dividir o documento em menos páginas ou enviar outro arquivo.';
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const buf = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
      const pdf = await getDocument({ data: buf }).promise;
      const pages = pdf.numPages;
      pdf.destroy();
      if (pages > 100) {
        return 'Não foi possível otimizar este arquivo automaticamente. Tente dividir o documento em menos páginas ou enviar outro arquivo.';
      }
    } catch {
      // Não conseguiu ler o PDF — deixa passar, o optimize vai falhar com fallback seguro
    }
  }

  return null;
}

// ─── TODO de segurança (Tarefa 8) ────────────────────────────────────────────
/*
 * @security O bucket "documentos" do Supabase está público (acesso anônimo).
 * Os arquivos podem conter CPF, identidade, receitas e dados pessoais dos pacientes.
 *
 * TODO: Migrar para bucket privado + signed URLs em produção.
 * A migração exige alterar a política de RLS, criar endpoints de signed URL
 * no backend e substituir as URLs públicas nos componentes de visualização.
 * O app atual depende de acesso público para exibir documentos no frontend.
 */