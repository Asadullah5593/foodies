/**
 * Shared concurrency primitives.
 *
 * The system runs on PostgreSQL at READ COMMITTED and is hit concurrently by POS
 * terminals, kiosks, the mobile app, consumer web and background jobs. Under
 * READ COMMITTED two statements in different transactions do not see each other's
 * uncommitted writes and there is no lost-update protection unless the code holds a
 * row lock (SELECT … FOR UPDATE), issues a single atomic UPDATE, or a unique
 * constraint converts a duplicate into a caught error.
 *
 * These helpers give every module ONE consistent way to do the three things the
 * race-condition audit needed everywhere:
 *   1. recognise Postgres concurrency errors (unique-violation / deadlock / serialization),
 *   2. retry a transaction that lost a deadlock/serialization race,
 *   3. perform a lock-serialised, idempotent status transition (check-then-act, done right).
 */
import { DataSource, EntityManager } from 'typeorm';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_DEADLOCK_DETECTED = '40P01';
export const PG_SERIALIZATION_FAILURE = '40001';
export const PG_LOCK_NOT_AVAILABLE = '55P03';

export function pgErrorCode(e: unknown): string | undefined {
    const err = e as { code?: string; driverError?: { code?: string } };
    return err?.driverError?.code ?? err?.code;
}

export function isUniqueViolation(e: unknown): boolean {
    return pgErrorCode(e) === PG_UNIQUE_VIOLATION;
}

/** Deadlock or serialization failure — safe to retry the whole transaction. */
export function isRetryableConcurrencyError(e: unknown): boolean {
    const c = pgErrorCode(e);
    return c === PG_DEADLOCK_DETECTED || c === PG_SERIALIZATION_FAILURE;
}

/**
 * Run `fn` and, if it fails with a deadlock/serialization error, retry it a few
 * times with a tiny jittered backoff. `fn` must be self-contained (open its own
 * transaction) because it is re-executed from scratch on retry.
 */
export async function retryOnConcurrencyError<T>(
    fn: () => Promise<T>,
    attempts = 3,
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (!isRetryableConcurrencyError(e)) throw e;
            // small linear backoff; jitter derived from attempt index (no Math.random needed)
            await new Promise((r) => setTimeout(r, 5 * (i + 1)));
        }
    }
    throw lastErr;
}

/**
 * Namespaces for transaction-scoped Postgres advisory locks. Each logical
 * serialization domain gets its own namespace so a lock on order 5's inventory can
 * never collide with a lock on transfer 5. Values are arbitrary but must be stable
 * and distinct.
 */
export const AdvisoryLock = {
    ORDER_INVENTORY: 1001,
    TRANSFER_ORDER: 1003,
    PROCUREMENT_GRN: 1004,
    PURCHASE_REQUISITION: 1005,
    PURCHASE_ORDER: 1006,
    PAYROLL_RUN: 1007,
    COMP_PLAN_SCOPE: 1008,
    STOCKTAKE_BRANCH: 1009,
    BRAND_INVENTORY: 1010,
    RIDER_ASSIGNMENT: 1011,
    ADJUSTMENT: 1012,
    WASTAGE: 1013,
    PROMOTION: 1014,
    OTP_IDENTIFIER: 1015,
    RATING: 1016,
    COUPON_REALIZATION: 1017,
} as const;

/**
 * Acquire a transaction-scoped advisory lock (`pg_advisory_xact_lock`). It is held
 * until the surrounding transaction commits or rolls back, and serializes every
 * other transaction that locks the same (namespace, key). Use when the invariant
 * spans rows/tables that a single row lock cannot cover (e.g. "consume and reverse
 * for one order must not interleave").
 */
export async function advisoryXactLock(
    m: EntityManager,
    namespace: number,
    key: number,
): Promise<void> {
    await m.query('SELECT pg_advisory_xact_lock($1, $2)', [namespace, key]);
}

