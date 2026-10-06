import React from 'react';
import { TillVoucher, VoucherPick } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import { voucherFace } from '../../../utils/voucherText';

export type VoucherPickerProps = {
  vouchers: TillVoucher[];
  /** The vouchers on the cart, with how many papers of each. */
  picks: VoucherPick[];
  onChange: (picks: VoucherPick[]) => void;
  /** Per voucher, what the live quote says it took off. */
  breakdown?: Array<{ voucher_id: number; quantity: number; discount_amount: number }>;
  /** Rupees the vouchers took off together, from the live quote. */
  appliedAmount?: number;
  /** True once the quote confirms the vouchers are what priced the cart. */
  applied?: boolean;
  /** Server's reason they cannot be used on this cart. */
  error?: string | null;
  disabled?: boolean;
};

/**
 * Printed vouchers (the paper coupon book) on the POS checkout. The cashier
 * taps a voucher once per paper the customer handed over: three pizza
 * vouchers for three pizzas. Fixed-price vouchers combine; a percentage
 * voucher stands alone, so tapping it clears the others and vice versa. Any
 * voucher replaces every other discount.
 *
 * The list is what the SERVER says can be used on this order — the cart's
 * brand, this branch, this order type, today — and it is empty without
 * `printed-vouchers:apply`, so an unauthorized till sees no control at all.
 * Whether the cart *qualifies* comes back through the quote, which is why a
 * picked voucher can still read "not applied".
 */
const VoucherPicker: React.FC<VoucherPickerProps> = ({
  vouchers,
  picks,
  onChange,
  breakdown = [],
  appliedAmount = 0,
  applied = false,
  error,
  disabled = false,
}) => {
  if (vouchers.length === 0) return null;

  const quantityOf = (id: number) => picks.find((p) => p.id === id)?.quantity ?? 0;
  const nameOf = (id: number) => vouchers.find((v) => v.id === id)?.name ?? 'Voucher';

  const addPaper = (v: TillVoucher) => {
    if (v.voucher_type === 'percentage') {
      // Stands alone: a second tap takes it off again.
      onChange(quantityOf(v.id) > 0 ? [] : [{ id: v.id, quantity: 1 }]);
      return;
    }
    // A fixed price joins the other fixed prices, but never a percentage voucher.
    const kept = picks.filter((p) => vouchers.find((x) => x.id === p.id)?.voucher_type !== 'percentage');
    const current = kept.find((p) => p.id === v.id);
    onChange(
      current
        ? kept.map((p) => (p.id === v.id ? { ...p, quantity: p.quantity + 1 } : p))
        : [...kept, { id: v.id, quantity: 1 }],
    );
  };
  const removePaper = (id: number) =>
    onChange(
      picks
        .map((p) => (p.id === id ? { ...p, quantity: p.quantity - 1 } : p))
        .filter((p) => p.quantity > 0),
    );

  const papers = picks.reduce((s, p) => s + p.quantity, 0);
  const picked = picks.filter((p) => p.quantity > 0);
  const amountOf = (id: number) => breakdown.find((b) => b.voucher_id === id)?.discount_amount ?? 0;

  return (
    <div>
      <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
        Printed vouchers{' '}
        <span className="font-normal text-foodies-textSecondary">(tap once per paper handed over)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {vouchers.map((v) => {
          const quantity = quantityOf(v.id);
          const active = quantity > 0;
          return (
            <div key={v.id} className="flex items-stretch">
              <button
                type="button"
                disabled={disabled}
                aria-pressed={active}
                aria-label={`${v.name} — ${voucherFace(v)}`}
                onClick={() => addPaper(v)}
                className={`flex items-stretch overflow-hidden rounded-xl border-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-foodies-cta bg-foodies-cta text-white rounded-r-none'
                    : 'border-foodies-border bg-foodies-surface text-foodies-textPrimary hover:border-foodies-primary'
                }`}
              >
                {/* The stub of the ticket: what the voucher is worth. */}
                <span
                  className={`flex items-center border-r-2 border-dashed px-3 py-2 text-sm font-extrabold ${
                    active ? 'border-white/60' : 'border-foodies-border text-foodies-cta'
                  }`}
                >
                  {voucherFace(v)}
                </span>
                <span className="flex items-center px-3 py-2 text-sm font-semibold">
                  {v.name}
                  {quantity > 1 && (
                    <span className="ml-2 rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold" aria-label={`${quantity} papers`}>
                      ×{quantity}
                    </span>
                  )}
                </span>
              </button>
              {active && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove one ${v.name}`}
                  onClick={() => removePaper(v.id)}
                  className="rounded-r-xl border-2 border-l-0 border-foodies-cta bg-foodies-surface px-2.5 text-base font-bold text-foodies-cta disabled:opacity-50"
                >
                  −
                </button>
              )}
            </div>
          );
        })}
        {papers > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([])}
            className="px-3 py-2 rounded-xl text-sm font-semibold text-foodies-textSecondary underline disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      {picked.length > 0 && applied && appliedAmount > 0 ? (
        <div className="mt-1.5 text-sm font-medium text-foodies-cta">
          {picked.length === 1 ? (
            <p>
              {nameOf(picked[0].id)}
              {picked[0].quantity > 1 ? ` ×${picked[0].quantity}` : ''}: −{formatCurrency(appliedAmount)}. Other
              discounts are switched off for this order.
            </p>
          ) : (
            <>
              {picked.map((p) => (
                <p key={p.id}>
                  {nameOf(p.id)}
                  {p.quantity > 1 ? ` ×${p.quantity}` : ''}: −{formatCurrency(amountOf(p.id))}
                </p>
              ))}
              <p>Vouchers: −{formatCurrency(appliedAmount)}. Other discounts are switched off for this order.</p>
            </>
          )}
        </div>
      ) : picked.length > 0 && error ? (
        // The order cannot be placed like this: the cashier is holding the
        // customer's paper vouchers and must know before charging.
        <p role="alert" className="mt-1.5 text-xs font-medium text-foodies-cta">
          {error} Fix the cart or clear the voucher to place the order.
        </p>
      ) : picked.length > 0 ? (
        <p className="mt-1.5 text-xs text-foodies-textSecondary">Checking the vouchers…</p>
      ) : null}
    </div>
  );
};

export default VoucherPicker;
