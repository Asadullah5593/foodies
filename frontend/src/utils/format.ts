/** Display label for order type (no underscores, title case) */
export function formatOrderType(value: string | undefined | null): string {
  if (value == null || value === '') return '—';
  const map: Record<string, string> = {
    dine_in: 'Dine in',
    takeaway: 'Takeaway',
    pickup: 'Pickup',
    delivery: 'Delivery',
  };
  return map[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
