/**
 * Shapes shared by the push-message entities, services and the admin API.
 * Stored as jsonb, so keep them plain data (no classes, no Dates).
 */

/** One audience rule: `rule` names an entry in AUDIENCE_RULES. */
export interface AudienceRuleInput {
    rule: string;
    params?: Record<string, unknown>;
}

/**
 * "Send to customers who … (all / any of `include`) but not … (any of
 * `exclude`)". An empty `include` means every app customer.
 */
export interface AudienceSpec {
    match: 'all' | 'any';
    include: AudienceRuleInput[];
    exclude: AudienceRuleInput[];
}

export const EMPTY_AUDIENCE: AudienceSpec = {
    match: 'all',
    include: [],
    exclude: [],
};

export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'every_n_days';

/**
 * A repeating schedule, read in the message's time zone.
 * - daily: every day at `time`
 * - weekly: on `weekdays` (0 = Sunday … 6 = Saturday) at `time`
 * - monthly: on `month_day` (1–31; past the month's end = its last day; -1 = last day)
 * - every_n_days: every `interval_days` days counted from `starts_on`
 */
export interface RepeatRule {
    frequency: RepeatFrequency;
    time: string; // HH:mm
    weekdays?: number[];
    month_day?: number;
    interval_days?: number;
    starts_on: string; // YYYY-MM-DD
    ends: 'never' | 'on' | 'after';
    ends_on?: string | null; // YYYY-MM-DD, inclusive
    max_runs?: number | null;
}

export type ScheduleType = 'now' | 'once' | 'repeat';

export type PushMessageStatus =
    | 'draft'
    | 'scheduled'
    | 'active'
    | 'paused'
    | 'sending'
    | 'sent'
    | 'completed'
    | 'cancelled'
    | 'failed';

export type PerCustomer = 'every' | 'once' | 'days';

export interface VariantB {
    title: string;
    body: string;
}

/** Stored reach of a message's author (absent key = unrestricted). */
export interface PushAudienceScope {
    brand_ids?: number[];
    branch_ids?: number[];
}

/** The viewer's reach, from RoleAccessGuard (null = unrestricted). */
export interface PushViewerScope {
    tenantId: number;
    allowedBranchIds: number[] | null;
    allowedBrandIds: number[] | null;
}
