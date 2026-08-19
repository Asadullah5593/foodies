import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { ActivityLogWriter } from './activity-log.writer';
import { ActivityLogArchiveService } from './activity-log-archive.service';
import * as bcrypt from 'bcryptjs';
import { clientIp } from './activity-log.actor';
import { isEnabled } from './activity-log.config';
import type { ClientEventDto } from './client-event.dto';

export interface ActivityLogFilters {
    date_from?: string;
    date_to?: string;
    actor_user_id?: number;
    actor_type?: string;
    action?: string;
    action_group?: string;
    entity_type?: string;
    entity_id?: string;
    outcome?: string;
    branch_id?: number;
    brand_id?: number;
    request_id?: string;
    /** Free text over actor label, action, route and entity label. */
    search?: string;
    page?: number;
    page_size?: number;
}

const DEFAULT_WINDOW_DAYS = 7;
/** Hard ceiling. A year-wide query would defeat partition pruning entirely. */
const MAX_WINDOW_DAYS = 92;
/** Wider ceiling when the query names one record — see resolveRange. */
const MAX_ENTITY_WINDOW_DAYS = 400;
/** Nothing inside this window can be purged, by any role. See purgeMonth. */
const PURGE_FLOOR_DAYS = 90;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

/** Columns the list returns — the payload and diff are detail-only. */
export interface ActivityLogListRow {
    id: string;
    created_at: Date;
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

export interface ActivityLogDetailRow extends ActivityLogListRow {
    query: Record<string, unknown> | null;
    request_body: Record<string, unknown> | null;
    response_meta: Record<string, unknown> | null;
    changes: Record<string, { before: unknown; after: unknown }> | null;
    user_agent: string | null;
    session_id: string | null;
    device_id: string | null;
    actor_customer_id: number | null;
}

export interface ActivityLogRelatedRow {
    id: string;
    created_at: Date;
    action: string;
    outcome: string;
    status_code: number | null;
    route: string | null;
    entity_type: string | null;
    entity_id: string | null;
}

export interface ActivityLogHistoryRow {
    id: string;
    created_at: Date;
    actor_label: string | null;
    actor_role_names: string[] | null;
    action: string;
    outcome: string;
    changes: Record<string, { before: unknown; after: unknown }> | null;
    changed_fields: string[] | null;
}

/**
 * Which `action_group`s each per-module permission unlocks. The groups already
 * exist on every row, so a narrow grant is an indexed equality check rather
 * than a second taxonomy to keep in sync.
 */
export const MODULE_GROUPS: Record<string, string[]> = {
    'activity-log:view:access': ['access'],
    'activity-log:view:menu': ['menu'],
    'activity-log:view:offers': ['offers'],
    'activity-log:view:shifts': ['shifts'],
    'activity-log:view:inventory': ['inventory'],
    'activity-log:view:orders': ['orders'],
    'activity-log:view:auth': ['auth'],
    'activity-log:view:system': ['reports', 'audit', 'client', 'other'],
};

/**
 * The action groups a user may read. `null` means unrestricted.
 *
 * Enforced server-side rather than by hiding UI: a narrow grant has to be a
 * boundary, not a suggestion.
 */
export function allowedGroupsFor(
    permissions: string[] | undefined,
    isSuperAdmin: boolean,
): string[] | null {
    if (isSuperAdmin) return null;
    const held = permissions ?? [];
    if (held.includes('activity-log:view')) return null;
    const groups = new Set<string>();
    for (const [permission, mapped] of Object.entries(MODULE_GROUPS)) {
        if (held.includes(permission)) mapped.forEach((g) => groups.add(g));
    }
    return [...groups];
}

const OUTCOMES = ['success', 'denied', 'failed', 'error'] as const;
const ACTOR_TYPES = [
    'staff',
    'rider',
    'customer',
    'kiosk',
    'anonymous',
    'system',
] as const;

/**
 * Read side of the activity log. Deliberately read-only: this service exposes
 * no create, update or delete. Rows are written by ActivityLogWriter, and the
 * table's trigger refuses modification anyway (§9 of the plan).
 *
 * **Every query is date-bounded.** That is not a nicety: the table is
 * partitioned monthly, and an unbounded query would scan every partition —
 * including archived months restored for an investigation. The bound is
 * enforced here rather than trusted to the caller.
 */
@Injectable()
export class ActivityLogService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly writer: ActivityLogWriter,
        private readonly archive: ActivityLogArchiveService,
    ) {}

    /**
     * Archive and purge one past month.
     *
     * Four things stand between an admin and the destruction of audit history,
     * and all four are enforced here rather than in the UI:
     *
     * 1. `activity-log:purge`, a permission held by nobody by default.
     * 2. The caller re-enters their OWN password (bcrypt-compared).
     * 3. A 90-day floor: the recent past cannot be erased by anyone, ever —
     *    which is precisely the history someone covering their tracks wants.
     * 4. Archive → verify → drop. The month is written out and read back
     *    before the partition is dropped, so a purge is a MOVE, not a delete.
     *
     * The purge writes its own audit row into the current partition, which by
     * rule 3 can never itself be purged.
     */
    async purgeMonth(
        month: string,
        password: string,
        actor: {
            id: number;
            tenantId: number | null;
            name?: string;
            email?: string;
        },
    ): Promise<{ month: string; rows: number; archive: string }> {
        if (!/^\d{4}-\d{2}$/.test(month)) {
            throw new BadRequestException('month must be YYYY-MM');
        }
        // 1. Re-authenticate. Same comparison the login path uses.
        const rows = await this.dataSource.query<Array<{ password: string }>>(
            'SELECT password FROM users WHERE id = $1',
            [actor.id],
        );
        const hash = rows[0]?.password;
        const ok =
            typeof hash === 'string' &&
            hash.length > 0 &&
            (await bcrypt.compare(password ?? '', hash));
        if (!ok) {
            // The failed attempt is itself worth recording.
            await this.writer.writeImmediate({
                ...this.writer.systemRow(
                    'activity-log.purge.denied',
                    `Purge of ${month} refused: password re-entry failed`,
                ),
                actorType: 'staff',
                actorUserId: actor.id,
                actorLabel: actor.name ?? actor.email ?? `user#${actor.id}`,
                tenantId: actor.tenantId,
                outcome: 'denied',
            });
            throw new ForbiddenException('Password is incorrect');
        }

        // 3. The floor. Computed from the END of the month being purged.
        const [year, mon] = month.split('-').map(Number);
        const monthEnd = new Date(Date.UTC(year, mon, 1));
        const ageDays = (Date.now() - monthEnd.getTime()) / 86_400_000;
        if (ageDays < PURGE_FLOOR_DAYS) {
            throw new BadRequestException(
                `${month} is too recent to purge. Nothing inside the last ${PURGE_FLOOR_DAYS} days can be removed, by any role.`,
            );
        }

        const partition = `activity_logs_${year}_${String(mon).padStart(2, '0')}`;
        const exists = await this.dataSource.query<Array<{ exists: boolean }>>(
            'SELECT to_regclass($1) IS NOT NULL AS exists',
            [partition],
        );
        if (!exists[0]?.exists) {
            throw new BadRequestException(
                `${month} is not held in the database`,
            );
        }

        // 4. Archive, verify, and only then drop.
        const result = await this.archive.archivePartition(partition);
        if (!result.verified) {
            throw new BadRequestException(
                'Archive could not be verified — nothing was deleted',
            );
        }
        await this.dataSource.query(`DROP TABLE IF EXISTS ${partition}`);

        await this.writer.writeImmediate({
            ...this.writer.systemRow(
                'activity-log.purge',
                `Purged ${month}: ${result.rowCount} rows archived to ${result.key} (sha256 ${result.sha256.slice(0, 16)}…)`,
            ),
            actorType: 'staff',
            actorUserId: actor.id,
            actorLabel: actor.name ?? actor.email ?? `user#${actor.id}`,
            tenantId: actor.tenantId,
            entityType: 'activity_log_month',
            entityId: month,
        });

        return { month, rows: result.rowCount, archive: result.key };
    }

    /**
     * Record events the server would otherwise never see — a print dialog, a
     * CSV download, a sensitive screen being opened.
     *
     * The batch is capped and every field the client sends is either validated
     * against a closed enum (action, subject) or bounded (label). Identity is
     * taken from the JWT, never the body.
     */
    recordClientEvents(
        events: ClientEventDto[],
        user: {
            id: number;
            tenantId: number | null;
            name?: string;
            email?: string;
            isSuperAdmin?: boolean;
            roles?: Array<{ slug: string; name: string }>;
        },
        req: Request,
    ): { accepted: number } {
        if (!isEnabled() || !Array.isArray(events) || events.length === 0) {
            return { accepted: 0 };
        }
        // A browser cannot be trusted to bound its own batch.
        const batch = events.slice(0, 50);
        const headers = req.headers as unknown as Record<string, unknown>;
        const header = (name: string, max = 64): string | null => {
            const v = headers[name];
            return typeof v === 'string' && v.trim()
                ? v.trim().slice(0, max)
                : null;
        };
        const roles = user.roles ?? [];

        for (const event of batch) {
            this.writer.enqueue({
                createdAt: new Date(),
                requestId: header('x-request-id', 36),
                sessionId: header('x-session-id'),
                deviceId: header('x-device-id'),
                actorType: 'staff',
                actorUserId: user.id,
                actorCustomerId: null,
                actorLabel: user.name ?? user.email ?? `user#${user.id}`,
                actorRoleSlugs: roles.length ? roles.map((r) => r.slug) : null,
                actorRoleNames: roles.length ? roles.map((r) => r.name) : null,
                actorIsSuperAdmin: user.isSuperAdmin === true,
                tenantId: user.tenantId,
                branchId: event.branch_id ?? null,
                brandId: event.brand_id ?? null,
                action: event.action,
                actionGroup: 'client',
                entityType: event.subject,
                entityId:
                    event.entity_id != null ? String(event.entity_id) : null,
                entityLabel: event.label ?? null,
                // The distinction that keeps the print trail meaningful.
                summary:
                    event.trigger === 'auto'
                        ? `${event.subject} (automatic, no user action)`
                        : null,
                httpMethod: null,
                route: null,
                query: null,
                requestBody: { trigger: event.trigger ?? 'user' },
                responseMeta: null,
                statusCode: null,
                outcome: 'success',
                durationMs: null,
                changes: null,
                changedFields: null,
                ip: clientIp(headers, req.ip),
                userAgent: header('user-agent', 400),
                payloadTruncated: false,
                diffExpected: false,
            });
        }
        return { accepted: batch.length };
    }

    /**
     * Resolve the window, clamped to MAX_WINDOW_DAYS.
     *
     * Dates are read as local days (the branch clock) and the end is pushed to
     * 23:59:59.999, matching how the reports module reads a range — a user who
     * types 5 Aug to 5 Aug means that whole day, not a zero-width instant.
     */
    private resolveRange(filters: ActivityLogFilters): {
        from: Date;
        to: Date;
    } {
        const parseDay = (v: string | undefined, endOfDay: boolean) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? '').trim());
            if (!m) return null;
            return new Date(
                +m[1],
                +m[2] - 1,
                +m[3],
                endOfDay ? 23 : 0,
                endOfDay ? 59 : 0,
                endOfDay ? 59 : 0,
                endOfDay ? 999 : 0,
            );
        };

        const to = parseDay(filters.date_to, true) ?? new Date();
        const from =
            parseDay(filters.date_from, false) ??
            new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

        if (from > to) {
            throw new BadRequestException('date_from must be before date_to');
        }
        const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
        // Asking for ONE record's history is a different query shape: the
        // (entity_type, entity_id, created_at DESC) index makes it selective
        // enough that a wider window is affordable, and "every price this item
        // ever had" is the whole point of the record lens. Still bounded.
        const limit =
            filters.entity_type && filters.entity_id
                ? MAX_ENTITY_WINDOW_DAYS
                : MAX_WINDOW_DAYS;
        if (spanDays > limit) {
            throw new BadRequestException(
                `Date range is limited to ${limit} days. Narrow the range, or read an archived month instead.`,
            );
        }
        return { from, to };
    }

    /** Builds the shared WHERE clause. Every value is parameterised. */
    private buildWhere(
        filters: ActivityLogFilters,
        tenantId: number | null,
        allowedBranchIds: number[] | null | undefined,
        allowedGroups?: string[] | null,
    ): { sql: string; params: unknown[] } {
        const { from, to } = this.resolveRange(filters);
        const params: unknown[] = [from, to];
        const clauses = ['created_at BETWEEN $1 AND $2'];

        const add = (clause: string, value: unknown) => {
            params.push(value);
            clauses.push(clause.replace('?', `$${params.length}`));
        };

        // Super admins (tenantId null) see everything; everyone else is scoped.
        if (tenantId != null) add('tenant_id = ?', tenantId);

        // Branch-restricted staff see only their branches' rows, plus the rows
        // that carry no branch at all (logins, tenant-level admin).
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            params.push(allowedBranchIds);
            clauses.push(
                `(branch_id IS NULL OR branch_id = ANY($${params.length}))`,
            );
        }

        // A narrow grant caps what can be seen, whatever the filters ask for.
        if (allowedGroups != null) {
            if (allowedGroups.length === 0) {
                clauses.push('FALSE');
            } else {
                params.push(allowedGroups);
                clauses.push(`action_group = ANY($${params.length})`);
            }
        }

        if (filters.actor_user_id)
            add('actor_user_id = ?', filters.actor_user_id);
        if (
            filters.actor_type &&
            ACTOR_TYPES.includes(filters.actor_type as never)
        )
            add('actor_type = ?', filters.actor_type);
        if (filters.action) add('action = ?', filters.action);
        if (filters.action_group) add('action_group = ?', filters.action_group);
        if (filters.entity_type) add('entity_type = ?', filters.entity_type);
        if (filters.entity_id) add('entity_id = ?', filters.entity_id);
        if (filters.outcome && OUTCOMES.includes(filters.outcome as never))
            add('outcome = ?', filters.outcome);
        if (filters.branch_id) add('branch_id = ?', filters.branch_id);
        if (filters.brand_id) add('brand_id = ?', filters.brand_id);
        if (filters.request_id) add('request_id = ?', filters.request_id);

        if (filters.search?.trim()) {
            const term = `%${filters.search.trim().toLowerCase()}%`;
            params.push(term);
            const i = params.length;
            clauses.push(
                `(lower(actor_label) LIKE $${i} OR lower(action) LIKE $${i} OR lower(route) LIKE $${i} OR lower(entity_label) LIKE $${i})`,
            );
        }

        return { sql: clauses.join(' AND '), params };
    }

    /**
     * Branch scoping, in one place so no read path can forget it.
     *
     * Rows carrying no branch (logins, tenant-level admin) stay visible: they
     * belong to no branch, and hiding them would keep a branch manager from
     * seeing failed logins against their own staff.
     *
     * Appends to `params` and returns the clause, or null when unrestricted.
     */
    private branchClause(
        params: unknown[],
        allowedBranchIds: number[] | null | undefined,
    ): string | null {
        if (
            allowedBranchIds == null ||
            !Array.isArray(allowedBranchIds) ||
            allowedBranchIds.length === 0
        ) {
            return null;
        }
        params.push(allowedBranchIds);
        return `(branch_id IS NULL OR branch_id = ANY($${params.length}))`;
    }

    /** Paginated list plus the outcome tallies the UI shows as chips. */
    async find(
        filters: ActivityLogFilters,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedGroups?: string[] | null,
    ) {
        const { sql, params } = this.buildWhere(
            filters,
            tenantId,
            allowedBranchIds,
            allowedGroups,
        );
        const page = Math.max(1, Math.floor(Number(filters.page) || 1));
        const pageSize = Math.min(
            MAX_PAGE_SIZE,
            Math.max(
                1,
                Math.floor(Number(filters.page_size) || DEFAULT_PAGE_SIZE),
            ),
        );
        const offset = (page - 1) * pageSize;

        const [rows, totals, outcomes] = await Promise.all([
            this.dataSource.query<ActivityLogListRow[]>(
                `SELECT id, created_at, request_id, actor_type, actor_user_id,
                        actor_label, actor_role_slugs, actor_role_names,
                        actor_is_super_admin, tenant_id, branch_id, brand_id,
                        action, action_group, entity_type, entity_id,
                        entity_label, summary, http_method, route, status_code,
                        outcome, duration_ms, changed_fields, ip,
                        payload_truncated, diff_expected
                 FROM activity_logs
                 WHERE ${sql}
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${pageSize} OFFSET ${offset}`,
                params,
            ),
            this.dataSource.query<{ total: number }[]>(
                `SELECT count(*)::int AS total FROM activity_logs WHERE ${sql}`,
                params,
            ),
            this.dataSource.query<{ outcome: string; count: number }[]>(
                `SELECT outcome, count(*)::int AS count FROM activity_logs
                 WHERE ${sql} GROUP BY outcome`,
                params,
            ),
        ]);

        const outcomeCounts: Record<string, number> = {
            success: 0,
            denied: 0,
            failed: 0,
            error: 0,
        };
        for (const row of outcomes) {
            outcomeCounts[row.outcome] = row.count;
        }

        return {
            data: rows,
            total: totals[0]?.total ?? 0,
            page,
            page_size: pageSize,
            outcome_counts: outcomeCounts,
        };
    }

    /**
     * One row in full, including the payload and diff the list omits.
     *
     * `created_at` is required alongside the id: the primary key is
     * (created_at, id), and without the date Postgres would have to search
     * every partition for a single row.
     */
    async findOne(
        id: string,
        createdAt: string,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedGroups?: string[] | null,
    ) {
        const at = new Date(createdAt);
        if (Number.isNaN(at.getTime())) {
            throw new BadRequestException('A valid created_at is required');
        }
        // One-day window around the row: keeps the scan to a single partition.
        const params: unknown[] = [
            id,
            new Date(at.getTime() - 86_400_000),
            new Date(at.getTime() + 86_400_000),
        ];
        const clauses = ['id = $1', 'created_at BETWEEN $2 AND $3'];
        if (tenantId != null) {
            params.push(tenantId);
            clauses.push(`tenant_id = $${params.length}`);
        }
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            params.push(allowedBranchIds);
            clauses.push(
                `(branch_id IS NULL OR branch_id = ANY($${params.length}))`,
            );
        }
        // A narrow grant must gate the detail view too, or the list filter
        // would be a formality anyone could step around with a direct id.
        if (allowedGroups != null) {
            if (allowedGroups.length === 0) return null;
            params.push(allowedGroups);
            clauses.push(`action_group = ANY($${params.length})`);
        }
        const rows = await this.dataSource.query<ActivityLogDetailRow[]>(
            `SELECT * FROM activity_logs WHERE ${clauses.join(' AND ')} LIMIT 1`,
            params,
        );
        return rows[0] ?? null;
    }

    /**
     * Everything else that happened in the same request — the panel that turns
     * a single row into a story.
     */
    async findRelated(
        requestId: string,
        createdAt: string,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
    ) {
        const at = new Date(createdAt);
        if (Number.isNaN(at.getTime())) return [];
        const params: unknown[] = [
            requestId,
            new Date(at.getTime() - 86_400_000),
            new Date(at.getTime() + 86_400_000),
        ];
        const clauses = ['request_id = $1', 'created_at BETWEEN $2 AND $3'];
        if (tenantId != null) {
            params.push(tenantId);
            clauses.push(`tenant_id = $${params.length}`);
        }
        const branch = this.branchClause(params, allowedBranchIds);
        if (branch) clauses.push(branch);
        return await this.dataSource.query<ActivityLogRelatedRow[]>(
            `SELECT id, created_at, action, outcome, status_code, route, entity_type, entity_id
             FROM activity_logs WHERE ${clauses.join(' AND ')}
             ORDER BY created_at ASC LIMIT 50`,
            params,
        );
    }

    /**
     * History of one record, for the "History" drawer on a record page.
     * Served by the (entity_type, entity_id, created_at DESC) index.
     */
    async findForEntity(
        entityType: string,
        entityId: string,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedGroups?: string[] | null,
        days = MAX_WINDOW_DAYS,
    ) {
        const from = new Date(Date.now() - Math.min(days, 365) * 86_400_000);
        const params: unknown[] = [entityType, entityId, from];
        const clauses = [
            'entity_type = $1',
            'entity_id = $2',
            'created_at >= $3',
        ];
        if (tenantId != null) {
            params.push(tenantId);
            clauses.push(`tenant_id = $${params.length}`);
        }
        const branch = this.branchClause(params, allowedBranchIds);
        if (branch) clauses.push(branch);
        if (allowedGroups != null) {
            if (allowedGroups.length === 0) return [];
            params.push(allowedGroups);
            clauses.push(`action_group = ANY($${params.length})`);
        }
        return await this.dataSource.query<ActivityLogHistoryRow[]>(
            `SELECT id, created_at, actor_label, actor_role_names, action,
                    outcome, changes, changed_fields
             FROM activity_logs WHERE ${clauses.join(' AND ')}
             ORDER BY created_at DESC LIMIT 100`,
            params,
        );
    }

    /** Distinct values for the filter dropdowns, within the current window. */
    async filterOptions(tenantId: number | null) {
        const from = new Date(Date.now() - 30 * 86_400_000);
        const params: unknown[] = [from];
        let scope = 'created_at >= $1';
        if (tenantId != null) {
            params.push(tenantId);
            scope += ` AND tenant_id = $${params.length}`;
        }
        const [actions, groups, actors] = await Promise.all([
            this.dataSource.query<Array<{ action: string }>>(
                `SELECT DISTINCT action FROM activity_logs WHERE ${scope} ORDER BY action LIMIT 200`,
                params,
            ),
            this.dataSource.query<Array<{ action_group: string }>>(
                `SELECT DISTINCT action_group FROM activity_logs WHERE ${scope} AND action_group IS NOT NULL ORDER BY action_group`,
                params,
            ),
            this.dataSource.query<
                Array<{ actor_user_id: number; actor_label: string }>
            >(
                `SELECT DISTINCT actor_user_id, actor_label FROM activity_logs
                 WHERE ${scope} AND actor_user_id IS NOT NULL
                 ORDER BY actor_label LIMIT 200`,
                params,
            ),
        ]);
        return {
            actions: (actions as Array<{ action: string }>).map(
                (r) => r.action,
            ),
            action_groups: (groups as Array<{ action_group: string }>).map(
                (r) => r.action_group,
            ),
            actors: actors as Array<{
                actor_user_id: number;
                actor_label: string;
            }>,
            outcomes: [...OUTCOMES],
            actor_types: [...ACTOR_TYPES],
            max_window_days: MAX_WINDOW_DAYS,
        };
    }
}
