import apiClient from '../../utils/apiClient';
import { MenuItem } from '../../types';

export type BranchMenuResponse = {
  branch_id: number | null;
  menu: MenuItem[];
  /** Present when POS can accept orders (shift is open for this branch). */
  open_shift?: { id: number; shift_number: string; opened_at: string } | null;
  /** Branch order-type support (for POS order type dropdown). Omitted when branch not loaded. */
  supports_dine_in?: boolean;
  supports_takeaway?: boolean;
  supports_pickup?: boolean;
  supports_delivery?: boolean;
  /** When branch has multiple brands, POS must send brand_id with order. */
  brands?: { id: number; name: string }[];
  message?: string;
};

export type PosBranch = { id: number; name: string; code: string };

export const menuService = {
  /** Branches the current user is assigned to (for POS branch selector). */
  getPosBranches: async (): Promise<PosBranch[]> => {
    const response = await apiClient.get<PosBranch[]>('/pos/branches');
    return response.data;
  },

  /** Get menu for POS. Pass branchId to use a specific branch, or omit to use the current user's first assigned branch. */
  getBranchMenu: async (branchId?: number): Promise<BranchMenuResponse> => {
    const url = branchId != null ? `/pos/menu?branch_id=${branchId}` : '/pos/menu';
    const response = await apiClient.get<BranchMenuResponse>(url);
    return response.data;
  },
};
