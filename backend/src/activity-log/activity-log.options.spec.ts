import { ActivityLogService } from './activity-log.service';
import {
    COMMON_RECORD_TYPES,
    KNOWN_AREAS,
    mergeAreas,
    mergePeople,
    mergePlaces,
    mergeRecordTypes,
    mergeRoles,
    parseRoleSlugs,
} from './activity-log.options';

describe('activity log filter options', () => {
    describe('merging what exists with what the log has seen', () => {
        it('lists staff under their current names, and keeps a deleted account findable', () => {
            const people = mergePeople(
                [
                    { id: 2, name: 'Sana (renamed)', status: 'active' },
                    { id: 3, name: 'Old Cashier', status: 'inactive' },
                ],
                [
                    { actor_user_id: 2, actor_label: 'Sana' },
                    { actor_user_id: 9, actor_label: 'Deleted Rider' },
                ],
            );
            expect(people).toEqual([
                { actor_user_id: 9, actor_label: 'Deleted Rider' },
                {
                    actor_user_id: 3,
                    actor_label: 'Old Cashier',
                    is_active: false,
                },
                {
                    actor_user_id: 2,
                    actor_label: 'Sana (renamed)',
                    is_active: true,
                },
            ]);
        });

        it('keeps a closed branch, marked, and a place only the log remembers, unmarked', () => {
            expect(
                mergePlaces(
                    [
                        { id: 4, name: 'Johar Town', is_active: true },
                        { id: 5, name: 'Emporium', is_active: false },
                    ],
                    [
                        { id: 4, name: 'Johar Town' },
                        { id: 7, name: 'Gulberg' },
                    ],
                ),
            ).toEqual([
                { id: 5, name: 'Emporium', is_active: false },
                { id: 7, name: 'Gulberg' },
                { id: 4, name: 'Johar Town', is_active: true },
            ]);
        });

        it('offers a role name once, covering every role that goes by it', () => {
            // A tenant's own "Cashier" beside the built-in one: both are held,
            // and nobody reading the log can tell them apart by name.
            expect(
                mergeRoles(
                    [
                        { slug: 'cashier', name: 'Cashier' },
                        { slug: 'pos_cashier', name: 'Cashier' },
                        { slug: 'manager', name: 'KDS' },
                    ],
                    // The log saw the KDS role before it was renamed.
                    [
                        { slug: 'manager', name: 'Kitchen Manager' },
                        { slug: 'retired_role', name: 'Supervisor' },
                    ],
                ),
            ).toEqual([
                { name: 'Cashier', slugs: ['cashier', 'pos_cashier'] },
                { name: 'KDS', slugs: ['manager'] },
                { name: 'Supervisor', slugs: ['retired_role'] },
            ]);
        });

        it('reads a role filter as a bounded list of slugs', () => {
            expect(parseRoleSlugs('cashier, pos_cashier,,cashier')).toEqual([
                'cashier',
                'pos_cashier',
            ]);
            expect(parseRoleSlugs('')).toEqual([]);
            expect(parseRoleSlugs(undefined)).toEqual([]);
            expect(
                parseRoleSlugs(
                    Array.from({ length: 50 }, (_, i) => `r${i}`).join(','),
                ),
            ).toHaveLength(20);
        });

        it('always offers every area, in reading order, plus any newer one', () => {
            expect(mergeAreas([])).toEqual([...KNOWN_AREAS]);
            expect(mergeAreas(['orders', 'payroll'])).toEqual([
                ...KNOWN_AREAS,
                'payroll',
            ]);
        });

        it('offers the common record types, one spelling each', () => {
            const types = mergeRecordTypes(['menu-items', 'rider_profiles']);
            expect(types).toEqual(
                expect.arrayContaining([...COMMON_RECORD_TYPES]),
            );
            expect(types).toContain('rider_profile');
            expect(types).not.toContain('menu-items');
            expect(new Set(types).size).toBe(types.length);
        });
    });

    describe('with nothing logged yet', () => {
        /**
         * A database whose log is empty — capture switched off, or a fresh
         * install — but whose branches, brands, roles and staff exist.
         */
        const fakeDataSource = () => {
            const calls: Array<{ sql: string; params: unknown[] }> = [];
            const query = (sql: string, params: unknown[] = []) => {
                calls.push({ sql, params });
                if (sql.includes('activity_logs')) return Promise.resolve([]);
                if (/FROM branches b\b/.test(sql)) {
                    return Promise.resolve([
                        { id: 10, name: 'Emporium', is_active: true },
                    ]);
                }
                if (/FROM brands br\b/.test(sql)) {
                    return Promise.resolve([
                        { id: 23, name: 'Peperi. Co', is_active: true },
                    ]);
                }
                if (/FROM roles r\b/.test(sql)) {
                    return Promise.resolve([
                        { slug: 'delivery_manager', name: 'Delivery Manager' },
                    ]);
                }
                if (/FROM users u\b/.test(sql)) {
                    return Promise.resolve([
                        {
                            id: 31,
                            name: 'Delivery Manager Pine Avenue',
                            status: 'active',
                        },
                    ]);
                }
                return Promise.resolve([]);
            };
            return { calls, dataSource: { query } };
        };

        const serviceWith = (dataSource: unknown) =>
            new ActivityLogService(
                dataSource as never,
                null as never,
                null as never,
            );

        it('still fills every dropdown', async () => {
            const { dataSource } = fakeDataSource();
            const options = await serviceWith(dataSource).filterOptions(
                6,
                null,
                null,
            );
            expect(options.actors).toEqual([
                {
                    actor_user_id: 31,
                    actor_label: 'Delivery Manager Pine Avenue',
                    is_active: true,
                },
            ]);
            expect(options.branches).toEqual([
                { id: 10, name: 'Emporium', is_active: true },
            ]);
            expect(options.brands).toEqual([
                { id: 23, name: 'Peperi. Co', is_active: true },
            ]);
            expect(options.roles).toEqual([
                { name: 'Delivery Manager', slugs: ['delivery_manager'] },
            ]);
            expect(options.action_groups).toEqual([...KNOWN_AREAS]);
            expect(options.record_types).toContain('order');
            expect(options.outcomes).toHaveLength(4);
        });

        it("lists the tenant's staff for an owner, and a branch's staff for a branch reader", async () => {
            const owner = fakeDataSource();
            await serviceWith(owner.dataSource).filterOptions(6, null, null);
            const ownerPeople = owner.calls.find((c) =>
                /FROM users u\b/.test(c.sql),
            )!;
            expect(ownerPeople.sql).toContain('tenant_users');
            expect(ownerPeople.params).toEqual([6]);

            const restricted = fakeDataSource();
            await serviceWith(restricted.dataSource).filterOptions(
                6,
                [10],
                null,
            );
            const branchPeople = restricted.calls.find((c) =>
                /FROM users u\b/.test(c.sql),
            )!;
            expect(branchPeople.sql).toContain('branch_users');
            expect(branchPeople.params).toEqual([[10]]);
            const branches = restricted.calls.find((c) =>
                /FROM branches b\b/.test(c.sql),
            )!;
            expect(branches.params).toEqual([6, [10]]);
        });

        it('offers a brand-locked reader only their own brands', async () => {
            const { calls, dataSource } = fakeDataSource();
            await serviceWith(dataSource).filterOptions(6, [10], [23]);
            const brands = calls.find((c) => /FROM brands br\b/.test(c.sql))!;
            expect(brands.params).toEqual([6, [23], [10]]);
            const branches = calls.find((c) =>
                /FROM branches b\b/.test(c.sql),
            )!;
            expect(branches.params).toEqual([6, [23], [10]]);
        });
    });
});
