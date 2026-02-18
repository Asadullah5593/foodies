import apiClient from '../../utils/apiClient';

export interface RiderOrder {
  id: number;
  order_number: string;
  order_group_id: string | null;
  status: string;
  delivery_status: string | null;
  delivery_failed_reason: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  placed_at: string | null;
  total_amount: number;
  branch: { id: number; name: string; address?: string | null } | null;
  brand_name: string | null;
  items: Array<{
    id: number;
    name_snapshot: string;
    quantity: number;
    unit_price: number;
  }>;
}

export const riderService = {
  getOrders: async (): Promise<RiderOrder[]> => {
    const response = await apiClient.get<RiderOrder[]>('/rider/orders');
    return Array.isArray(response.data) ? response.data : [];
  },

  getOrder: async (id: number): Promise<RiderOrder> => {
    const response = await apiClient.get<RiderOrder>(`/rider/orders/${id}`);
    return response.data;
  },

  updateDeliveryStatus: async (
    orderId: number,
    delivery_status: string,
    delivery_failed_reason?: string
  ): Promise<RiderOrder> => {
    const response = await apiClient.patch<RiderOrder>(
      `/rider/orders/${orderId}/status`,
      { delivery_status, delivery_failed_reason }
    );
    return response.data;
  },
};
