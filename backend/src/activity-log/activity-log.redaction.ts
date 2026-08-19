/**
 * Redaction — the highest-probability way this feature could do harm.
 *
 * The rule that makes it safe is structural, not a list: **request bodies are
 * filtered by a deny-list, responses and headers are allow-listed.** We never
 * copy a response wholesale, which is what stops `branches.service.ts` echoing
 * `fbr_token` into the audit table, and stops anything added to a response in
 * future from leaking by default.
 */

/** Redacted at ANY depth, matched case-insensitively on the key. */
const SECRET_KEYS = new Set([
    'password',
    'new_password',
    'newpassword',
    'current_password',
    'confirm_password',
    'owner_password',
    'password_confirmation',
    'id_token',
    'fbr_token',
    'token',
    'qr_token',
    'access_token',
    'refresh_token',
    'authorization',
    'secret',
    'client_secret',
    'api_key',
    'apikey',
    'kiosk_api_key',
    'cvv',
    'card_number',
    'pan',
]);

/**
 * `code` is a secret ONLY on the OTP routes. Everywhere else it is legitimate
 * audit data (`inventory_items.code`, coupon codes, branch codes), and blanket
 * redaction would gut the log's usefulness.
 */
const OTP_ROUTE_FRAGMENTS = [
    '/auth/verify-otp',
    '/auth/otp',
    '/consumer/auth/verify',
    '/consumer/auth/otp',
];

/** Response fields worth keeping. Everything else is dropped. */
const RESPONSE_ALLOW = [
    'id',
    'order_number',
    'order_group_id',
    'status',
    'count',
    'total',
];

/** Request headers worth keeping. Never `authorization`, never `cookie`. */
const HEADER_ALLOW = [
    'user-agent',
    'referer',
    'x-request-id',
    'x-session-id',
    'x-device-id',
    'x-client-platform',
];

export const REDACTED = '[redacted]';

const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_DIFF_BYTES = 16 * 1024;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 512;

export interface RedactionResult<T> {
    value: T | null;
    truncated: boolean;
}

function isSecretKey(key: string, otpRoute: boolean): boolean {
    const k = key.toLowerCase();
    if (SECRET_KEYS.has(k)) return true;
    if (otpRoute && k === 'code') return true;
    // Catch-alls for anything named like a credential without being on the list.
    return (
        k.endsWith('_password') ||
        k.endsWith('_secret') ||
        k.endsWith('_token') ||
        k.endsWith('_api_key')
    );
}

export function isOtpRoute(route: string | undefined): boolean {
    if (!route) return false;
    const r = route.toLowerCase();
    return OTP_ROUTE_FRAGMENTS.some((f) => r.includes(f));
}

/** Masks a phone/email while keeping enough to tell two values apart. */
export function maskPii(value: string): string {
    if (value.includes('@')) {
        const [user, domain] = value.split('@');
        const head = user.slice(0, 2);
        return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 7) {
        return `${value.slice(0, 3)}${'*'.repeat(Math.max(1, value.length - 6))}${value.slice(-3)}`;
    }
    return value;
}

const PII_KEYS = new Set([
    'phone',
    'phone_number',
    'mobile',
    'contact',
    'email',
    'customer_phone',
    'customer_email',
    'rider_phone',
]);

/**
 * Deep-clone a request payload with secrets removed, size bounded, and (when
 * `piiMask` is on) contact details masked.
 *
 * Never throws: a payload we cannot walk becomes `null` rather than an error on
 * the response path.
 */
