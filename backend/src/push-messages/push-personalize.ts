/**
 * Personal touches in a push message: `{first_name}`, `{name}`,
 * `{app_points}`, `{last_brand}`, each with an optional fallback after a bar —
 * "Hi {first_name|there}". A placeholder with no value and no fallback
 * disappears, and the doubled space it leaves is tidied up.
 */

export interface PersonalValues {
    name?: string | null;
    app_points?: number | null;
    last_brand?: string | null;
}

export const PERSONAL_TOKENS: Array<{
    key: string;
    label: string;
    example: string;
}> = [
    { key: 'first_name', label: 'First name', example: 'Ali' },
    { key: 'name', label: 'Full name', example: 'Ali Raza' },
    { key: 'app_points', label: 'App points balance', example: '450' },
    { key: 'last_brand', label: 'Brand of last order', example: 'Wok & Go' },
];

const TOKEN_RE = /\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}/g;

function firstName(name: string | null | undefined): string {
    const n = (name ?? '').trim();
    if (!n) return '';
    return n.split(/\s+/)[0];
}

function valueOf(key: string, v: PersonalValues): string {
    switch (key) {
        case 'first_name':
            return firstName(v.name);
        case 'name':
            return (v.name ?? '').trim();
        case 'app_points':
            return v.app_points != null
                ? Math.floor(Number(v.app_points)).toLocaleString('en-US')
                : '';
        case 'last_brand':
            return (v.last_brand ?? '').trim();
        default:
            return '';
    }
}

/** Fill the placeholders in `text` for one customer. */
export function personalize(text: string, values: PersonalValues): string {
    const out = text.replace(
        TOKEN_RE,
        (whole, key: string, fallback?: string) => {
            if (!PERSONAL_TOKENS.some((t) => t.key === key)) return whole;
            const v = valueOf(key, values);
            return v || (fallback ?? '').trim();
        },
    );
    return out
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.!?])/g, '$1')
        .trim();
}

/** Does the text use any placeholder (so each customer needs their own copy)? */
export function hasPlaceholders(text: string): boolean {
    return [...text.matchAll(TOKEN_RE)].some((m) =>
        PERSONAL_TOKENS.some((t) => t.key === m[1]),
    );
}

/** Placeholders the text uses that we do not know — shown as a warning. */
export function unknownPlaceholders(text: string): string[] {
    return [...text.matchAll(TOKEN_RE)]
        .map((m) => m[1])
        .filter((k) => !PERSONAL_TOKENS.some((t) => t.key === k));
}
