import { DataSource } from 'typeorm';
import { RoleAccessGuard } from './role-access.guard';
import { BRAND_LOCK_SQL } from '../branch-users/brand-lock';

/**
 * What the guard hands every downstream check as `allowedBrandIds`. Getting
 * this wrong either locks staff out of their own brand or hands them someone
 * else's, so the aggregation across a user's branch rows is pinned here.
 *
 * null means "no brand restriction". An empty array would mean "no brand at
 * all", which must never be produced.
 */
describe('RoleAccessGuard — allowedBrandIds across branch rows', () => {
    const resolve = async (
        rows: Array<{ brand_ids: number[] | null }>,
        permissions: string[] = [],
    ): Promise<number[] | null> => {
        const dataSource = {
            query: jest.fn().mockResolvedValue(rows),
        } as unknown as DataSource;
        const guard = new RoleAccessGuard(dataSource);
        (
            guard as unknown as {
                getUserPermissionNames: () => Promise<Set<string>>;
            }
        ).getUserPermissionNames = () => Promise.resolve(new Set(permissions));
        return (
            guard as unknown as {
                getAllowedBrandIds: (
                    u: number,
                    t: number,
                ) => Promise<number[] | null>;
            }
        ).getAllowedBrandIds(1, 1);
    };

    it('returns the single brand of a one-brand user', async () => {
        await expect(resolve([{ brand_ids: [3] }])).resolves.toEqual([3]);
    });

    it('returns BOTH brands when one row names two — the whole point', async () => {
        await expect(resolve([{ brand_ids: [3, 7] }])).resolves.toEqual([3, 7]);
    });

    it('unions the brands across several branches', async () => {
        await expect(
            resolve([{ brand_ids: [3, 7] }, { brand_ids: [9] }]),
        ).resolves.toEqual([3, 7, 9]);
    });

    it('de-duplicates a brand held at two branches', async () => {
        await expect(
            resolve([{ brand_ids: [3] }, { brand_ids: [3, 7] }]),
        ).resolves.toEqual([3, 7]);
    });

    it('one unrestricted row unlocks the user everywhere, as before', async () => {
        // A row without a lock means "all brands" somewhere, which is a lock on
        // nothing — narrowing them elsewhere would be inventing a restriction.
        await expect(
            resolve([{ brand_ids: [3, 7] }, { brand_ids: null }]),
        ).resolves.toBeNull();
    });

    it('all-branches:access beats any row', async () => {
        await expect(
            resolve([{ brand_ids: [3] }], ['all-branches:access']),
        ).resolves.toBeNull();
    });

    it('a user with no branch rows is unrestricted', async () => {
        await expect(resolve([])).resolves.toBeNull();
    });

    it('never returns an empty array, which would lock the user out of everything', async () => {
        // A row whose brands were all deleted resolves to nothing; that has to
        // read as unrestricted, not as "no brand is allowed".
        await expect(resolve([{ brand_ids: [] }])).resolves.toBeNull();
    });

    /**
     * The rows above are handed straight back by the mock, so they cannot catch
     * a query that drops rows before the aggregation ever sees them. That is
     * exactly how brands went missing in production: the guard INNER JOINed
     * branch_brands to prove tenancy, which deleted any assignment to a branch
     * carrying no brands. When the deleted row was the UNLOCKED one, the "one
     * unrestricted row unlocks the user" case above stopped firing and the
     * guard invented a lock from the survivors — hiding a whole brand's orders
     * and reports while /auth/me still reported no lock at all.
     */
    describe('the query itself', () => {
        const captureSql = async (): Promise<{
            sql: string;
            params: unknown[];
        }> => {
            const query = jest.fn().mockResolvedValue([]);
            const dataSource = { query } as unknown as DataSource;
            const guard = new RoleAccessGuard(dataSource);
            (
                guard as unknown as {
                    getUserPermissionNames: () => Promise<Set<string>>;
                }
            ).getUserPermissionNames = () => Promise.resolve(new Set<string>());
            await (
                guard as unknown as {
                    getAllowedBrandIds: (
                        u: number,
                        t: number,
                    ) => Promise<number[] | null>;
                }
            ).getAllowedBrandIds(42, 7);
            const [sql, params] = query.mock.calls[0] as [string, unknown[]];
            return { sql, params };
        };

        it('reads branch_users alone — no branch_brands join to drop rows', async () => {
            const { sql } = await captureSql();
            expect(sql).toContain('branch_users');
            expect(sql).not.toMatch(/branch_brands/i);
            expect(sql).not.toMatch(/\bjoin\b/i);
        });

        it('scopes by user only — a tenant filter here would narrow the lock', async () => {
            const { params } = await captureSql();
            expect(params).toEqual([42]);
        });

        it('answers the same rows as AuthService, which never had the join', async () => {
            // Both read the same lock; the two disagreeing WAS the bug.
            const { sql } = await captureSql();
            const authSql = `SELECT ${BRAND_LOCK_SQL('bu')} AS brand_ids
             FROM branch_users bu WHERE bu.user_id = $1`;
            const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
            expect(normalise(sql)).toBe(normalise(authSql));
        });
    });
});
