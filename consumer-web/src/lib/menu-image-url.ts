/**
 * Menu item image variants on S3 (see backend media/menu-image-variants.ts).
 * Canonical URL = display (~960w). Siblings: *_w320.jpg, *_w1400.jpg.
 */
export type MenuImageSize = "thumb" | "display" | "full";

const THUMB_SUFFIX = "_w320";
const FULL_SUFFIX = "_w1400";
const VARIANT_EXT = ".jpg";

export function menuImageUrl(
  pathOrUrl: string | null | undefined,
  size: MenuImageSize = "display",
): string {
  const trimmed = pathOrUrl?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) return trimmed;
  if (size === "display") return trimmed;

  const match = trimmed.match(/^(.+)(\.[a-zA-Z0-9]+)$/);
  if (!match) return trimmed;

  const base = match[1];
  const suffix = size === "thumb" ? THUMB_SUFFIX : FULL_SUFFIX;
  return `${base}${suffix}${VARIANT_EXT}`;
}

/** Apply variant sizing after resolving API path to absolute URL. */
export function toMenuImageUrl(
  pathOrUrl: string | null | undefined,
  toAbsolute: (raw: string) => string,
  size: MenuImageSize = "display",
): string {
  const raw = pathOrUrl?.trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  const absolute = toAbsolute(raw);
  return menuImageUrl(absolute, size);
}
