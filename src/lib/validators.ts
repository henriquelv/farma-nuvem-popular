export const maskCPF = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})/, '$1-$2')
    .replace(/(-\d{2})\d+?$/, '$1');
};

export const maskDate = (value: string) => {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{4})\d+?$/, '$1');
};

export const maskDecimal = (value: string) => {
  const normalized = value.replace('.', ',').replace(/[^\d,]/g, '');
  const [integer = '', ...decimalParts] = normalized.split(',');
  const decimal = decimalParts.join('').slice(0, 2);
  return decimalParts.length > 0 ? `${integer},${decimal}` : integer;
};

export const sanitizePersonNameInput = (value: string) => value
  .replace(/[’`]/g, "'")
  .replace(/[^\p{L}\s.'-]/gu, '')
  .replace(/\s{2,}/g, ' ')
  .toLocaleUpperCase('pt-BR');

export const normalizePersonName = (value: string) => sanitizePersonNameInput(value)
  .replace(/\s+/g, ' ')
  .trim();

export const sanitizeDescriptionInput = (value: string) => value
  .replace(/[^\p{L}\p{N}\s.,/+()-]/gu, '')
  .replace(/\s{2,}/g, ' ');

export const parseDecimal = (value: string) => {
  if (!/^\d+(,\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export const isFutureDate = (date: string) => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return date > today;
};

export const validateCPF = (cpf: string) => {
  cpf = cpf.replace(/[^\d]+/g, '');
  if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
  let sum = 0, rest;
  for (let i = 1; i <= 9; i++) sum = sum + parseInt(cpf.substring(i - 1, i)) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cpf.substring(9, 10))) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum = sum + parseInt(cpf.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cpf.substring(10, 11))) {
    console.warn('CPF falhou no 2º dígito verificador');
    return false;
  }
  return true;
};

export const validateCPFWithWarning = (cpf: string) => {
  if (!validateCPF(cpf)) {
    return { valid: false, message: 'O algoritmo de validação não reconheceu este CPF. Tem certeza que está correto?' };
  }
  return { valid: true };
};

export const parseDateToDB = (dateStr: string) => {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
