export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRequirement = {
  id: string;
  label: string;
  met: boolean;
};

export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH} caracteres ou mais`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'uppercase', label: 'Uma letra maiúscula', met: /[A-Z]/.test(password) },
    { id: 'lowercase', label: 'Uma letra minúscula', met: /[a-z]/.test(password) },
    { id: 'number', label: 'Um número', met: /\d/.test(password) },
    { id: 'symbol', label: 'Um símbolo', met: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function validatePassword(password: string) {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  const missing = getPasswordRequirements(password).filter((requirement) => !requirement.met);
  if (missing.length > 0) return 'A senha ainda não atende a todos os requisitos de segurança.';
  return '';
}

