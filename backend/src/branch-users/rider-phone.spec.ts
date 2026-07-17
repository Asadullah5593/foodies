import { BadRequestException } from '@nestjs/common';
import { BranchUsersService } from './branch-users.service';

/**
 * A phone is optional on a user, but becomes mandatory the moment they are
 * given the rider role at a branch — see requireRiderPhones().
 */
describe('BranchUsersService — rider phone rule', () => {
    const RIDER_ROLE = 7;
    const CASHIER_ROLE = 3;

    let service: BranchUsersService;
    let users: Array<{ id: number; name: string; phone: string | null }>;
    let updates: Array<[number, { phone?: string | null }]>;
    let savedRows: Array<Record<string, unknown>>;

    const build = () => {
        users = [
            { id: 1, name: 'Ali', phone: null },
            { id: 2, name: 'Sara', phone: '03001234567' },
        ];
        updates = [];
        savedRows = [];
        const userRepo = {
            find: jest.fn(
                ({ where }: { where: { id: { _value: number[] } } }) => {
                    const ids = (where.id as unknown as { _value: number[] })
                        ._value;
                    return Promise.resolve(
                        users.filter((u) => ids.includes(u.id)),
                    );
                },
            ),
            update: jest.fn((id: number, patch: { phone?: string | null }) => {
                updates.push([id, patch]);
                const u = users.find((x) => x.id === id);
                if (u && patch.phone !== undefined) u.phone = patch.phone;
                return Promise.resolve();
            }),
        };
        const branchUserRepo = {
            create: jest.fn((row: Record<string, unknown>) => row),
            save: jest.fn((row: Record<string, unknown>) => {
                savedRows.push(row);
                return Promise.resolve(row);
            }),
            delete: jest.fn(),
        };
        const dataSource = {
            // Only the rider role id maps to slug 'rider'.
            query: jest.fn((sql: string, params: unknown[]) => {
                if (sql.includes("slug = 'rider'")) {
                    const ids = params[0] as number[];
                    return Promise.resolve(
                        ids.includes(RIDER_ROLE) ? [{ id: RIDER_ROLE }] : [],
                    );
                }
                return Promise.resolve([]);
            }),
        };
        service = new BranchUsersService(
            { findOne: jest.fn(() => Promise.resolve({ id: 10 })) } as never, // branchRepo
            userRepo as never,
            branchUserRepo as never,
            { findOne: jest.fn() } as never, // roleRepo
            dataSource as never,
        );
    };

    beforeEach(build);

    const assign = (a: {
        user_id: number;
        role_id: number;
        phone?: string | null;
    }) => service.assignUsersWithRoles(10, [a], null);

    it('refuses to make a phone-less user a rider, and writes no assignment row', async () => {
        await expect(
            assign({ user_id: 1, role_id: RIDER_ROLE }),
        ).rejects.toThrow(BadRequestException);
        await expect(
            assign({ user_id: 1, role_id: RIDER_ROLE }),
        ).rejects.toThrow(/phone number is required to make Ali a rider/);
        expect(savedRows).toHaveLength(0);
    });

    it('names the user so the assigner knows who to chase', async () => {
        await expect(
            assign({ user_id: 1, role_id: RIDER_ROLE, phone: '   ' }),
        ).rejects.toThrow(/Ali/);
    });

    it('accepts a phone supplied with the assignment and saves it to the user', async () => {
        await assign({
            user_id: 1,
            role_id: RIDER_ROLE,
            phone: ' 03009998877 ',
        });
        expect(updates).toEqual([[1, { phone: '03009998877' }]]);
        expect(savedRows).toHaveLength(1);
    });

    it('lets a rider through on the number already on file', async () => {
        await assign({ user_id: 2, role_id: RIDER_ROLE });
        expect(updates).toHaveLength(0); // nothing to change
        expect(savedRows).toHaveLength(1);
    });

    it('updates a stale number when a different one is supplied', async () => {
        await assign({ user_id: 2, role_id: RIDER_ROLE, phone: '03110000000' });
        expect(updates).toEqual([[2, { phone: '03110000000' }]]);
    });

    it('leaves the phone alone for a matching number', async () => {
        await assign({ user_id: 2, role_id: RIDER_ROLE, phone: '03001234567' });
        expect(updates).toHaveLength(0);
    });

    it('keeps the phone optional for every other role', async () => {
        await assign({ user_id: 1, role_id: CASHIER_ROLE });
        expect(savedRows).toHaveLength(1);
        expect(users[0].phone).toBeNull();
    });

    it('never lets a non-rider assignment overwrite a phone', async () => {
        await assign({ user_id: 2, role_id: CASHIER_ROLE, phone: 'junk' });
        expect(updates).toHaveLength(0);
        expect(users[1].phone).toBe('03001234567');
    });

    it('rejects the whole batch when one rider in it has no phone', async () => {
        await expect(
            service.assignUsersWithRoles(
                10,
                [
                    { user_id: 2, role_id: RIDER_ROLE },
                    { user_id: 1, role_id: RIDER_ROLE },
                ],
                null,
            ),
        ).rejects.toThrow(/Ali/);
        expect(savedRows).toHaveLength(0);
    });

    it('applies no phone at all when a later rider in the batch fails', async () => {
        await expect(
            service.assignUsersWithRoles(
                10,
                [
                    { user_id: 2, role_id: RIDER_ROLE, phone: '03110000000' },
                    { user_id: 1, role_id: RIDER_ROLE }, // no phone → whole batch fails
                ],
                null,
            ),
        ).rejects.toThrow(BadRequestException);
        expect(updates).toHaveLength(0);
        expect(users[1].phone).toBe('03001234567'); // untouched
    });
});
