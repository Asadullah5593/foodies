/**
 * "Valid from" / "Valid until" on discounts, coupons, bank cards, banners,
 * promotions and campaigns.
 *
 * The admin forms send a plain date ('2026-11-30') and the services store
 * `new Date('2026-11-30')`, which is midnight UTC — 05:00 in Pakistan. Compared
 * as an exact moment, an offer "valid until 30 Nov" stopped at 05:00 on the
 * 30th and one "valid from 1 Oct" only started at 05:00 on the 1st.
 *
 * A date somebody picked means that whole day on the seller's own clock, so a
 * value sitting exactly on midnight UTC is compared day against day in a
 * timezone. A value with a time of day is a real moment (the coupon minted when
 * a customer claims a promotion expires N×24h after the claim) and is still
 * compared as one, exactly as before.
 */

export interface ValidityWindow {
    validFrom?: Date | null;
    validUntil?: Date | null;
}

const DAY_MS = 86_400_000;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date ('YYYY-MM-DD') in the given IANA timezone. */
export function localDate(
    timezone: string | null | undefined,
    now: Date = new Date(),
): string {
    const tz = timezone || 'UTC';
    let formatter = dayFormatters.get(tz);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        dayFormatters.set(tz, formatter);
    }
    const parts = formatter.formatToParts(now);
    const part = (type: string) =>
        parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

/** True for a value saved from a date-only input, i.e. exactly midnight UTC. */
export function isPickedDate(value: Date | null | undefined): boolean {
    return value != null && value.getTime() % DAY_MS === 0;
}

/** True when checking the window needs a timezone to read a picked date in. */
export function hasPickedDate(window: ValidityWindow): boolean {
    return isPickedDate(window.validFrom) || isPickedDate(window.validUntil);
}

/** The day the admin picked: the stored value's own (UTC) date. */
const pickedDay = (value: Date): string => value.toISOString().slice(0, 10);

/** A picked date starts at 00:00 of that day in `timezone`; a moment, at that moment. */
export function hasStarted(
    validFrom: Date | null | undefined,
    timezone: string | null | undefined,
    now: Date = new Date(),
): boolean {
    if (!validFrom) return true;
    return isPickedDate(validFrom)
        ? localDate(timezone, now) >= pickedDay(validFrom)
        : now >= validFrom;
}

/** A picked date ends when that day is over in `timezone`; a moment, at that moment. */
export function hasEnded(
    validUntil: Date | null | undefined,
    timezone: string | null | undefined,
    now: Date = new Date(),
): boolean {
    if (!validUntil) return false;
    return isPickedDate(validUntil)
        ? localDate(timezone, now) > pickedDay(validUntil)
        : now > validUntil;
}

/** True when `now` is inside the window; an open end never restricts. */
export function isWithinValidity(
    window: ValidityWindow,
    timezone: string | null | undefined,
    now: Date = new Date(),
): boolean {
    return (
        hasStarted(window.validFrom, timezone, now) &&
        !hasEnded(window.validUntil, timezone, now)
    );
}

/** Anything that runs SQL: a DataSource, an EntityManager or a repository's `manager`. */
export interface SqlRunner {
    query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

type TimezoneRow = { timezone: string | null };

/** Ids arrive from query strings too; a missing or unparsable one is "none". */
const isId = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * The timezone to read picked dates in: the branch's when the sale has one,
 * otherwise the one most of the tenant's active branches run on. The tenant's
 * own `default_timezone` is only a last resort — it is 'UTC' unless somebody
 * set it, while branches carry the clock the kitchen actually works to.
 */
export async function validityTimezone(
    db: SqlRunner,
    scope: { branchId?: number | null; tenantId?: number | null },
): Promise<string> {
    if (isId(scope.branchId)) {
        const rows = (await db.query(
            `SELECT timezone FROM branches WHERE id = $1`,
            [scope.branchId],
        )) as TimezoneRow[];
        if (rows[0]?.timezone) return rows[0].timezone;
    }
    if (isId(scope.tenantId)) {
        // Branches reach a tenant through their brands (branch_brands → brands).
        const branches = (await db.query(
            `SELECT b.timezone
             FROM branches b
             WHERE b.is_active = true
               AND b.id IN (
                   SELECT bb.branch_id
                   FROM branch_brands bb
                   JOIN brands br ON br.id = bb.brand_id
                   WHERE br.tenant_id = $1
               )
             GROUP BY b.timezone
             ORDER BY count(*) DESC, b.timezone
             LIMIT 1`,
            [scope.tenantId],
        )) as TimezoneRow[];
        if (branches[0]?.timezone) return branches[0].timezone;
        const tenants = (await db.query(
            `SELECT default_timezone AS timezone FROM tenants WHERE id = $1`,
            [scope.tenantId],
        )) as TimezoneRow[];
        if (tenants[0]?.timezone) return tenants[0].timezone;
    }
    return 'UTC';
}
