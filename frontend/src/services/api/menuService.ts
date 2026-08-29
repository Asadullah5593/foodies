import apiClient from '../../utils/apiClient';
import { MenuItem } from '../../types';

export type BranchMenuResponse = {
  branch_id: number | null;
  /** False when the selected branch is marked inactive (takes no orders). */
  branch_active?: boolean;
  menu: MenuItem[];
  /** Present when POS can accept orders (a shift is open here). Shifts are per brand. */
  open_shift?: { id: number; shift_number: string; opened_at: string } | null;
  /** All open shifts at the branch (one per brand). */
  open_shifts?: { id: number; brand_id: number | null; shift_number: string; opened_at: string }[];
  /** Brands that currently have an open shift at this branch. */
  open_shift_brand_ids?: number[];
  /** Branch order-type support (for POS order type dropdown). Omitted when branch not loaded. */
  supports_dine_in?: boolean;
  supports_takeaway?: boolean;
  supports_delivery?: boolean;
  /** When branch has multiple brands, POS must send brand_id with order. */
  brands?: { id: number; name: string }[];
  message?: string;
};

export type PosBranch = {
  id: number;
  name: string;
  code: string;
  /** Inactive branches take no orders; the API sorts them last so they are never the default. */
  is_active?: boolean;
};

export const menuService = {
  /** Branches the current user is assigned to (for POS branch selector). */
  getPosBranches: async (): Promise<PosBranch[]> => {
    const response = await apiClient.get<PosBranch[]>('/pos/branches');
    return response.data;
  },

  /**
   * Get menu for POS. Pass branchId to use a specific branch, or omit to use the current user's first assigned branch.
   * When `orderType` is set, only items that support that channel are returned (delivery, pickup, dine_in; takeaway → pickup).
   */
  getBranchMenu: async (
    branchId?: number,
    orderType?: string | null,
  ): Promise<BranchMenuResponse> => {
    const params = new URLSearchParams();
    if (branchId != null) params.set('branch_id', String(branchId));
    if (orderType != null && orderType.trim() !== '') {
      params.set('order_type', orderType.trim());
    }
    const qs = params.toString();
    const url = qs ? `/pos/menu?${qs}` : '/pos/menu';
    const response = await apiClient.get<BranchMenuResponse>(url);
    return response.data;
  },

  /** Get deal definition by menu item id for POS. Returns null if not a deal. */
  getDeal: async (
    menuItemId: number,
    branchId: number,
    orderType?: string | null,
  ): Promise<DealDefinition | null> => {
    const params = new URLSearchParams();
    params.set('branch_id', String(branchId));
    if (orderType != null && orderType.trim() !== '') {
      params.set('order_type', orderType.trim());
    }
    const response = await apiClient.get<DealDefinition | null>(
      `/pos/deal/${menuItemId}?${params.toString()}`,
    );
    return response.data ?? null;
  },
};

export type DealSlot = {
  slot_index: number;
  type: string;
  quantity: number;
  /** Optional slot: add 0..quantity units (any number, repeats allowed); picking none is valid. */
  optional?: boolean;
  allow_customization: boolean;
  /** Lock this slot's chosen item to one variant size (e.g. '12' = "All 12\" pizzas"). */
  slot_size_key?: string | null;
  /** Whitelist of variant sizeKeys allowed in this slot (e.g. ['12','14']); null = any size. */
  allowed_size_keys?: string[] | null;
  /** This slot must mirror the referenced slot's pick (BOGO 2nd pizza); null = independent. */
  mirror_slot_index?: number | null;
  /** With mirror_slot_index: force the same variant size as the mirrored slot. */
  mirror_match_size?: boolean;
  /** With mirror_slot_index: restrict choices to the same (category, label) as the mirrored slot. */
  mirror_match_category?: boolean;
  /** Per-item upgrade surcharge keyed by menu_item_id (e.g. {"42":100} = "+Rs100 for Firey Special"). */
  slot_surcharges?: Record<string, number> | null;
  source_menu_item_id?: number | null;
  choice_items?: MenuItem[];
};

export type DealDefinition = {
  deal_menu_item_id: number;
  name: string;
  price: number;
  /** 'bogo' = dynamic (full + cheaper-at-percent); null/'fixed' = fixed bundle price. */
  pricing_mode?: string | null;
  /** For 'bogo': percent off the cheaper pizza (e.g. 50). */
  bogo_get_percent?: number | null;
  slots: DealSlot[];
};
