/** Format amount as PKR (Rs.) for display */
export function formatCurrency(amount: number): string {
  return `Rs. ${Number(amount).toFixed(2)}`;
}

/** Tax line label with the GST rate (fraction, e.g. 0.16 → "Tax (16%)"); just "Tax" when unknown. */
export function taxLabel(rate?: number | null): string {
  const pct = Number(rate ?? 0) * 100;
  if (!(pct > 0)) return 'Tax';
  return `Tax (${Number(pct.toFixed(2))}%)`;
}
