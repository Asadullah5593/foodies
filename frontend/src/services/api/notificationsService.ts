import apiClient from '../../utils/apiClient';
import type { ClientNotification } from '../../stores/notificationsStore';

export interface NotificationEventCatalogItem {
  type: string;
  label: string;
  description: string;
  category: string;
  surface: string;
  severity: string;
  defaultRoleSlugs: string[];
  sound: boolean;
  repeatSound: boolean;
}

export interface NotificationSettingRow {
  id: number;
  tenantId: number;
  eventType: string;
  branchId: number | null;
  brandId: number | null;
  targetRoleIds: number[];
  soundEnabled: boolean;
  isEnabled: boolean;
}

export interface UpsertNotificationSettingPayload {
  event_type: string;
  branch_id?: number | null;
  brand_id?: number | null;
  target_role_ids: number[];
  sound_enabled?: boolean;
  is_enabled?: boolean;
}

export const notificationsService = {
  // —— Staff (live notifications) ——
  getOpen: async (): Promise<ClientNotification[]> =>
    (await apiClient.get('/notifications/open')).data ?? [],
  act: async (id: number, actionKey: string) =>
    (await apiClient.post(`/notifications/${id}/act`, { action_key: actionKey }))
      .data,
  markRead: async (id: number) =>
    (await apiClient.post(`/notifications/${id}/read`)).data,
  markAllRead: async () =>
    (await apiClient.post('/notifications/read-all')).data,

  // —— Admin (config) ——
  getSettings: async (): Promise<{
    events: NotificationEventCatalogItem[];
    settings: NotificationSettingRow[];
  }> => (await apiClient.get('/admin/notification-settings')).data,
  upsertSetting: async (payload: UpsertNotificationSettingPayload) =>
    (await apiClient.put('/admin/notification-settings', payload)).data,
  deleteSetting: async (id: number) =>
    (await apiClient.delete(`/admin/notification-settings/${id}`)).data,

  // —— Order actions reused by the POS notification stack ——
  setOrderStatus: async (orderId: number, status: string) =>
    (await apiClient.put(`/admin/orders/${orderId}/status`, { status })).data,

  // —— Inventory alert sweeps (manual trigger / testing) ——
  runInventorySweeps: async () =>
    (await apiClient.post('/admin/inventory/alerts/run')).data,
};
