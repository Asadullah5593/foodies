import React from 'react';
import { StaffDiscountPreset } from '../../../types';
import { formatCurrency } from '../../../utils/currency';

export type StaffDiscountPickerProps = {
  presets: StaffDiscountPreset[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Rupees actually taken off, from the live quote. */
  appliedAmount?: number;
  /** Server's reason a chosen preset didn't apply (over ceiling, inactive, out of scope). */
  error?: string | null;
  disabled?: boolean;
};

/** Button face: "10%" or "Rs. 200 off". */
const faceOf = (p: StaffDiscountPreset): string =>
  p.discount_type === 'flat' ? `${formatCurrency(p.value)} off` : `${p.value}%`;

/**
 * Give-away buttons on the POS checkout. The list is what the SERVER says this
 * cashier may grant — it is already filtered by their role ceiling, the branch
 * and brand being sold, and the cart size. Hiding a button is a courtesy, not
 * the control: the same rules are re-checked at quote and refused outright at
 * order time.
 */
const StaffDiscountPicker: React.FC<StaffDiscountPickerProps> = ({
  presets,
  selectedId,
  onSelect,
  appliedAmount = 0,
  error,
  disabled = false,
}) => {
  // Nothing grantable (no permission, no presets, all above this role's limit)
  // — say nothing rather than showing an empty, unexplained control.
  if (presets.length === 0) return null;

  const selected = presets.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
        Staff discount <span className="font-normal text-foodies-textSecondary">(optional)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={p.name}
              onClick={() => onSelect(active ? null : p.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? 'border-foodies-cta bg-foodies-cta text-white'
                  : 'border-foodies-border bg-foodies-surface text-foodies-textPrimary hover:border-foodies-primary'
              }`}
            >
              {faceOf(p)}
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
      ) : selected && appliedAmount > 0 ? (
        <p className="mt-1.5 text-sm font-medium text-foodies-cta">
          {selected.name}: −{formatCurrency(appliedAmount)}
        </p>
      ) : selected ? (
        // Chosen but worth nothing — usually the tenant's max-total-discount cap
        // already spent on earlier stages. Better said than silently ignored.
        <p className="mt-1.5 text-xs text-foodies-textSecondary">
          {selected.name} applied nothing — the order is already at its discount limit.
        </p>
      ) : null}
    </div>
  );
};

export default StaffDiscountPicker;
