/**
 * Foodies brand theme (from logo: black/white + red accent).
 * Light by default; dark values for optional dark mode.
 */
export const foodiesTheme = {
  light: {
    primary: '#B91C1C',       // red-700 accent
    surface: '#FFFFFF',
    surfaceMuted: '#F8FAFC', // slate-50
    textPrimary: '#0F172A',  // slate-900
    textSecondary: '#64748B', // slate-500
    border: '#E2E8F0',       // slate-200
    /** CTA / Create Order button (logo red) */
    cta: '#DC2626',         // red-600
    ctaHover: '#B91C1C',    // red-700
  },
  dark: {
    primary: '#B91C1C',
    surface: '#1F2937',     // gray-800
    surfaceMuted: '#111827', // gray-900
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    border: '#374151',      // gray-700
    cta: '#DC2626',
    ctaHover: '#B91C1C',
  },
} as const;

export type FoodiesThemeMode = 'light' | 'dark';
