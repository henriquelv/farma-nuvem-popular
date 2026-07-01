import { addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';

export type PrescriptionMeta = {
  name: string;
  inicio: string;
  vencimento: string;
};

const META_PREFIX = 'META::';

export const isPdfDocument = (url = '', name = '') => {
  const value = `${url} ${name}`.toLowerCase();
  return value.includes('.pdf') || value.includes('application/pdf');
};

export const buildPrescriptionMeta = (name: string, inicio: string) => {
  const vencimento = format(addMonths(parseISO(`${inicio}T12:00:00`), 6), 'yyyy-MM-dd');
  return `${META_PREFIX}${JSON.stringify({ name, inicio, vencimento })}`;
};

export const parsePrescriptionMeta = (doc: any): PrescriptionMeta => {
  const raw = String(doc?.nome_arquivo || '');

  if (raw.startsWith(META_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(META_PREFIX.length));
      if (parsed?.inicio && parsed?.vencimento) {
        return {
          name: parsed.name || 'Receita',
          inicio: parsed.inicio,
          vencimento: parsed.vencimento,
        };
      }
    } catch {
      // Falls back to dates below for older rows.
    }
  }

  const createdAt = doc?.created_at ? new Date(doc.created_at) : new Date();
  const inicio = format(createdAt, 'yyyy-MM-dd');
  const vencimento = format(addMonths(createdAt, 6), 'yyyy-MM-dd');
  return {
    name: raw || 'Receita',
    inicio,
    vencimento,
  };
};

export const getDocumentName = (doc: any) => {
  const raw = String(doc?.nome_arquivo || '');
  if (!raw.startsWith(META_PREFIX)) return raw || 'Documento';
  return parsePrescriptionMeta(doc).name;
};

export const getPrescriptionStatus = (doc: any) => {
  const meta = parsePrescriptionMeta(doc);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiresAt = parseISO(`${meta.vencimento}T12:00:00`);
  const daysLeft = differenceInCalendarDays(expiresAt, today);

  return {
    ...meta,
    vencida: daysLeft < 0,
    diasRestantes: daysLeft,
  };
};

export const getLatestPrescription = (docs: any[]) => {
  const receitas = docs.filter((doc) => doc.tipo === 'receita');
  if (!receitas.length) return null;

  return [...receitas].sort((a, b) => {
    const aMeta = parsePrescriptionMeta(a);
    const bMeta = parsePrescriptionMeta(b);
    return bMeta.inicio.localeCompare(aMeta.inicio);
  })[0];
};

export const formatDateBR = (date: string) => {
  if (!date) return '-';
  return parseISO(`${date}T12:00:00`).toLocaleDateString('pt-BR');
};

export const getPrescriptionEndDate = (inicio: string) => {
  if (!inicio) return '';
  return format(addMonths(parseISO(`${inicio}T12:00:00`), 6), 'yyyy-MM-dd');
};
