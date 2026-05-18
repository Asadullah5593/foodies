/** Consumer-facing menu image variant widths (upload + backfill). */
export const MENU_IMAGE_VARIANT_WIDTHS = {
    thumb: 320,
    display: 960,
    full: 1400,
} as const;

export const MENU_VARIANT_SUFFIX = {
    thumb: '_w320',
    full: '_w1400',
} as const;

/** Variant files are always stored as JPEG. */
export const MENU_VARIANT_EXT = '.jpg';

/** Insert `_w320` / `_w1400` before extension; display uses the canonical URL unchanged. */
export function menuItemVariantUrl(
    canonicalUrl: string,
    size: 'thumb' | 'display' | 'full',
): string {
    const trimmed = canonicalUrl?.trim();
    if (!trimmed || size === 'display') return trimmed;

    const match = trimmed.match(/^(.+)(\.[a-zA-Z0-9]+)$/);
    if (!match) return trimmed;

    const base = match[1];
    const suffix =
        size === 'thumb' ? MENU_VARIANT_SUFFIX.thumb : MENU_VARIANT_SUFFIX.full;
    return `${base}${suffix}${MENU_VARIANT_EXT}`;
}

/** S3 keys for variant siblings of a canonical menu-items object key. */
export function menuItemVariantKeys(baseKey: string): {
    thumb: string;
    full: string;
} {
    const dot = baseKey.lastIndexOf('.');
    const base = dot >= 0 ? baseKey.slice(0, dot) : baseKey;
    return {
        thumb: `${base}${MENU_VARIANT_SUFFIX.thumb}${MENU_VARIANT_EXT}`,
        full: `${base}${MENU_VARIANT_SUFFIX.full}${MENU_VARIANT_EXT}`,
    };
}

/** True if key is a generated variant (not a canonical base object). */
export function isMenuItemVariantKey(key: string): boolean {
    const name = key.split('/').pop() ?? key;
    return (
        name.includes(MENU_VARIANT_SUFFIX.thumb) ||
        name.includes(MENU_VARIANT_SUFFIX.full)
    );
}
