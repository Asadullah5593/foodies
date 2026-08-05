import {
    Injectable,
    Logger,
    OnApplicationShutdown,
    OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** The row shape the writer inserts. Everything is already redacted. */
export interface ActivityLogRow {
    createdAt: Date;
    requestId: string | null;
    sessionId: string | null;
    deviceId: string | null;
    actorType: string;
    actorUserId: number | null;
    actorCustomerId: number | null;
    actorLabel: string | null;
    actorRoleSlugs: string[] | null;
    actorRoleNames: string[] | null;
    actorIsSuperAdmin: boolean;
    tenantId: number | null;
    branchId: number | null;
    brandId: number | null;
    action: string;
    actionGroup: string | null;
    entityType: string | null;
    entityId: string | null;
    entityLabel: string | null;
    summary: string | null;
    httpMethod: string | null;
    route: string | null;
    query: unknown;
    requestBody: unknown;
    responseMeta: unknown;
    statusCode: number | null;
    outcome: string;
    durationMs: number | null;
    changes: unknown;
    changedFields: string[] | null;
    ip: string | null;
    userAgent: string | null;
    payloadTruncated: boolean;
    diffExpected: boolean;
}

const COLUMNS = [
    'created_at',
    'request_id',
    'session_id',
    'device_id',
    'actor_type',
    'actor_user_id',
    'actor_customer_id',
    'actor_label',
    'actor_role_slugs',
    'actor_role_names',
    'actor_is_super_admin',
    'tenant_id',
    'branch_id',
    'brand_id',
    'action',
    'action_group',
    'entity_type',
    'entity_id',
    'entity_label',
    'summary',
    'http_method',
    'route',
    'query',
    'request_body',
    'response_meta',
    'status_code',
    'outcome',
    'duration_ms',
    'changes',
    'changed_fields',
    'ip',
    'user_agent',
    'payload_truncated',
    'diff_expected',
] as const;

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BATCH_SIZE = 200;
const MAX_QUEUE = 10_000;
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

/**
 * Buffered, fire-and-forget writer for `activity_logs`.
 *
 * Design constraints, in priority order:
 *
 * 1. **It can never break a request.** Every path is try/caught, nothing
 *    rethrows, nothing opens a transaction and nothing joins the caller's.
 *    Callers do not await it.
 * 2. **It can never exhaust the pool.** Rows batch into ONE multi-VALUES insert
 *    per interval, so audit costs one checkout per batch — not per request.
 *    `DB_POOL_MAX` is shared with the POS, which bursts.
 * 3. **It can never eat memory.** The queue is bounded; overflow drops the
 *    oldest and records the loss as its own row, so gaps are visible.
 * 4. **It gives up rather than thrash.** After repeated failures the breaker
 *    opens for a cooldown; capture becomes a no-op and the app carries on.
 *
 * Security-critical rows (logins, role changes, cash-outs…) bypass the buffer
 * and are written immediately — those are the rows you cannot afford to lose to
 * a restart, and they are rare enough that a direct insert is free.
 */
@Injectable()
export class ActivityLogWriter implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(ActivityLogWriter.name);
    private queue: ActivityLogRow[] = [];
    private timer: NodeJS.Timeout | null = null;
    private consecutiveFailures = 0;
    private breakerOpenUntil = 0;
    private droppedSinceLastReport = 0;
    private flushing = false;

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    onModuleInit(): void {
        this.timer = setInterval(() => {
            void this.flush();
        }, FLUSH_INTERVAL_MS);
        // Never hold the process open for an audit flush.
        this.timer.unref?.();
    }

    /** Drain whatever is buffered before the process goes away (PM2 restart). */
    async onApplicationShutdown(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        await this.flush();
    }

    /** Queue a row. Returns immediately; failures are swallowed by design. */
    enqueue(row: ActivityLogRow): void {
        try {
            if (this.isBreakerOpen()) return;
            if (this.queue.length >= MAX_QUEUE) {
                this.queue.shift();
                this.droppedSinceLastReport++;
                return;
            }
            this.queue.push(row);
            if (this.queue.length >= FLUSH_BATCH_SIZE) void this.flush();
        } catch (e) {
            this.logger.error(`enqueue failed: ${String(e)}`);
        }
    }

    /**
     * Write one row now, skipping the buffer. For events that must survive an
     * immediate crash or restart. Still never throws.
     */
    async writeImmediate(row: ActivityLogRow): Promise<void> {
        try {
            if (this.isBreakerOpen()) return;
            await this.insert([row]);
            this.consecutiveFailures = 0;
        } catch (e) {
            this.recordFailure(e);
        }
    }

    /** Force a flush (tests, shutdown, maintenance). Never throws. */
    async flush(): Promise<void> {
        if (this.flushing) return;
        if (!this.queue.length) return;
        if (this.isBreakerOpen()) return;

        this.flushing = true;
        const batch = this.queue.splice(0, FLUSH_BATCH_SIZE);
        try {
            await this.insert(batch);
            this.consecutiveFailures = 0;
            if (this.droppedSinceLastReport > 0) {
                // Loss is recorded IN the log, so a gap is never silent.
                const dropped = this.droppedSinceLastReport;
                this.droppedSinceLastReport = 0;
                this.logger.warn(
                    `activity log queue overflow: dropped ${dropped} rows`,
                );
                this.enqueue(
                    this.systemRow(
                        'activity-log.dropped',
                        `Dropped ${dropped} activity rows: write queue was full`,
                    ),
                );
            }
        } catch (e) {
            this.recordFailure(e);
        } finally {
            this.flushing = false;
        }
    }

    /** Depth of the pending queue — for health checks and specs. */
    pendingCount(): number {
        return this.queue.length;
    }

    private isBreakerOpen(): boolean {
        if (this.breakerOpenUntil === 0) return false;
        if (Date.now() >= this.breakerOpenUntil) {
            this.breakerOpenUntil = 0;
            this.consecutiveFailures = 0;
            this.logger.log('activity log writer: breaker closed, resuming');
            return false;
        }
        return true;
    }

    private recordFailure(e: unknown): void {
        this.consecutiveFailures++;
        this.logger.error(
            `activity log write failed (${this.consecutiveFailures}/${BREAKER_THRESHOLD}): ${String(e)}`,
        );
        if (this.consecutiveFailures >= BREAKER_THRESHOLD) {
            this.breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
            this.queue = [];
            this.logger.error(
                `activity log writer: breaker OPEN for ${BREAKER_COOLDOWN_MS / 1000}s; capture paused`,
            );
        }
    }

    /** One parameterised multi-VALUES INSERT. No ORM, no transaction. */
    private async insert(rows: ActivityLogRow[]): Promise<void> {
        if (!rows.length) return;
        const params: unknown[] = [];
        const tuples: string[] = [];

        rows.forEach((row, rowIndex) => {
            const values = this.toValues(row);
            const placeholders = values.map(
                (_, i) => `$${rowIndex * COLUMNS.length + i + 1}`,
            );
            tuples.push(`(${placeholders.join(', ')})`);
            params.push(...values);
        });

        await this.dataSource.query(
            `INSERT INTO activity_logs (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
            params,
        );
    }

    private toValues(row: ActivityLogRow): unknown[] {
        const json = (v: unknown) =>
            v === null || v === undefined ? null : JSON.stringify(v);
        return [
            row.createdAt,
            row.requestId,
            row.sessionId,
            row.deviceId,
            row.actorType,
            row.actorUserId,
            row.actorCustomerId,
            row.actorLabel,
            row.actorRoleSlugs,
            row.actorRoleNames,
            row.actorIsSuperAdmin,
            row.tenantId,
            row.branchId,
            row.brandId,
            row.action,
            row.actionGroup,
            row.entityType,
            row.entityId,
            row.entityLabel,
            row.summary,
            row.httpMethod,
            row.route,
            json(row.query),
            json(row.requestBody),
            json(row.responseMeta),
            row.statusCode,
            row.outcome,
            row.durationMs,
            json(row.changes),
            row.changedFields,
            row.ip,
            row.userAgent,
            row.payloadTruncated,
            row.diffExpected,
        ];
    }

    /** A row the system writes about itself (drops, maintenance, breaker). */
    systemRow(action: string, summary: string): ActivityLogRow {
        return {
            createdAt: new Date(),
            requestId: null,
            sessionId: null,
            deviceId: null,
            actorType: 'system',
            actorUserId: null,
            actorCustomerId: null,
            actorLabel: 'system',
            actorRoleSlugs: null,
            actorRoleNames: null,
            actorIsSuperAdmin: false,
            tenantId: null,
            branchId: null,
            brandId: null,
            action,
            actionGroup: 'audit',
            entityType: null,
            entityId: null,
            entityLabel: null,
            summary,
            httpMethod: null,
            route: null,
            query: null,
            requestBody: null,
            responseMeta: null,
            statusCode: null,
            outcome: 'success',
            durationMs: null,
            changes: null,
            changedFields: null,
            ip: null,
            userAgent: null,
            payloadTruncated: false,
            diffExpected: false,
        };
    }
}
