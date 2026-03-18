/**
 * Build full URL for an image path returned by the API (e.g. /api/admin/upload/file/xxx).
 * Uses VITE_API_URL so images load from the backend origin.
 */
export function getImageFullUrl(path: string | null | undefined): string {
  if (!path || typeof path !== 'string') return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${path.startsWith('/') ? path : '/' + path}`;
}

/** Placeholder image for menu items when no image is uploaded (inline SVG). */
export const MENU_ITEM_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpolyline points='21 15 16 10 5 21'/%3E%3C/svg%3E";
