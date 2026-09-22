import React from 'react';

export const ALL_OFFER_ORDER_TYPES = ['delivery', 'pickup', 'dine_in'] as const;
export type OfferOrderType = (typeof ALL_OFFER_ORDER_TYPES)[number];

const ORDER_TYPE_LABELS: Record<OfferOrderType, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup / Takeaway',
  dine_in: 'Dine-in',
};

/** null/empty from the API = every order type. */
export const orderTypesToForm = (orderTypes?: string[] | null): string[] =>
  orderTypes && orderTypes.length > 0 ? orderTypes : [...ALL_OFFER_ORDER_TYPES];

/** All three selected = no restriction → send null. */
export const orderTypesToApi = (selected: string[]): string[] | null =>
  selected.length === 0 || selected.length === ALL_OFFER_ORDER_TYPES.length ? null : selected;

interface Props {
  value: string[];
  onChange: (orderTypes: string[]) => void;
}

/** Checkbox group deciding which order types an offer applies to. */
const OfferOrderTypesField: React.FC<Props> = ({ value, onChange }) => {
  const toggle = (t: string) =>
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const check = (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,8.5 6.5,12 13,4.5" />
    </svg>
  );
  return (
    <div>
      <span className="mb-2.5 block text-[13px] font-semibold text-gray-700">Order types</span>
      <div className="flex flex-wrap gap-2.5">
        {ALL_OFFER_ORDER_TYPES.map((t) => {
          const on = value.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`inline-flex items-center gap-2 rounded-full border-[1.5px] px-[15px] py-[9px] text-[13.5px] font-semibold transition-colors ${
                on ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span
                className={`flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border-[1.5px] ${
                  on ? 'border-red-600 bg-red-600' : 'border-gray-300 bg-white'
                }`}
              >
                {on && check}
              </span>
              {ORDER_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-[12.5px] text-gray-500">
        Untick an order type to hide the offer there (e.g. delivery only). All ticked = every order type.
      </p>
    </div>
  );
};

export default OfferOrderTypesField;
