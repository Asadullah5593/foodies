import apiClient from '../../utils/apiClient';

/** Read-only "Rider supervisor" sub-module (Rider HRM). Admin-facing endpoints,
 *  scoped server-side to the caller's branch(es)/brand(s). */

export type SupervisorDeliveryStatus = 'active' | 'delivered' | 'cancelled' | 'all';

export interface SupervisorDeliveryOrder {
  id: number;
  order_id: string | null;
  order_number: string;
  /** null when the caller lacks rider-supervisor:view-status. */
  status: string | null;
  delivery_status: string | null;
  placed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  total_amount: number;
  delivery_fee: number;
  delivery_tier: string | null;
  delivery_address: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  brand_id: number | null;
  brand_name: string | null;
  branch_id: number;
  branch_name: string | null;
  rider_id: number | null;
  rider_name: string | null;
}

export interface SupervisorDeliveryOrdersResponse {
  data: SupervisorDeliveryOrder[];
  total: number;
  page: number;
  page_size: number;
  status: SupervisorDeliveryStatus;
  /** null when the caller lacks rider-supervisor:view-status. */
  counts: { active: number; delivered: number; cancelled: number; all: number } | null;
  /** Placement-date range actually applied (null = default window). */
  date_from?: string | null;
  date_to?: string | null;
  /** Role history window in days; null = unlimited. */
  history_days?: number | null;
  /** Whether the server included order status in this payload. */
  can_view_status?: boolean;
}

export type SupervisorRiderStatus = 'active' | 'on_break' | 'off';

export interface SupervisorRider {
  rider_user_id: number;
  name: string;
  phone: string | null;
  email: string | null;
  base_salary: number | null;
  salary_type: string | null;
  employment_status: string | null;
  status: SupervisorRiderStatus;
  is_checked_in: boolean;
  is_paused: boolean;
  pause_reason: string | null;
  branch_id: number | null;
  branch_name: string | null;
  brands: string[];
  last_heartbeat_at: string | null;
  last_check_in_at: string | null;
  last_check_out_at: string | null;
  attendance_status: string | null;
}

export interface SupervisorFilterOption {
  id: number;
  name: string;
  /** Branches carry it; the brand list is already filtered to active ones. */
  is_active?: boolean;
}

export interface SupervisorFilterOptions {
  brands: SupervisorFilterOption[];
  branches: SupervisorFilterOption[];
  riders: SupervisorFilterOption[];
  /**
   * How many days of order history this role may read (roles.order_history_days).
   * null = unlimited. Used to bound the date pickers.
   */
  history_days: number | null;
}

export const riderSupervisorService = {
  getDeliveryOrders: async (params: {
    status?: SupervisorDeliveryStatus;
    page?: number;
    page_size?: number;
    brand_id?: number;
    branch_id?: number;
    rider_id?: number;
    /** YYYY-MM-DD, on order placement date. */
    date_from?: string;
    date_to?: string;
  }): Promise<SupervisorDeliveryOrdersResponse> => {
    const response = await apiClient.get<SupervisorDeliveryOrdersResponse>(
      '/admin/rider-hrm/supervisor/delivery-orders',
      { params }
    );
    return response.data;
  },

  getRiders: async (
    params: {
      branch_id?: number;
      brand_id?: number;
      status?: SupervisorRiderStatus;
      rider_id?: number;
    } = {}
  ): Promise<SupervisorRider[]> => {
    const response = await apiClient.get<SupervisorRider[]>(
      '/admin/rider-hrm/supervisor/riders',
      { params }
    );
    return Array.isArray(response.data) ? response.data : [];
  },

  getFilterOptions: async (): Promise<SupervisorFilterOptions> => {
    const response = await apiClient.get<SupervisorFilterOptions>(
      '/admin/rider-hrm/supervisor/filters'
    );
    const d = response.data;
    return {
      brands: Array.isArray(d?.brands) ? d.brands : [],
      branches: Array.isArray(d?.branches) ? d.branches : [],
      riders: Array.isArray(d?.riders) ? d.riders : [],
      history_days: typeof d?.history_days === 'number' ? d.history_days : null,
    };
  },
};
