import apiClient from '../../utils/apiClient';

/** Read-only "Rider supervisor" sub-module (Rider HRM). Admin-facing endpoints,
 *  scoped server-side to the caller's branch(es)/brand(s). */

export type SupervisorDeliveryStatus = 'active' | 'delivered' | 'cancelled' | 'all';

export interface SupervisorDeliveryOrder {
  id: number;
  order_id: string | null;
  order_number: string;
  status: string;
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
  counts: { active: number; delivered: number; cancelled: number; all: number };
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
}

export interface SupervisorFilterOptions {
  brands: SupervisorFilterOption[];
  branches: SupervisorFilterOption[];
}

export const riderSupervisorService = {
  getDeliveryOrders: async (params: {
    status?: SupervisorDeliveryStatus;
    page?: number;
    page_size?: number;
    brand_id?: number;
    branch_id?: number;
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
    };
  },
};
