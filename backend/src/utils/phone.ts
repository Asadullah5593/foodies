/**
 * Pakistani mobile format: 03XXXXXXXXX (11 digits) or +92 3XX XXXXXXX.
 * Accepts: 03001234567, 3001234567, +923001234567, +92 300 1234567
 */
function digitsOnly(phone: string): string {
    return phone.replace(/\D/g, '');
}

/** Returns normalized phone (03XXXXXXXXX) or null if invalid. */
export function normalizePakistaniPhone(phone: string): string | null {
    const trimmed = phone.trim();
    if (!trimmed) return null;
    const digits = digitsOnly(trimmed);
    // 10 digits starting with 3 (3XXXXXXXXX) or 11 starting with 03 (03XXXXXXXXX) or 12 with 923 (923XXXXXXXXX)
    if (digits.length === 10 && digits.startsWith('3')) {
        return '0' + digits;
    }
    if (digits.length === 11 && digits.startsWith('03')) {
        return digits;
    }
    if (digits.length === 12 && digits.startsWith('923')) {
        return '0' + digits.slice(2);
    }
    return null;
}

/** Throws if phone is not a valid Pakistani mobile. Returns normalized phone. */
export function validatePakistaniPhone(phone: string): string {
    const normalized = normalizePakistaniPhone(phone);
    if (!normalized) {
        throw new Error(
            'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
        );
    }
    return normalized;
}
