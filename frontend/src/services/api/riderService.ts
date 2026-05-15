import apiClient from '../../utils/apiClient';
import { RiderAttendanceStatus } from '../../types';

export interface RiderBranch {
  id: number;
  name: string;
  code: string;
  address: string | null;
}

export interface RiderAttendanceSession {
  id: number;
  rider_user_id: number;
  branch_id: number;
  status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  notes: string | null;
}

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

/** Axios config to bypass browser cache so we always get a full response (avoids 304 with missing body). */
const noCache = {
  headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' as const },
  params: { _: Date.now() },
};

function normalizeOrdersPayload(data: unknown): RiderOrder[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    return (data as { data: RiderOrder[] }).data;
  }
  return [];
}

export const riderService = {
  getAttendanceStatus: async (): Promise<RiderAttendanceStatus> => {
    const response = await apiClient.get<RiderAttendanceStatus>('/rider/attendance/status', noCache);
    return response.data;
  },

  sendAttendanceHeartbeat: async (payload: {
    latitude?: number;
    longitude?: number;
  }): Promise<RiderAttendanceStatus> => {
    const response = await apiClient.patch<RiderAttendanceStatus>(
      '/rider/attendance/heartbeat',
      payload
    );
    return response.data;
  },

  getMyBranches: async (): Promise<RiderBranch[]> => {
    const response = await apiClient.get<RiderBranch[]>('/rider/attendance/branches', noCache);
    return Array.isArray(response.data) ? response.data : [];
  },

  checkIn: async (payload: {
    branch_id: number;
    notes?: string;
  }): Promise<RiderAttendanceSession> => {
    const response = await apiClient.post<RiderAttendanceSession>(
      '/rider/attendance/check-in',
      payload
    );
    return response.data;
  },

  checkOut: async (payload?: { notes?: string }): Promise<RiderAttendanceSession> => {
    const response = await apiClient.post<RiderAttendanceSession>(
      '/rider/attendance/check-out',
      payload ?? {}
    );
    return response.data;
  },

  setAttendancePause: async (payload: {
    is_paused: boolean;
    pause_reason?: string;
  }): Promise<{
    rider_user_id: number;
    is_checked_in: boolean;
    is_paused: boolean;
    pause_reason: string | null;
  }> => {
    const response = await apiClient.patch('/rider/attendance/pause', payload);
    return response.data;
  },

  getOrders: async (): Promise<RiderOrder[]> => {
    const response = await apiClient.get<unknown>('/rider/orders', noCache);
    return normalizeOrdersPayload(response.data);
  },

  getOrder: async (id: number): Promise<RiderOrder> => {
    const response = await apiClient.get<RiderOrder>(`/rider/orders/${id}`, noCache);
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
