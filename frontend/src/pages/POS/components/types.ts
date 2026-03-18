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
