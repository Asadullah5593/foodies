import React from 'react';
import type { IconType } from 'react-icons';
import {
  MdOutlineStorefront,
  MdOutlineShoppingBag,
  MdOutlineDeliveryDining,
} from 'react-icons/md';
import { usePOSOrderTypeSlot } from '../../../contexts/POSOrderTypeContext';

const ICONS: Record<string, IconType> = {
  dine_in: MdOutlineStorefront,
  takeaway: MdOutlineShoppingBag,
  delivery: MdOutlineDeliveryDining,
};

/**
 * Order type in the app navbar (56px tall), so the mode a cashier is in is
 * visible from every POS screen without spending a full strip on it. Keeps the
 * old in-page strip's language — icon + label, a light red band, and a 3px red
 * underline on the active tab — just compacted. Until one is picked the whole
 * control is outlined red: the navbar has no room for the "Pick one to start"
 * helper line, and nothing can be ordered before a type is chosen.
 */
const OrderTypeNavTabs: React.FC = () => {
  const { slot, change } = usePOSOrderTypeSlot();
  if (!slot || slot.options.length === 0) return null;

  const nothingSelected = slot.value == null;

  return (
    <div
      role="radiogroup"
      aria-label="Order type"
      className={`inline-flex items-center overflow-hidden rounded-xl border bg-foodies-primary/[.06] dark:bg-slate-700/60 ${
        nothingSelected
          ? 'border-foodies-primary'
          : 'border-foodies-primary/25 dark:border-slate-600'
      }`}
    >
      {slot.options.map((opt) => {
        const selected = slot.value === opt.value;
        const Icon = ICONS[opt.value];
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => change(opt.value)}
            title={opt.label}
            className={`inline-flex items-center gap-2 whitespace-nowrap border-b-[3px] px-4 py-2 text-[13px] font-bold transition-colors ${
              selected
                ? 'border-foodies-primary bg-white text-foodies-primary shadow-sm dark:bg-slate-800'
                : 'border-transparent text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-slate-100'
            }`}
          >
            {Icon && <Icon className="h-[18px] w-[18px]" />}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default OrderTypeNavTabs;
