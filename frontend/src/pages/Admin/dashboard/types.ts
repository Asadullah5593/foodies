/** Response shapes for the admin dashboard report endpoints. */

export interface DashboardSummary {
  date_from: string;
  date_to: string;
  branch_id: number | null;
  brand_id: number | null;
  /** Per-brand sales breakdown (orders are single-brand). */
  sales_by_brand: Array<{
    brand_id: number;
    brand_name: string;
    orders: number;
    completed_orders: number;
    revenue: number;
  }>;
  /** Per-branch sales breakdown (used by brand-specific dashboards). */
  sales_by_branch: Array<{
    branch_id: number;
    branch_name: string;
    orders: number;
    completed_orders: number;
    revenue: number;
  }>;
  kpis: {
    total_revenue: number;
    completed_orders: number;
    total_orders: number;
    average_order_value: number;
    completion_rate: number; // 0..1
    total_discounts: number;
    /** The split behind total_discounts; `card` is funded by the bank. */
    discount_breakdown?: {
      product_promotion: number;
      discount: number;
      coupon: number;
      card: number;
      merchant_funded: number;
      bank_funded: number;
    };
    total_tax: number;
    total_service_charge: number;
    total_delivery_fee: number;
    active_riders: number;
    avg_brand_rating: number | null;
    avg_rider_rating: number | null;
  };
  deltas: {
    revenue_pct: number | null;
    orders_pct: number | null;
    aov_pct: number | null;
  };
  orders_by_status: Array<{ status: string; count: number }>;
  orders_by_type: Array<{ type: string; count: number; revenue: number }>;
  orders_by_source: Array<{ source: string; count: number; revenue: number }>;
  payments_by_method: Array<{ method: string; amount: number; count: number }>;
  time_series: Array<{
    day: string;
    orders: number;
    revenue: number;
    completed_revenue: number;
    completed_orders: number;
  }>;
  top_items: Array<{
    menu_item_id: number;
    name: string;
    quantity: number;
    total_revenue: number;
  }>;
  delivery: {
    by_status: Array<{ status: string; count: number }>;
    active_riders: number;
    paused_riders: number;
  };
  ratings: {
    avg_brand: number | null;
    brand_count: number;
    avg_rider: number | null;
    rider_count: number;
    by_brand: Array<{ id: number; name: string; avg: number; count: number }>;
    by_rider: Array<{ id: number; name: string; avg: number; count: number }>;
    recent_comments: Array<{
      type: 'brand' | 'rider';
      stars: number;
      comment: string;
      created_at: string;
    }>;
  };
}

export interface RecentOrder {
  id: number;
  order_number: string;
  order_type: string;
  source: string;
  status: string;
  delivery_status: string | null;
  total_amount: number;
  customer_name: string | null;
  placed_at: string;
}

export interface InventoryAlerts {
  low_stock: Array<{
    item_id: number;
    name: string;
    branch_id: number;
    qty: number;
    reorder_point: number;
  }>;
  recent_wastage: Array<{
    item_id: number;
    name: string;
    qty: number;
    reason: string;
    created_at: string;
  }>;
}
