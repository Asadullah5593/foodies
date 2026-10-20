import apiClient from '../../utils/apiClient';
import type {
  PushAudienceCounts,
  PushAudienceSpec,
  PushCustomerInfo,
  PushListTab,
  PushMessageDetail,
  PushMessageList,
  PushMessagePayload,
  PushMeta,
  PushMoment,
  PushOverview,
  PushPerCustomer,
  PushRecipientRow,
  PushRepeatRule,
  PushSavedAudience,
  PushScheduleType,
  PushSettings,
  PushTemplate,
  PushTestResult,
} from '../../types';

const BASE = '/admin/push-notifications';

/** Admin push notifications to app customers (backend: push-messages module). */
export const pushService = {
  meta: async () => (await apiClient.get(`${BASE}/meta`)).data as PushMeta,

  overview: async () => (await apiClient.get(`${BASE}/overview`)).data as PushOverview,

  previewAudience: async (body: {
    audience?: PushAudienceSpec;
    audience_id?: number | null;
    skip_order_in_progress?: boolean;
    respect_cap?: boolean;
    message_id?: number | null;
    per_customer?: PushPerCustomer;
    per_customer_days?: number | null;
  }) => (await apiClient.post(`${BASE}/audience/preview`, body)).data as PushAudienceCounts,

  previewSchedule: async (body: {
    schedule_type: PushScheduleType;
    send_at?: string | null;
    repeat?: PushRepeatRule | null;
    skip_dates?: string[];
    runs_count?: number;
  }) =>
    (await apiClient.post(`${BASE}/schedule/preview`, body)).data as {
      timezone: string;
      occurrences: PushMoment[];
      ends: 'never_sends' | null;
    },

  test: async (body: {
    title: string;
    body: string;
    image_url?: string | null;
    expiry_hours?: number;
    replace_previous?: boolean;
    phones?: string[];
  }) => (await apiClient.post(`${BASE}/test`, body)).data as { results: PushTestResult[] },

  list: async (params: { status?: PushListTab | ''; search?: string; page?: number; limit?: number }) =>
    (await apiClient.get(`${BASE}/messages`, { params })).data as PushMessageList,

  detail: async (id: number) => (await apiClient.get(`${BASE}/messages/${id}`)).data as PushMessageDetail,

  create: async (payload: PushMessagePayload) =>
    (await apiClient.post(`${BASE}/messages`, payload)).data as PushMessageDetail,

  update: async (id: number, payload: PushMessagePayload) =>
    (await apiClient.put(`${BASE}/messages/${id}`, payload)).data as PushMessageDetail,

  action: async (id: number, action: 'pause' | 'resume' | 'cancel' | 'skip-next' | 'duplicate') =>
    (await apiClient.post(`${BASE}/messages/${id}/${action}`)).data as PushMessageDetail,

  remove: async (id: number) => (await apiClient.delete(`${BASE}/messages/${id}`)).data as { deleted: boolean },

  recipients: async (
    id: number,
    params: { run_id?: number; status?: string; search?: string; page?: number; limit?: number },
  ) =>
    (await apiClient.get(`${BASE}/messages/${id}/recipients`, { params })).data as {
      data: PushRecipientRow[];
      total: number;
      page: number;
      limit: number;
    },

  recipientsCsv: async (id: number, params: { run_id?: number; status?: string }) =>
    (await apiClient.get(`${BASE}/messages/${id}/recipients.csv`, { params, responseType: 'blob' }))
      .data as Blob,

  audiences: async () => (await apiClient.get(`${BASE}/audiences`)).data as PushSavedAudience[],

  saveAudience: async (
    body: { name: string; description?: string | null; rules: PushAudienceSpec },
    id?: number,
  ) =>
    (id
      ? await apiClient.put(`${BASE}/audiences/${id}`, body)
      : await apiClient.post(`${BASE}/audiences`, body)
    ).data as PushSavedAudience,

  deleteAudience: async (id: number) => (await apiClient.delete(`${BASE}/audiences/${id}`)).data,

  templates: async () => (await apiClient.get(`${BASE}/templates`)).data as PushTemplate[],

  saveTemplate: async (
    body: { name: string; title: string; body: string; image_url?: string | null },
    id?: number,
  ) =>
    (id
      ? await apiClient.put(`${BASE}/templates/${id}`, body)
      : await apiClient.post(`${BASE}/templates`, body)
    ).data as PushTemplate,

  deleteTemplate: async (id: number) => (await apiClient.delete(`${BASE}/templates/${id}`)).data,

  settings: async () => (await apiClient.get(`${BASE}/settings`)).data as PushSettings,

  saveSettings: async (body: Partial<PushSettings>) =>
    (await apiClient.put(`${BASE}/settings`, body)).data as PushSettings,

  syncDevices: async () =>
    (await apiClient.post(`${BASE}/devices/sync`)).data as { synced: number; removed: number },

  customer: async (id: number) => (await apiClient.get(`${BASE}/customers/${id}`)).data as PushCustomerInfo,

  setOptOut: async (id: number, optOut: boolean) =>
    (await apiClient.put(`${BASE}/customers/${id}/opt-out`, { opt_out: optOut })).data as PushCustomerInfo,
};
