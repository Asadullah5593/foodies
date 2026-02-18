import apiClient from '../../utils/apiClient';
import { Order, CreateOrderResponse } from '../../types';

export interface CreateOrderRequest {
  branch_id: number;
  order_type: 'dine_in' | 'takeaway' | 'pickup' | 'delivery';
  table_number?: string;
  customer_name: string;
  customer_phone: string;
  delivery_address?: string;
  items: Array<{
    menu_item_id: number;
    quantity: number;
    variant_id?: number;
    addons?: Array<{
      addon_id: number;
      quantity: number;
    }>;
    notes?: string;
    /** When ordering from multiple branches, set which branch fulfils this line. Omit to use request branch_id. */
    branch_id?: number;
  }>;
  notes?: string;
  discount_code?: string;
  loyalty_points_to_redeem?: number;
}

export interface ProcessPaymentRequest {
  payment_method: 'cash' | 'card' | 'other';
  amount: number;
  reference_number?: string;
}

export interface OrderQuoteLineBreakdown {
  menu_item_id: number;
  subtotal: number;
  discount_amount: number;
  after_discount: number;
}

export interface OrderQuoteResponse {
  subtotal: number;
  discount_amount: number;
  auto_discount_amount?: number;
  coupon_discount_amount?: number;
  discount_code: string | null;
  loyalty_discount?: number;
  loyalty_points_redeemed?: number;
  tax_amount: number;
  service_charge: number;
  delivery_fee: number;
  total_amount: number;
  line_breakdown?: OrderQuoteLineBreakdown[];
}

export const orderService = {
  getQuote: async (data: {
    branch_id: number;
    order_type: string;
    items: Array<{ menu_item_id: number; quantity: number; variant_id?: number; addons?: Array<{ addon_id: number; quantity: number }> }>;
    discount_code?: string;
  }): Promise<OrderQuoteResponse> => {
    const response = await apiClient.post<OrderQuoteResponse>('/pos/orders/quote', data);
    return response.data;
  },

  createOrder: async (data: CreateOrderRequest): Promise<CreateOrderResponse> => {
    const response = await apiClient.post<CreateOrderResponse>('/pos/orders', data);
    return response.data;
  },

  getOrder: async (id: number): Promise<Order> => {
    const response = await apiClient.get<Order>(`/pos/orders/${id}`);
    return response.data;
  },

  getOrderGroup: async (orderGroupId: string): Promise<{ order_group_id: string; orders: Order[] }> => {
    const response = await apiClient.get(`/pos/orders/group/${orderGroupId}`);
    return response.data;
  },

  getOrderInvoice: async (orderId: number): Promise<any> => {
    const response = await apiClient.get(`/pos/orders/${orderId}/invoice`);
    return response.data;
  },

  getOrderGroupMainInvoice: async (orderGroupId: string): Promise<any> => {
    const response = await apiClient.get(`/pos/orders/group/${orderGroupId}/main-invoice`);
    return response.data;
  },

  processPayment: async (orderId: number, payment: ProcessPaymentRequest): Promise<any> => {
    const response = await apiClient.post(`/pos/orders/${orderId}/pay`, payment);
    return response.data;
  },
};
