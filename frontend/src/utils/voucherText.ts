import { PrintedVoucherType } from '../types';

/** Rupees without pointless decimals: "Rs 999", "Rs 1,499", "Rs 349.50". */
export function rupees(amount: number): string {
  const n = Number(amount) || 0;
  return `Rs ${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** What a printed voucher is worth, as printed on it: "Rs 999" or "30% off". */
export function voucherFace(v: { voucher_type: PrintedVoucherType | string; value: number }): string {
  return v.voucher_type === 'percentage' ? `${Number(v.value)}% off` : rupees(v.value);
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  pickup: 'Takeaway',
  dine_in: 'Dine-in',
};

/** "Takeaway, Dine-in"; null/empty = every order type. */
export function voucherOrderTypesText(orderTypes: string[] | null | undefined): string {
  if (!orderTypes || orderTypes.length === 0) return 'All order types';
  return orderTypes.map((t) => ORDER_TYPE_LABELS[t] ?? t).join(', ');
}

/** "30 Nov 2026" from 'YYYY-MM-DD' (no timezone shift: it is a calendar day). */
export function prettyDay(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  if (!m) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Until 30 Nov 2026", "1 Oct 2026 – 30 Nov 2026", "From 1 Oct 2026", or "No end date". */
export function voucherValidityText(validFrom: string | null | undefined, validUntil: string | null | undefined): string {
  const from = prettyDay(validFrom);
  const until = prettyDay(validUntil);
  if (from && until) return `${from} – ${until}`;
  if (until) return `Until ${until}`;
  if (from) return `From ${from}`;
  return 'No end date';
}
