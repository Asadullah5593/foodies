import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

/**
 * One audited action. See docs/ACTIVITY_LOG_PLAN.md.
 *
 * Read-only from the app's point of view: rows are inserted by
 * ActivityLogWriter with raw parameterised SQL (batched, off the request path)
 * and never updated or deleted — the migration REVOKEs both. This entity exists
 * for the read API and for typing; do not add save()/update() paths against it.
 *
 * The table is RANGE-partitioned monthly on `created_at`, so every query must be
 * date-bounded to get partition pruning. The read API enforces that.
 */
@Entity('activity_logs')
export class ActivityLog {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    /** Partition key. timestamptz on purpose — see the migration's header. */
    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    // — correlation —

    /** Shared by every row produced by one HTTP request (and its beacon events). */
    @Index()
    @Column({ type: 'uuid', nullable: true })
    requestId: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    sessionId: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    deviceId: string | null;

    // — actor —

    /** staff | customer | rider | kiosk | anonymous | system */
    @Column({ type: 'varchar', length: 16, default: 'system' })
    actorType: string;

    @Column({ type: 'int', nullable: true })
    actorUserId: number | null;

    @Column({ type: 'int', nullable: true })
    actorCustomerId: number | null;

    /** Name/email captured at write time, so a renamed or deleted user still reads. */
    @Column({ type: 'varchar', length: 160, nullable: true })
    actorLabel: string | null;

    /**
     * Roles held AT THE TIME of the action. Snapshotted because roles get edited:
     * resolving them at read time would report today's permissions for last
     * March's action, which is backwards for forensics.
     */
    @Column({ type: 'text', array: true, nullable: true })
    actorRoleSlugs: string[] | null;

    @Column({ type: 'text', array: true, nullable: true })
    actorRoleNames: string[] | null;

    /**
     * Super admins short-circuit RoleAccessGuard, so their permission arrays are
     * undefined rather than empty. This flag carries that fact; the role arrays
     * stay NULL (never `[]`, which would read as "held no permissions").
     */
    @Column({ type: 'boolean', default: false })
    actorIsSuperAdmin: boolean;

    // — scope (of the SUBJECT, not of the actor's access) —

    @Column({ type: 'int', nullable: true })
    tenantId: number | null;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    // — what happened —

    /** Dotted and stable, e.g. `role.update`, `shift.cash-out`, `auth.login.failed`. */
    @Column({ type: 'varchar', length: 96 })
    action: string;

    /** Coarse bucket for filtering: `menu`, `orders`, `inventory`, `auth`… */
    @Column({ type: 'varchar', length: 48, nullable: true })
    actionGroup: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    entityType: string | null;

    /** varchar, not int: order groups are UUIDs. */
    @Column({ type: 'varchar', length: 64, nullable: true })
    entityId: string | null;

    /** Human label of the subject at the time ("Pepperoni Pizza", "Cashier 2"). */
    @Column({ type: 'varchar', length: 200, nullable: true })
    entityLabel: string | null;

    @Column({ type: 'varchar', length: 400, nullable: true })
    summary: string | null;

    // — how it arrived —

    @Column({ type: 'varchar', length: 10, nullable: true })
    httpMethod: string | null;

    @Column({ type: 'varchar', length: 300, nullable: true })
    route: string | null;

    @Column({ type: 'jsonb', nullable: true })
    query: Record<string, unknown> | null;

    /** Redacted before it ever reaches here — see activity-log.redaction.ts. */
    @Column({ type: 'jsonb', nullable: true })
    requestBody: Record<string, unknown> | null;

    /** Allow-listed picks only ({id, count, order_number, status}), never the whole body. */
    @Column({ type: 'jsonb', nullable: true })
    responseMeta: Record<string, unknown> | null;

    @Column({ type: 'int', nullable: true })
    statusCode: number | null;

    /** success | denied | failed | error */
    @Column({ type: 'varchar', length: 16, default: 'success' })
    outcome: string;

    @Column({ type: 'int', nullable: true })
    durationMs: number | null;

    // — what changed —

    /** `{ field: { before, after } }`, money normalised to numbers. */
    @Column({ type: 'jsonb', nullable: true })
    changes: Record<string, { before: unknown; after: unknown }> | null;

    @Column({ type: 'text', array: true, nullable: true })
    changedFields: string[] | null;

    // — forensics —

    @Column({ type: 'varchar', length: 64, nullable: true })
    ip: string | null;

    @Column({ type: 'varchar', length: 400, nullable: true })
    userAgent: string | null;

    /** The payload hit the size cap and was clipped — visible, not silent. */
    @Column({ type: 'boolean', default: false })
    payloadTruncated: boolean;

    /**
     * The route was marked as one that SHOULD carry a diff. A row with
     * diff_expected = true and changes = NULL is missing instrumentation, and
     * that gap is queryable rather than invisible.
     */
    @Column({ type: 'boolean', default: false })
    diffExpected: boolean;
}
