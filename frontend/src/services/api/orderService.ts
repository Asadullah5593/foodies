import apiClient from '../../utils/apiClient';
import { Order, CreateOrderResponse } from '../../types';

export interface CreateOrderRequest {
  branch_id: number;
  order_type: 'dine_in' | 'takeaway' | 'pickup' | 'delivery';
  table_number?: string;
  customer_name: string;
  customer_phone: string;
  delivery_address?: string;
  items: Array<
    | {
        menu_item_id: number;
        quantity: number;
        variant_id?: number;
        addons?: Array<{ addon_id: number; quantity: number }>;
        modifiers?: Array<{ modifier_id: number; quantity?: number }>;
        notes?: string;
        branch_id?: number;
      }
    | {
        deal_menu_item_id: number;
        quantity: number;
        components: Array<{
          slot_index: number;
          menu_item_id: number;
          quantity: number;
          variant_id?: number;
          addons?: Array<{ addon_id: number; quantity: number }>;
          modifiers?: Array<{ modifier_id: number; quantity?: number }>;
          notes?: string;
        }>;
        branch_id?: number;
      }
  >;
  notes?: string;
  discount_code?: string;
  loyalty_points_to_redeem?: number;
  /** Tender split for per-tender GST (cash vs card). */
  payment_split?: { cash_amount?: number; card_amount?: number };
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
  /** Which tender(s) drove the GST + the applied cash/card rates (fractions). */
  tax_basis?: 'cash' | 'card' | 'split';
  tax_rate_cash?: number;
  tax_rate_card?: number;
  service_charge: number;
  delivery_fee: number;
  total_amount: number;
  line_breakdown?: OrderQuoteLineBreakdown[];
}

export type OrderQuoteRequest = {
  branch_id: number;
  order_type: string;
  items: CreateOrderRequest['items'];
  discount_code?: string;
  customer_phone?: string;
  loyalty_points_to_redeem?: number;
  /** Tender split for per-tender GST (cash vs card). */
  payment_split?: { cash_amount?: number; card_amount?: number };
};

export const orderService = {
  getQuote: async (data: OrderQuoteRequest): Promise<OrderQuoteResponse> => {
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

  /** Look up a pending kiosk "pay at counter" cart by its short code. */
  lookupKioskOrder: async (code: string, branchId: number): Promise<KioskLookupResponse> => {
    const response = await apiClient.get<KioskLookupResponse>(
      `/pos/kiosk-orders/${encodeURIComponent(code)}`,
      { params: { branch_id: branchId } },
    );
    return response.data;
  },

  /** Finalize a kiosk cart (possibly edited): creates the order with source=kiosk and records payments. */
  finalizeKioskOrder: async (code: string, body: KioskFinalizeRequest): Promise<CreateOrderResponse> => {
    const response = await apiClient.post<CreateOrderResponse>(
      `/pos/kiosk-orders/${encodeURIComponent(code)}/finalize`,
      body,
    );
    return response.data;
  },
};

export interface KioskLookupResponse {
  kiosk_code: string;
  branch_id: number;
  order_type: string;
  customer_name: string | null;
  customer_phone: string | null;
  payload: {
    branch_id: number;
    order_type: string;
    customer_name?: string;
    customer_phone?: string;
    items: CreateOrderRequest['items'];
    notes?: string;
    discount_code?: string;
  };
  items: CreateOrderRequest['items'];
  snapshot_total: number;
  current_total: number;
  price_changed: boolean;
  items_dropped: boolean;
  quote: OrderQuoteResponse | null;
}

export interface KioskFinalizeRequest {
  branch_id: number;
  order?: CreateOrderRequest;
  payments: Array<{ method: 'cash' | 'card'; amount: number }>;
}
