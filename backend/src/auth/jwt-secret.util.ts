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

/**
 * How long a STAFF token stays valid. Short because a token is the only thing
 * standing between a leaked laptop and the till: there is no refresh flow and
 * no revocation list, so a token lives out its full life no matter what happens
 * to the account behind it — deactivating a user does not end their session.
 *
 * A day covers any single shift, so a till that logs in at open is never asked
 * again before close. Tunable by env for an operator who needs otherwise, but
 * capped: a week was the old value and it is too long to be worth keeping.
 *
 * Customer tokens are issued separately (consumer.module.ts) and are NOT
 * governed by this — shortening those would sign shoppers out of the app.
 */
export type StaffTokenTtl =
    | `${number}s`
    | `${number}m`
    | `${number}h`
    | `${number}d`;

export function getStaffTokenTtl(): StaffTokenTtl {
    const raw = (process.env.JWT_EXPIRES_IN ?? '').trim();
    if (!raw) return '24h';
    // Accept only a plain <number><unit> the jsonwebtoken library understands,
    // so a typo cannot silently become an unlimited token.
    if (!/^\d+(s|m|h|d)$/.test(raw)) {
        throw new Error(
            `JWT_EXPIRES_IN must look like "30m", "24h" or "7d" — got "${raw}".`,
        );
    }
    return raw as StaffTokenTtl;
}
