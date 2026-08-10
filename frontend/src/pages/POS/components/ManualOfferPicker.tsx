import React from 'react';
import { ManualOffer } from '../../../types';
import { formatCurrency } from '../../../utils/currency';

export type ManualOfferPickerProps = {
  offers: ManualOffer[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Rupees the offer actually produced, from the live quote. */
  appliedAmount?: number;
  /** True once the quote confirms it produced something. */
  applied?: boolean;
  /** Server's reason it wasn't applied (permission, scope, inactive). */
  error?: string | null;
  disabled?: boolean;
};

/** "Buy 1 get 1 free" / "Buy 2 get 1 at 50%" — read off the offer's own config. */
export const offerTerms = (o: ManualOffer): string | null => {
  if (o.type !== 'buy_x_get_y') return null;
  const buy = o.buy_quantity ?? 1;
  const get = o.get_quantity ?? 1;
  const pct = o.get_discount_percent ?? 0;
  const reward = pct >= 100 ? 'free' : `${pct}% off`;
  return `Buy ${buy}, get ${get} ${reward}`;
};

/**
 * Till-activated offers on the POS checkout — the cashier switches one on for
 * this cart only, which is how one customer gets a BOGO and the next does not.
 *
 * The list is what the SERVER says this cashier may apply; it returns [] without
 * `orders:apply-manual-offer`, so an unauthorized till sees no control at all.
 * Whether the cart *qualifies* is the pricing engine's answer, reported back
 * through the quote — which is why an active selection can still show "didn't
 * apply".
 */
const ManualOfferPicker: React.FC<ManualOfferPickerProps> = ({
  offers,
  selectedId,
  onSelect,
  appliedAmount = 0,
  applied = false,
  error,
  disabled = false,
}) => {
  if (offers.length === 0) return null;

  const selected = offers.find((o) => o.id === selectedId) ?? null;

  return (
    <div>
      <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
        Offers <span className="font-normal text-foodies-textSecondary">(this order only)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {offers.map((o) => {
          const active = o.id === selectedId;
          const terms = offerTerms(o);
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={terms ? `${o.name} — ${terms}` : o.name}
              onClick={() => onSelect(active ? null : o.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? 'border-foodies-cta bg-foodies-cta text-white'
                  : 'border-foodies-border bg-foodies-surface text-foodies-textPrimary hover:border-foodies-primary'
              }`}
            >
              {o.name}
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
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-foodies-cta">{error}</p>
      ) : selected && applied && appliedAmount > 0 ? (
        <p className="mt-1.5 text-sm font-medium text-foodies-cta">
          {selected.name}: −{formatCurrency(appliedAmount)}
        </p>
      ) : selected ? (
        // Switched on but worth nothing: the cart doesn't meet the offer's terms
        // yet, or a better automatic offer already won. Saying so beats a silent
        // zero the cashier only notices on the receipt.
        <p className="mt-1.5 text-xs text-foodies-textSecondary">
          {offerTerms(selected)
            ? `Not applied yet — needs ${offerTerms(selected)!.toLowerCase()}.`
            : 'Not applied — this cart does not qualify.'}
        </p>
      ) : null}
    </div>
  );
};

export default ManualOfferPicker;
