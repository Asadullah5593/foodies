import apiClient from '../../utils/apiClient';

export const procurementService = {
  // PR
  listPRs: async () => {
    const res = await apiClient.get('/admin/procurement/purchase-requisitions');
    return res.data ?? [];
  },
  createPR: async (data: {
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
  getPO: async (id: number) => {
    const res = await apiClient.get(`/admin/procurement/purchase-orders/${id}`);
    return res.data;
  },

  // GRN
  listGRNs: async () => {
    const res = await apiClient.get('/admin/procurement/grns');
    return res.data ?? [];
  },
  createGRN: async (data: { purchase_order_id: number; branch_id: number; notes?: string }) => {
    const res = await apiClient.post('/admin/procurement/grns', data);
    return res.data;
  },
  addGRNLine: async (grnId: number, data: {
    purchase_order_line_id?: number | null;
    inventory_item_id: number;
    received_qty: number;
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

