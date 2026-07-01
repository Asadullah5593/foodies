import { MenuItem } from '../../../types';

export type OrderTypeOption = 'dine_in' | 'takeaway' | 'delivery';

export type DealComponentLine = {
  menuItem: MenuItem;
  quantity: number;
  slot_index?: number;
  variantId?: number;
  addons: Array<{ addonId: number; quantity: number }>;
  modifiers: Array<{ modifierId: number; quantity: number }>;
  notes?: string;
  /** Per-unit upgrade surcharge for the chosen item in this slot (e.g. +Rs100 Firey Special). */
  surcharge?: number;
};

export type CartLine = {
  menuItem: MenuItem;
  quantity: number;
  variantId?: number;
  addons: Array<{ addonId: number; quantity: number }>;
  modifiers: Array<{ modifierId: number; quantity: number }>;
  notes?: string;
  /** When set, this line is a deal; price is deal price and components are the chosen items. */
  dealId?: number;
  dealName?: string;
  dealPrice?: number;
  components?: DealComponentLine[];
};

export type ItemConfig = {
  variantId?: number;
  addons: Array<{ addonId: number; quantity: number }>;
  modifiers: Array<{ modifierId: number; quantity: number }>;
  notes?: string;
};

/** Pre-select the admin-marked default variant when opening configure/add flows. */
export function defaultVariantIdForItem(item: MenuItem | null | undefined): number | undefined {
  if (!item?.variants?.length) return undefined;
  const def = item.variants.find(
    (v) =>
      v.is_default === true ||
      (v as { isDefault?: boolean }).isDefault === true,
  );
  return def?.id;
}
