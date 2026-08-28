const PHARMACY_LOGIN_DOMAIN = 'acesso.farmanv.com.br';
const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/;

export function normalizePharmacyLogin(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._@-]/g, '');
}

export function pharmacyLoginToEmail(value: string) {
  const normalized = normalizePharmacyLogin(value);
  if (normalized.includes('@')) return normalized;
  if (!LOGIN_PATTERN.test(normalized)) throw new Error('Login da farmácia inválido.');
  return `${normalized}@${PHARMACY_LOGIN_DOMAIN}`;
}

export function isValidPharmacyLogin(value: string) {
  try {
    const email = pharmacyLoginToEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  } catch {
    return false;
  }
}

export const pharmacyLoginDomain = PHARMACY_LOGIN_DOMAIN;