// Only ever fed code-defined constants, but validate anyway so a future refactor
// can never turn these raw-SQL builders into an injection vector.
const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(s: string): string {
    if (!IDENT.test(s)) throw new Error(`Unsafe SQL identifier: ${s}`);
    return s;
}

/** A raw SQL expression (e.g. `now()`, `NULL`, `expected_cash + 1`) — trusted, code-defined. */
export interface RawSql {
    raw: string;
}
export function raw(sql: string): RawSql {
    return { raw: sql };
}
function isRaw(v: unknown): v is RawSql {
    return typeof v === 'object' && v !== null && 'raw' in v;
}

// A column value: either a raw SQL expression (via raw()) or a parameterised value.
// `unknown` already subsumes RawSql; isRaw() distinguishes them at runtime.
type SetMap = Record<string, unknown>;

export interface StatusTransitionOptions {
    /** Status column name (default `status`). */
    statusColumn?: string;
    /** Only transition when the current status is one of these (else no-op). */
    allowedFrom?: string[];
    /**
     * Extra columns to set as part of the same atomic UPDATE. Values are
     * parameterised unless wrapped with `raw(...)`. May be a function of the
     * current (pre-transition) status so callers can express "clear X when
     * leaving state Y" in a single statement.
     */
    set?: SetMap | ((current: string) => SetMap);
    /** Bump `updated_at = now()` (default true). */
    touchUpdatedAt?: boolean;
}

/**
 * Lock-serialised, idempotent status transition — the correct form of the
 * pervasive `findOne()` → mutate → `save()` check-then-act.
 *
 * Locks the row `FOR UPDATE`, re-reads the status under the lock, and only when the
 * transition is real (current !== target, and current ∈ allowedFrom if given) writes
 * the new status plus any `set` columns in one UPDATE.
 *
 * Returns the PREVIOUS status when THIS call performed the transition, or `null`
 * when it was a no-op (row absent, already in target status, or not in allowedFrom).
 * Because exactly one concurrent caller ever sees a non-null return, side effects
 * gated on a non-null result fire exactly once.
 *
 * Pass a `DataSource` to run in its own transaction, or an `EntityManager` to join
 * the caller's transaction.
 */
export async function transitionStatus(
    ex: DataSource | EntityManager,
    table: string,
    id: number,
    newStatus: string,
    opts: StatusTransitionOptions = {},
): Promise<string | null> {
    const run = (m: EntityManager) =>
        transitionStatusWithin(m, table, id, newStatus, opts);
    if (ex instanceof DataSource) return ex.transaction(run);
    return run(ex);
}

async function transitionStatusWithin(
    m: EntityManager,
    table: string,
    id: number,
    newStatus: string,
    opts: StatusTransitionOptions,
): Promise<string | null> {
    const t = ident(table);
    const col = ident(opts.statusColumn ?? 'status');
    const rows: Array<{ cur: string }> = await m.query(
        `SELECT ${col} AS cur FROM ${t} WHERE id = $1 FOR UPDATE`,
        [id],
    );
    if (!rows.length) return null;
    const cur = rows[0].cur;
    if (cur === newStatus) return null;
    if (opts.allowedFrom && !opts.allowedFrom.includes(cur)) return null;

    const setMap =
        typeof opts.set === 'function' ? opts.set(cur) : (opts.set ?? {});
    const sets = [`${col} = $2`];
    const params: unknown[] = [id, newStatus];
    for (const [k, v] of Object.entries(setMap)) {
        const c = ident(k);
        if (isRaw(v)) {
            sets.push(`${c} = ${v.raw}`);
        } else {
            params.push(v);
            sets.push(`${c} = $${params.length}`);
        }
    }
    if (opts.touchUpdatedAt !== false) sets.push(`updated_at = now()`);
    await m.query(
        `UPDATE ${t} SET ${sets.join(', ')} WHERE id = $1`,
        params,
    );
    return cur;
}
