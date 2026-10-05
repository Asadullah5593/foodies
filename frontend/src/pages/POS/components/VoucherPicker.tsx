import React from 'react';
import { TillVoucher } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import { voucherFace } from '../../../utils/voucherText';

export type VoucherPickerProps = {
  vouchers: TillVoucher[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Rupees the voucher took off, from the live quote. */
  appliedAmount?: number;
  /** True once the quote confirms the voucher is what priced the cart. */
  applied?: boolean;
  /** Server's reason it cannot be used on this cart. */
  error?: string | null;
  disabled?: boolean;
};

/**
 * Printed vouchers (the paper coupon book) on the POS checkout. The cashier
 * taps the one the customer handed over: one voucher per order, and it replaces
 * every other discount.
 *
 * The list is what the SERVER says can be used on this order — the cart's
 * brand, this branch, this order type, today — and it is empty without
 * `printed-vouchers:apply`, so an unauthorized till sees no control at all.
 * Whether the cart *qualifies* comes back through the quote, which is why a
 * selected voucher can still read "not applied".
 */
const VoucherPicker: React.FC<VoucherPickerProps> = ({
  vouchers,
  selectedId,
  onSelect,
  appliedAmount = 0,
  applied = false,
  error,
  disabled = false,
}) => {
  if (vouchers.length === 0) return null;

  const selected = vouchers.find((v) => v.id === selectedId) ?? null;

  return (
    <div>
      <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
        Printed voucher <span className="font-normal text-foodies-textSecondary">(one per order)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {vouchers.map((v) => {
          const active = v.id === selectedId;
          return (
            <button
              key={v.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              aria-label={`${v.name} — ${voucherFace(v)}`}
              onClick={() => onSelect(active ? null : v.id)}
              className={`flex items-stretch overflow-hidden rounded-xl border-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-foodies-cta bg-foodies-cta text-white'
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
              <span className="flex items-center px-3 py-2 text-sm font-semibold">{v.name}</span>
            </button>
          );
        })}
        {selectedId != null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(null)}
            className="px-3 py-2 rounded-xl text-sm font-semibold text-foodies-textSecondary underline disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      {selected && applied && appliedAmount > 0 ? (
        <p className="mt-1.5 text-sm font-medium text-foodies-cta">
          {selected.name}: −{formatCurrency(appliedAmount)}. Other discounts are switched off for this order.
        </p>
      ) : selected && error ? (
        // The order cannot be placed like this: the cashier is holding the
        // customer's paper voucher and must know before charging.
        <p role="alert" className="mt-1.5 text-xs font-medium text-foodies-cta">
          {error} Fix the cart or clear the voucher to place the order.
        </p>
      ) : selected ? (
        <p className="mt-1.5 text-xs text-foodies-textSecondary">Checking the voucher…</p>
      ) : null}
    </div>
  );
};

export default VoucherPicker;
