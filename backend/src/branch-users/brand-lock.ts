/**
 * What a branch assignment's brand lock means.
 *
 * A row can name several brands (brand_ids) or none at all. `brand_id` is kept
 * in step as the first of them, so a reader still on the single column sees a
 * narrower lock rather than no lock — the safe direction to be wrong in. Every
 * read of the lock goes through here so the two columns can never drift into
 * two different answers.
 */

/** A branch_users row, in either the entity's or the raw SQL's spelling. */
export interface BrandLockRow {
    brandId?: number | null;
    brandIds?: number[] | null;
    brand_id?: number | null;
    brand_ids?: number[] | null;
}

const clean = (ids: unknown): number[] =>
    Array.isArray(ids)
        ? [
              ...new Set(
                  ids
                      .map((v) => Number(v))
                      .filter((v) => Number.isInteger(v) && v > 0),
              ),
          ].sort((a, b) => a - b)
        : [];

/**
 * The brands this row locks its user to, or null for "every brand at the
 * branch". Prefers brand_ids; falls back to brand_id for a row written before
 * the column existed (or by anything that still writes only the single one).
 */
export function rowBrandIds(
    row: BrandLockRow | null | undefined,
): number[] | null {
    if (!row) return null;
    const many = clean(row.brandIds ?? row.brand_ids);
    if (many.length > 0) return many;
    const one = row.brandId ?? row.brand_id;
    return one == null ? null : [Number(one)];
}

/** True when the row restricts its user to a subset of the branch's brands. */
export function isBrandLocked(row: BrandLockRow | null | undefined): boolean {
    return rowBrandIds(row) != null;
}

/**
 * The pair of columns to persist for a wanted set of brands. An empty or absent
 * set means "all brands" and clears both.
 */
export function brandLockColumns(ids: unknown): {
    brandId: number | null;
    brandIds: number[] | null;
} {
    const list = clean(ids);
    if (list.length === 0) return { brandId: null, brandIds: null };
    return { brandId: list[0], brandIds: list };
}

/**
 * Read a request's brand selection, accepting either spelling: `brand_ids` (a
 * list) or the older single `brand_id`. Undefined means the caller said nothing
 * about brands, which is different from explicitly clearing them — the callers
 * that care handle that distinction themselves.
 */
export function brandIdsFromInput(input: {
    brand_id?: number | null;
    brand_ids?: number[] | null;
}): number[] {
    const many = clean(input.brand_ids);
    if (many.length > 0) return many;
    return input.brand_id == null ? [] : [Number(input.brand_id)];
}

/**
 * SQL for a row's effective brand set, for the raw queries that cannot use the
 * helpers above. Yields NULL for an unlocked row so `IS NULL` still reads as
 * "all brands", exactly as the single column did.
 */
export const BRAND_LOCK_SQL = (alias: string): string =>
    `COALESCE(
        NULLIF(${alias}.brand_ids, '{}'),
        CASE WHEN ${alias}.brand_id IS NULL THEN NULL ELSE ARRAY[${alias}.brand_id] END
    )`;
