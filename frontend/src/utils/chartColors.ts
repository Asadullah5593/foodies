/**
 * Shared chart palette + helpers for the admin dashboard.
 * Anchored on the `foodies` red theme with complementary hues.
 */
export const CHART_COLORS = [
  '#DC2626', // foodies red
  '#2563EB', // blue
  '#059669', // emerald
  '#D97706', // amber
  '#7C3AED', // violet
  '#0891B2', // cyan
  '#DB2777', // pink
  '#65A30D', // lime
];

export const REVENUE_COLOR = '#DC2626';
export const ORDERS_COLOR = '#2563EB';

/** Colors for known order statuses (falls back to palette by index). */
export const STATUS_COLORS: Record<string, string> = {
  placed: '#6366F1',
  accepted: '#0891B2',
  preparing: '#D97706',
  ready: '#7C3AED',
  completed: '#059669',
  cancelled: '#DC2626',
};

/** Colors for delivery sub-statuses. */
export const DELIVERY_STATUS_COLORS: Record<string, string> = {
  unassigned: '#94A3B8',
  accepted: '#0891B2',
  picked_up: '#D97706',
  delivered: '#059669',
  delivery_failed: '#DC2626',
};

export function colorFor(key: string, index: number): string {
  return STATUS_COLORS[key] ?? CHART_COLORS[index % CHART_COLORS.length];
}

/** Tooltip container style that reads cleanly on both light and dark. */
export function tooltipStyle(theme: 'light' | 'dark'): React.CSSProperties {
  return theme === 'dark'
    ? {
        background: '#1F2937',
        border: '1px solid #374151',
        borderRadius: 8,
        color: '#F8FAFC',
        fontSize: 12,
      }
    : {
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        color: '#0F172A',
        fontSize: 12,
      };
}

/** Axis / grid stroke that works on both themes. */
export function axisColor(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#64748B' : '#94A3B8';
}

export function gridColor(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#334155' : '#E2E8F0';
}
