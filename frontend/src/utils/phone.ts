/**
 * Pakistani mobile: 03XXXXXXXXX (11 digits). Accepts 03001234567, 3001234567, +923001234567.
 */
const DIGITS_ONLY = /^\d+$/;

export function normalizePakistaniPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return '0' + digits;
  if (digits.length === 11 && digits.startsWith('03')) return digits;
  if (digits.length === 12 && digits.startsWith('923')) return '0' + digits.slice(2);
  return null;
}

export function validatePakistaniPhone(input: string): string {
  const normalized = normalizePakistaniPhone(input);
  if (!normalized) {
    throw new Error('Invalid Pakistani phone. Use format: 03XXXXXXXXX (e.g. 03001234567)');
  }
  return normalized;
}

export const PAKISTANI_PHONE_PLACEHOLDER = '03001234567';
