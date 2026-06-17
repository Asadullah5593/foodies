/**
 * Normalizes FIREBASE_PRIVATE_KEY from .env (common deployment formats).
 */
export function normalizeFirebasePrivateKey(
    raw: string | undefined,
): string | null {
    if (raw == null) return null;

    let key = raw.trim();
    if (!key) return null;

    // Strip wrapping quotes from .env (single or double)
    if (
        (key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))
    ) {
        key = key.slice(1, -1);
    }

    // Literal \n from JSON / .env one-liner
    key = key.replace(/\\n/g, '\n');

    // Sometimes only the middle of the PEM is pasted without headers
    if (!key.includes('BEGIN PRIVATE KEY')) {
        const body = key.replace(/\s+/g, '');
        if (body.length > 0) {
            key = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
        }
    }

    return key.trim() || null;
}
