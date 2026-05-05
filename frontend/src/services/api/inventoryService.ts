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
  baseUomIds?: number[] | null;
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
    base_uom_ids?: number[];
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
      base_uom_ids?: number[];
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
  getLedger: async (
    branchId: number,
    params?: {
      event_type?: string;
      inventory_item_id?: number;
      event_ref_type?: string;
      event_ref_id?: number;
      from?: string;
      to?: string;
      page?: number;
      page_size?: number;
    },
  ) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/ledger`, { params });
    return res.data ?? { items: [], total: 0, page: 1, pageSize: 50 };
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
  getExpiryCoverageWarnings: async (branchId: number) => {
    const res = await apiClient.get(`/admin/inventory/branches/${branchId}/expiry-coverage-warnings`);
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

  // Transfers
  listTransferRequests: async (branchId?: number) => {
    const res = await apiClient.get('/admin/inventory/transfers/requests', {
      params: branchId ? { branch_id: branchId } : undefined,
    });
    return res.data ?? [];
  },
  createTransferRequest: async (data: {
    source_branch_id: number;
    destination_branch_id: number;
    notes?: string;
    lines: Array<{
      inventory_item_id: number;
      requested_qty: number;
      requested_uom_id: number;
      notes?: string;
    }>;
  }) => {
    const res = await apiClient.post('/admin/inventory/transfers/requests', data);
    return res.data;
  },
  approveTransferRequest: async (id: number, data?: { notes?: string }) => {
    const res = await apiClient.post(`/admin/inventory/transfers/requests/${id}/approve`, data ?? {});
    return res.data;
  },
  rejectTransferRequest: async (id: number, data?: { reason?: string }) => {
    const res = await apiClient.post(`/admin/inventory/transfers/requests/${id}/reject`, data ?? {});
    return res.data;
  },
  listTransferOrders: async (branchId?: number) => {
    const res = await apiClient.get('/admin/inventory/transfers/orders', {
      params: branchId ? { branch_id: branchId } : undefined,
    });
    return res.data ?? [];
  },
  dispatchTransferOrder: async (id: number, data: {
    lines: Array<{
      inventory_item_id: number;
      qty: number;
      qty_uom_id: number;
      location_id?: number | null;
      inventory_batch_id?: number | null;
      notes?: string | null;
    }>;
  }) => {
    const res = await apiClient.post(`/admin/inventory/transfers/orders/${id}/dispatch`, data);
    return res.data;
  },
  receiveTransferOrder: async (id: number, data: {
    notes?: string;
    lines: Array<{
      inventory_item_id: number;
      received_qty: number;
      received_uom_id: number;
      location_id?: number | null;
      lot_code?: string | null;
      expiry_date?: string | null;
      notes?: string | null;
    }>;
  }) => {
    const res = await apiClient.post(`/admin/inventory/transfers/orders/${id}/receive`, data);
    return res.data;
  },

  // Adjustments
  listAdjustments: async (branchId: number) => {
    const res = await apiClient.get('/admin/inventory/adjustments', {
      params: { branch_id: branchId },
    });
    return res.data ?? [];
  },
  createAdjustment: async (data: {
    branch_id: number;
    adjustment_type: 'in' | 'out';
    reason_code: string;
    notes?: string;
    lines: Array<{
      inventory_item_id: number;
      qty: number;
      qty_uom_id: number;
      location_id?: number | null;
      inventory_batch_id?: number | null;
      lot_code?: string | null;
      expiry_date?: string | null;
      notes?: string | null;
    }>;
  }) => {
    const res = await apiClient.post('/admin/inventory/adjustments', data);
    return res.data;
  },
  postAdjustment: async (id: number) => {
    const res = await apiClient.post(`/admin/inventory/adjustments/${id}/post`);
    return res.data;
  },

  // Brand reporting
  getBrandLedgerSummary: async (
    brandId: number,
    params?: { from?: string; to?: string; branch_id?: number },
  ) => {
    const res = await apiClient.get(`/admin/inventory/brands/${brandId}/ledger-summary`, {
      params,
    });
    return res.data;
  },
};

