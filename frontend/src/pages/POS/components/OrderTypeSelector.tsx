import React from 'react';
import type { IconType } from 'react-icons';
import {
  MdOutlineStorefront,
  MdOutlineShoppingBag,
  MdOutlineDeliveryDining,
} from 'react-icons/md';
import type { OrderTypeOption } from './types';

type Option = { value: OrderTypeOption; label: string };

export type OrderTypeSelectorProps = {
  options: Option[];
  value: OrderTypeOption | null;
  onChange: (value: OrderTypeOption) => void;
};

const ICONS: Record<OrderTypeOption, IconType> = {
  dine_in: MdOutlineStorefront,
  takeaway: MdOutlineShoppingBag,
  delivery: MdOutlineDeliveryDining,
};

const DESCRIPTIONS: Record<OrderTypeOption, string> = {
  dine_in: 'Dine in — guests eating at the store',
  takeaway: 'Takeaway — items packed to go',
  delivery: 'Delivery — sent to the customer’s address',
};

/**
 * POS order-type picker as a full-width screen-MODE tab strip.
 * It owns its own top row (red top accent + recessed band) above the filter
 * row, so it reads as "what mode am I in", never as a dropdown/filter.
 * Selecting only recolors a tab — the 3px underline is always present and
 * merely turns from transparent to red, and the helper line is a fixed height,
 * so there is no structure swap and the menu grid below never moves.
 */
const OrderTypeSelector: React.FC<OrderTypeSelectorProps> = ({
  options,
  value,
  onChange,
}) => {
  const nothingSelected = value == null;

  return (
    <div className="flex-shrink-0 border-t-4 border-foodies-primary border-b border-foodies-border bg-foodies-primary/5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
      {/* Eyebrow header: titles the zone (prominence) and carries the cue so
          it never sits under a single tab. Divider separates it from the tabs. */}
      <div className="flex items-center justify-between gap-3 border-b-2 border-b-foodies-primary px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foodies-textSecondary dark:text-slate-400">
          Order type
        </span>
        <span
          className={`truncate text-sm ${
            nothingSelected
              ? 'font-semibold text-foodies-primary'
              : 'text-foodies-textSecondary dark:text-slate-400'
          }`}
        >
          {nothingSelected ? 'Pick one to start' : DESCRIPTIONS[value]}
        </span>
      </div>
      <div role="radiogroup" aria-label="Order type" className="flex">
        {options.map((opt) => {
          const selected = value === opt.value;
          const Icon = ICONS[opt.value];
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={`flex min-h-[56px] flex-1 items-center justify-center gap-2 border-b-4 border-l border-l-foodies-border px-3 text-sm transition-colors first:border-l-0 dark:border-l-slate-700 ${
                selected
                  ? 'border-b-foodies-primary bg-foodies-primary/10 font-bold text-foodies-primary shadow-sm'
                  : 'border-b-transparent font-semibold text-foodies-textSecondary hover:bg-foodies-surface/60 hover:text-foodies-textPrimary dark:hover:bg-slate-800/60'
              }`}
            >
              {Icon && <Icon className="h-5 w-5 flex-shrink-0" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default OrderTypeSelector;