export function redactPayload(
    input: unknown,
    opts: { route?: string; piiMask?: boolean } = {},
): RedactionResult<Record<string, unknown>> {
    const otpRoute = isOtpRoute(opts.route);
    const piiMask = opts.piiMask !== false;
    let truncated = false;

    const walk = (value: unknown, depth: number, key?: string): unknown => {
        if (value === null || value === undefined) return value ?? null;
        if (depth > MAX_DEPTH) {
            truncated = true;
            return '[depth-limited]';
        }
        if (key !== undefined && isSecretKey(key, otpRoute)) return REDACTED;

        if (typeof value === 'string') {
            let out = value;
            if (piiMask && key && PII_KEYS.has(key.toLowerCase())) {
                out = maskPii(out);
            }
            if (out.length > MAX_STRING) {
                truncated = true;
                return `${out.slice(0, MAX_STRING)}…`;
            }
            return out;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (value instanceof Date) return value.toISOString();
        // Never store file buffers — metadata only (multipart uploads).
        if (Buffer.isBuffer(value)) {
            truncated = true;
            return `[binary ${value.length} bytes]`;
        }
        if (Array.isArray(value)) {
            const capped = value.slice(0, MAX_ARRAY);
            if (capped.length < value.length) truncated = true;
            return capped.map((v) => walk(v, depth + 1));
        }
        if (typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(
                value as Record<string, unknown>,
            )) {
                out[k] = walk(v, depth + 1, k);
            }
            return out;
        }
        // Functions, symbols, bigints: not audit data.
        return null;
    };

    try {
        const walked = walk(input, 0);
        if (walked === null || typeof walked !== 'object') {
            return { value: null, truncated };
        }
        const result = walked as Record<string, unknown>;
        const json = JSON.stringify(result);
        if (json && Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) {
            return {
                value: { _truncated: true, _bytes: Buffer.byteLength(json) },
                truncated: true,
            };
        }
        return { value: result, truncated };
    } catch {
        return { value: null, truncated: true };
    }
}

/**
 * Allow-listed pick from a response. The point is that adding a field to any
 * API response can never leak it into the audit log.
 */
export function pickResponseMeta(
    body: unknown,
): Record<string, unknown> | null {
    if (!body || typeof body !== 'object') return null;
    const source = Array.isArray(body)
        ? { count: body.length }
        : (body as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const key of RESPONSE_ALLOW) {
        const v = source[key];
        if (v === undefined || v === null) continue;
        if (
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean'
        ) {
            out[key] = v;
        }
    }
    return Object.keys(out).length ? out : null;
}

/** Allow-listed headers. `authorization` and `cookie` can never be captured. */
export function pickHeaders(
    headers: Record<string, unknown>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of HEADER_ALLOW) {
        const v = headers[key];
        if (typeof v === 'string') out[key] = v.slice(0, 400);
    }
    return out;
}

/**
 * Money arrives from TypeORM as strings (`decimal`), so `'12.00'` vs `12` would
 * show up as a change on every save. Normalise before comparing.
 */
function normalise(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') {
        // Only treat it as numeric when it round-trips exactly.
        const trimmed = value.trim();
        if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
            const n = Number(trimmed);
            if (Number.isFinite(n)) return n;
        }
        return value;
    }
    return value;
}

export interface DiffResult {
    changes: Record<string, { before: unknown; after: unknown }> | null;
    changedFields: string[];
    truncated: boolean;
}

/**
 * Field-level diff of two snapshots, with secrets reduced to a marker: a
 * password change must be visible as an event without the values ever landing
 * in the table.
 */
export function diffSnapshots(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    opts: { route?: string; piiMask?: boolean } = {},
): DiffResult {
    if (!before && !after) {
        return { changes: null, changedFields: [], truncated: false };
    }
    const otpRoute = isOtpRoute(opts.route);
    const piiMask = opts.piiMask !== false;
    const keys = new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
    ]);
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const changedFields: string[] = [];

    for (const key of keys) {
        if (key === 'updatedAt' || key === 'updated_at') continue;
        const b = normalise(before?.[key]);
        const a = normalise(after?.[key]);
        if (JSON.stringify(b) === JSON.stringify(a)) continue;

        if (isSecretKey(key, otpRoute)) {
            changes[key] = { before: '[changed]', after: '[changed]' };
        } else if (piiMask && PII_KEYS.has(key.toLowerCase())) {
            changes[key] = {
                before: typeof b === 'string' ? maskPii(b) : b,
                after: typeof a === 'string' ? maskPii(a) : a,
            };
        } else {
            changes[key] = { before: b ?? null, after: a ?? null };
        }
        changedFields.push(key);
    }

    if (!changedFields.length) {
        return { changes: null, changedFields: [], truncated: false };
    }

    const json = JSON.stringify(changes);
    if (json && Buffer.byteLength(json) > MAX_DIFF_BYTES) {
        return {
            changes: { _truncated: { before: null, after: null } },
            changedFields,
            truncated: true,
        };
    }
    return { changes, changedFields, truncated: false };
}
