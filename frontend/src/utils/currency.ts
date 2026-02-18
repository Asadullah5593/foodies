/** Format amount as PKR (Rs.) for display */
export function formatCurrency(amount: number): string {
  return `Rs. ${Number(amount).toFixed(2)}`;
}
