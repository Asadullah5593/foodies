/**
 * TypeORM's Postgres `query()` returns the rows for SELECT / INSERT, but
 * `[rows, rowCount]` for UPDATE and DELETE — even with RETURNING. Every
 * `UPDATE … RETURNING` / `DELETE … RETURNING` here goes through this, so a
 * claim that matched nothing reads as no rows rather than as two.
 */
export function returningRows<T>(result: unknown): T[] {
    if (
        Array.isArray(result) &&
        result.length === 2 &&
        Array.isArray(result[0]) &&
        typeof result[1] === 'number'
    ) {
        return result[0] as T[];
    }
    return Array.isArray(result) ? (result as T[]) : [];
}
