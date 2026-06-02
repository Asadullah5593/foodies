/**
 * Single source of truth for the JWT signing/verification secret.
 *
 * Fails fast at startup if JWT_SECRET is missing or still set to the old
 * public placeholder, so the app can never silently run on a forgeable secret.
 */
const INSECURE_DEFAULTS = new Set([
    '',
    'rough-foodie-secret-change-in-production',
    'secret',
    'changeme',
]);

export function getJwtSecret(): string {
    const secret = (process.env.JWT_SECRET ?? '').trim();
    if (INSECURE_DEFAULTS.has(secret) || secret.length < 32) {
        throw new Error(
            'JWT_SECRET is missing, too short, or set to a known insecure default. ' +
                'Set a strong (>=32 char) random JWT_SECRET in the environment before starting.',
        );
    }
    return secret;
}
