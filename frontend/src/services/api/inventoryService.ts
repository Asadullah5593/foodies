import apiClient from '../../utils/apiClient';

export type UomDto = {
  id: number;
  tenantId?: number;
  name: string;
  code: string;
  kind: string;
  baseUomId?: number | null;
  multiplierToBase?: number | null;
  isActive?: boolean;
};

export type VendorDto = {
  id: number;
  name: string;
  type: string;
  linkedBranchId?: number | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive?: boolean;
};

export type InventoryItemDto = {
  id: number;
  name: string;
  code: string;
  type: string;
  baseUomId: number;
  trackExpiry: boolean;
  trackLot: boolean;
  defaultReorderPoint?: number | null;
  defaultNearExpiryDays?: number | null;
};

export const inventoryService = {
  // UOMs
  listUoms: async (): Promise<UomDto[]> => {
    const res = await apiClient.get('/admin/inventory/uoms');
    return res.data ?? [];
  },
  createUom: async (data: {
    name: string;
    code: string;
    kind?: string;
    base_uom_id?: number | null;
    multiplier_to_base?: number | null;
  }) => {
    const res = await apiClient.post('/admin/inventory/uoms', data);
    return res.data;
  },
  updateUom: async (id: number, data: { name?: string; code?: string }) => {
    const res = await apiClient.patch(`/admin/inventory/uoms/${id}`, data);
    return res.data;
  },
  deleteUom: async (id: number) => {
    const res = await apiClient.delete(`/admin/inventory/uoms/${id}`);
    return res.data;
  },

  // Vendors
  listVendors: async (): Promise<VendorDto[]> => {
    const res = await apiClient.get('/admin/inventory/vendors');
    return res.data ?? [];
  },
  createVendor: async (data: {
    name: string;
    type?: string;
    linked_branch_id?: number | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  }) => {
    const res = await apiClient.post('/admin/inventory/vendors', data);
    return res.data;
  },
  updateVendor: async (
    id: number,
    data: {
      name?: string;
      type?: string;
      linked_branch_id?: number | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ) => {
    const res = await apiClient.patch(`/admin/inventory/vendors/${id}`, data);
    return res.data;
  },
  deleteVendor: async (id: number) => {
    const res = await apiClient.delete(`/admin/inventory/vendors/${id}`);
    return res.data;
  },

  // Items
  listItems: async (): Promise<InventoryItemDto[]> => {
    const res = await apiClient.get('/admin/inventory/items');
    return res.data ?? [];
  },
  createItem: async (data: {
    name: string;
    code: string;
    type?: string;
    base_uom_id: number;
    track_expiry?: boolean;
    track_lot?: boolean;
    default_reorder_point?: number | null;
    default_near_expiry_days?: number | null;
  }) => {
    const res = await apiClient.post('/admin/inventory/items', data);
    return res.data;
  },
  updateItem: async (
    id: number,
    data: {
      name?: string;
      code?: string;
      type?: string;
      base_uom_id?: number;
      track_expiry?: boolean;
      track_lot?: boolean;
      default_reorder_point?: number | null;
      default_near_expiry_days?: number | null;
    },
  ) => {
    const res = await apiClient.patch(`/admin/inventory/items/${id}`, data);
    return res.data;
  },
  deleteItem: async (id: number) => {
    const res = await apiClient.delete(`/admin/inventory/items/${id}`);
    return res.data;
  },

  // Locations
  listLocations: async (branchId: number) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/locations`);
    return res.data ?? [];
  },
  createLocation: async (branchId: number, data: { name: string; code: string }) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/locations`, data);
    return res.data;
  },

  // On hand / ledger
  getOnHand: async (branchId: number) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/on-hand`);
    return res.data ?? [];
  },
  getLedger: async (branchId: number, limit = 200) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/ledger`, { params: { limit } });
    return res.data ?? [];
  },

  // Alerts
  getLowStock: async (branchId: number) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/low-stock`);
    return res.data ?? [];
  },
  getNearExpiry: async (branchId: number) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/near-expiry`);
    return res.data ?? [];
  },

  // Wastage
  createWastage: async (branchId: number, data: {
    inventory_item_id: number;
    qty: number;
    qty_uom_id: number;
    reason: string;
    notes?: string;
    location_id?: number;
    inventory_batch_id?: number;
  }) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/wastage`, data);
    return res.data;
  },

  // Stocktake
  createStocktake: async (branchId: number, data: { week_start: string; week_end: string; finance_day: string }) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/stocktakes`, data);
    return res.data;
  },
  upsertStocktakeLine: async (branchId: number, stocktakeId: number, data: {
    inventory_item_id: number;
    counted_qty: number;
    counted_uom_id: number;
    location_id?: number | null;
    notes?: string | null;
  }) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/stocktakes/${stocktakeId}/lines`, data);
    return res.data;
  },
  submitStocktake: async (branchId: number, stocktakeId: number) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/stocktakes/${stocktakeId}/submit`);
    return res.data;
  },
  closeStocktake: async (branchId: number, stocktakeId: number) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/stocktakes/${stocktakeId}/close`);
    return res.data;
  },
  weeklyUsage: async (branchId: number, data: { from: string; to: string }) => {
    const res = await apiClient.post(`/admin/inventory/branches/${branchId}/weekly-usage`, data);
    return res.data;
  },
};

