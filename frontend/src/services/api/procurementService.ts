import apiClient from '../../utils/apiClient';

export const procurementService = {
  // PR
  listPRs: async () => {
    const res = await apiClient.get('/admin/procurement/purchase-requisitions');
    return res.data ?? [];
  },
  createPR: async (data: {
    pr_number?: string;
    requesting_branch_id: number;
    requested_from_vendor_id: number;
    notes?: string;
    lines: Array<{
      inventory_item_id: number;
      requested_qty: number;
      requested_uom_id: number;
      notes?: string;
    }>;
  }) => {
    const res = await apiClient.post('/admin/procurement/purchase-requisitions', data);
    return res.data;
  },
  updatePR: async (id: number, data: {
    pr_number?: string;
    requesting_branch_id?: number;
    requested_from_vendor_id?: number;
    notes?: string | null;
    lines?: Array<{
      inventory_item_id: number;
      requested_qty: number;
      requested_uom_id: number;
      notes?: string;
    }>;
  }) => {
    const res = await apiClient.patch(`/admin/procurement/purchase-requisitions/${id}`, data);
    return res.data;
  },
  submitPR: async (id: number) => {
    const res = await apiClient.post(`/admin/procurement/purchase-requisitions/${id}/submit`);
    return res.data;
  },
  approvePR: async (id: number, data: { po_number?: string; expected_delivery_date?: string | null; notes?: string | null }) => {
    const res = await apiClient.post(`/admin/procurement/purchase-requisitions/${id}/approve`, data);
    return res.data;
  },
  rejectPR: async (id: number, data: { reason?: string }) => {
    const res = await apiClient.post(`/admin/procurement/purchase-requisitions/${id}/reject`, data);
    return res.data;
  },

  // PO
  listPOs: async () => {
    const res = await apiClient.get('/admin/procurement/purchase-orders');
    return res.data ?? [];
  },
  listPOsFiltered: async (params?: { status?: string; from?: string; to?: string }) => {
    const res = await apiClient.get('/admin/procurement/purchase-orders', { params });
    return res.data ?? [];
  },
  getPO: async (id: number) => {
    const res = await apiClient.get(`/admin/procurement/purchase-orders/${id}`);
    return res.data;
  },
  updatePO: async (id: number, data: {
    po_number?: string;
    vendor_id?: number;
    notes?: string | null;
    lines?: Array<{
      inventory_item_id: number;
      ordered_qty: number;
      ordered_uom_id: number;
      notes?: string | null;
    }>;
  }) => {
    const res = await apiClient.patch(`/admin/procurement/purchase-orders/${id}`, data);
    return res.data;
  },

  // GRN
  listGRNs: async () => {
    const res = await apiClient.get('/admin/procurement/grns');
    return res.data ?? [];
  },
  listGRNsFiltered: async (params?: { status?: string; from?: string; to?: string }) => {
    const res = await apiClient.get('/admin/procurement/grns', { params });
    return res.data ?? [];
  },
  getGRN: async (id: number) => {
    const res = await apiClient.get(`/admin/procurement/grns/${id}`);
    return res.data;
  },
  createGRN: async (data: { grn_number?: string; purchase_order_id: number; branch_id: number; notes?: string }) => {
    const res = await apiClient.post('/admin/procurement/grns', data);
    return res.data;
  },
  updateGRN: async (id: number, data: {
    grn_number?: string;
    notes?: string | null;
    lines?: Array<{
      line_id?: number;
      purchase_order_line_id?: number | null;
      inventory_item_id: number;
      received_qty: number;
      accepted_qty?: number | null;
      rejected_qty?: number | null;
      rejection_reason?: string | null;
      allow_mismatched_item?: boolean;
      received_uom_id: number;
      lot_code?: string | null;
      expiry_date?: string | null;
      location_id?: number | null;
      notes?: string | null;
    }>;
  }) => {
    const res = await apiClient.patch(`/admin/procurement/grns/${id}`, data);
    return res.data;
  },
  addGRNLine: async (grnId: number, data: {
    purchase_order_line_id?: number | null;
    inventory_item_id: number;
    received_qty: number;
    accepted_qty?: number | null;
    rejected_qty?: number | null;
    rejection_reason?: string | null;
    allow_mismatched_item?: boolean;
    received_uom_id: number;
    lot_code?: string | null;
    expiry_date?: string | null;
    location_id?: number | null;
    notes?: string | null;
  }) => {
    const res = await apiClient.post(`/admin/procurement/grns/${grnId}/lines`, data);
    return res.data;
  },
  postGRN: async (grnId: number) => {
    const res = await apiClient.post(`/admin/procurement/grns/${grnId}/post`);
    return res.data;
  },
  reverseGRN: async (grnId: number) => {
    const res = await apiClient.post(`/admin/procurement/grns/${grnId}/reverse`);
    return res.data;
  },
};

