import apiClient from '../../utils/apiClient';

/** A row as the list endpoint returns it (payload and diff are detail-only). */
export interface ActivityLogRow {
  id: string;
  created_at: string;
  request_id: string | null;
  actor_type: string;
  actor_user_id: number | null;
  actor_label: string | null;
  actor_role_slugs: string[] | null;
  actor_role_names: string[] | null;
  actor_is_super_admin: boolean;
  tenant_id: number | null;
  branch_id: number | null;
  brand_id: number | null;
  action: string;
  action_group: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string | null;
  http_method: string | null;
  route: string | null;
  status_code: number | null;
  outcome: string;
  duration_ms: number | null;
  changed_fields: string[] | null;
  ip: string | null;
  payload_truncated: boolean;
  diff_expected: boolean;
}

export interface ActivityLogDetail extends ActivityLogRow {
  query: Record<string, unknown> | null;
  request_body: Record<string, unknown> | null;
  response_meta: Record<string, unknown> | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  user_agent: string | null;
  session_id: string | null;
  device_id: string | null;
  actor_customer_id: number | null;
}

export interface ActivityLogPage {
  data: ActivityLogRow[];
  total: number;
  page: number;
  page_size: number;
  outcome_counts: Record<string, number>;
}

export interface ActivityLogFilterOptions {
  actions: string[];
  action_groups: string[];
  actors: Array<{ actor_user_id: number; actor_label: string }>;
  outcomes: string[];
  actor_types: string[];
  max_window_days: number;
}

export interface ActivityLogRelated {
  id: string;
  created_at: string;
  action: string;
  outcome: string;
  status_code: number | null;
  route: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

export interface ActivityLogQuery {
  date_from?: string;
  date_to?: string;
  actor_user_id?: number | null;
  actor_type?: string;
  action?: string;
  action_group?: string;
  entity_type?: string;
  entity_id?: string;
  outcome?: string;
  request_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

const toParams = (q: ActivityLogQuery): string => {
  const params = new URLSearchParams();
  Object.entries(q).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.append(key, String(value));
  });
  return params.toString();
};

/**
 * Read-only client for the audit trail. There is deliberately no create, update
 * or delete: the log is append-only, and expiring history is a server-side
 * partition drop, never an API call from a screen.
 */
export const activityLogService = {
  async list(query: ActivityLogQuery): Promise<ActivityLogPage> {
    const response = await apiClient.get<ActivityLogPage>(
      `/admin/activity-logs?${toParams(query)}`
    );
    return response.data;
  },

  async filterOptions(): Promise<ActivityLogFilterOptions> {
    const response = await apiClient.get<ActivityLogFilterOptions>(
      '/admin/activity-logs/filter-options'
    );
    return response.data;
  },

  /** created_at is required: the PK is (created_at, id), so it prunes partitions. */
  async detail(id: string, createdAt: string): Promise<ActivityLogDetail> {
    const response = await apiClient.get<ActivityLogDetail>(
      `/admin/activity-logs/${id}?created_at=${encodeURIComponent(createdAt)}`
    );
    return response.data;
  },

  async related(requestId: string, createdAt: string): Promise<ActivityLogRelated[]> {
    const response = await apiClient.get<ActivityLogRelated[]>(
      `/admin/activity-logs/related/${requestId}?created_at=${encodeURIComponent(createdAt)}`
    );
    return response.data;
  },

  /** History of one record — powers the History drawer on a record page. */
  async forEntity(entityType: string, entityId: string): Promise<ActivityLogRow[]> {
    const response = await apiClient.get<ActivityLogRow[]>(
      `/admin/activity-logs/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`
    );
    return response.data;
  },
};
