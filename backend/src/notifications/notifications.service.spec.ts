import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
    const makeService = (overrides: any = {}) => {
        const notifRepo = {
            create: (x: any) => x,
            save: jest.fn(async (x: any) => ({ id: 1, ...x })),
            findOne: jest.fn(async () => null),
            find: jest.fn(async () => []),
            ...overrides.notifRepo,
        };
        const recipientRepo = {
            create: (x: any) => x,
            save: jest.fn(async (x: any) => x),
            find: jest.fn(async () => []),
            findOne: jest.fn(async () => null),
            ...overrides.recipientRepo,
        };
        const settingRepo = {
            find: jest.fn(async () => []),
            ...overrides.settingRepo,
        };
        const roleRepo = {
            find: jest.fn(async () => [
                { id: 5, slug: 'cashier', tenantId: null },
                { id: 6, slug: 'branch_manager', tenantId: null },
            ]),
            ...overrides.roleRepo,
        };
        const dataSource = {
            query: jest.fn(async () => [{ user_id: 10 }, { user_id: 11 }]),
            ...overrides.dataSource,
        };
        const service = new NotificationsService(
            notifRepo,
            recipientRepo,
            settingRepo,
            roleRepo,
            dataSource,
        );
        const emit = jest.fn();
        const server = { to: jest.fn(() => ({ emit })) };
        service.bindServer(server as any);
        return {
            service,
            notifRepo,
            recipientRepo,
            settingRepo,
            roleRepo,
            dataSource,
            emit,
        };
    };

    it('dispatches to recipients resolved from catalog defaults and emits', async () => {
        const { service, notifRepo, recipientRepo, emit } = makeService();
        const res = await service.dispatch({
            tenantId: 1,
            branchId: 2,
            brandId: 3,
            type: 'order.placed.online',
            title: 'New order',
        });
        expect(res).not.toBeNull();
        expect(notifRepo.save).toHaveBeenCalledTimes(1);
        expect(recipientRepo.save).toHaveBeenCalledTimes(1);
        const savedRecipients = recipientRepo.save.mock.calls[0][0];
        expect(savedRecipients.map((r: any) => r.userId).sort()).toEqual([
            10, 11,
        ]);
        expect(emit).toHaveBeenCalledWith(
            'notification:new',
            expect.objectContaining({ type: 'order.placed.online' }),
        );
    });

    it('returns null when no recipients match the targeted roles', async () => {
        const { service, notifRepo } = makeService({
            dataSource: { query: jest.fn(async () => []) },
        });
        const res = await service.dispatch({
            tenantId: 1,
            branchId: 2,
            brandId: 3,
            type: 'order.placed.online',
            title: 'x',
        });
        expect(res).toBeNull();
        expect(notifRepo.save).not.toHaveBeenCalled();
    });

    it('returns null for an unknown event type', async () => {
        const { service } = makeService();
        const res = await service.dispatch({
            tenantId: 1,
            branchId: 2,
            type: 'does.not.exist',
            title: 'x',
        });
        expect(res).toBeNull();
    });

    it('honours a disabled setting override (muted scope)', async () => {
        const { service, notifRepo } = makeService({
            settingRepo: {
                find: jest.fn(async () => [
                    {
                        eventType: 'order.placed.online',
                        branchId: null,
                        brandId: null,
                        isEnabled: false,
                        soundEnabled: true,
                        targetRoleIds: [5],
                    },
                ]),
            },
        });
        const res = await service.dispatch({
            tenantId: 1,
            branchId: 2,
            brandId: 3,
            type: 'order.placed.online',
            title: 'x',
        });
        expect(res).toBeNull();
        expect(notifRepo.save).not.toHaveBeenCalled();
    });

    it('prefers the most specific branch+brand setting override', async () => {
        const { service, dataSource } = makeService({
            settingRepo: {
                find: jest.fn(async () => [
                    {
                        eventType: 'order.placed.online',
                        branchId: null,
                        brandId: null,
                        isEnabled: true,
                        soundEnabled: true,
                        targetRoleIds: [5],
                    },
                    {
                        eventType: 'order.placed.online',
                        branchId: 2,
                        brandId: 3,
                        isEnabled: true,
                        soundEnabled: true,
                        targetRoleIds: [6],
                    },
                ]),
            },
        });
        await service.dispatch({
            tenantId: 1,
            branchId: 2,
            brandId: 3,
            type: 'order.placed.online',
            title: 'x',
        });
        // Recipient resolution should use the branch+brand override's role [6].
        // Query params are [tenantId, branchId, roleIds, brandId].
        const roleArg = dataSource.query.mock.calls[0][1][2];
        expect(roleArg).toEqual([6]);
    });

    it('syncSystemAlerts opens new alerts and auto-resolves cleared ones', async () => {
        const open = [
            { id: 90, dedupeKey: 'inv.low_stock:2:7', status: 'open' },
        ];
        const { service, emit } = makeService({
            notifRepo: {
                find: jest.fn(async () => open),
                save: jest.fn(async (x: any) => ({ id: x.id ?? 1, ...x })),
                findOne: jest.fn(async () => null),
            },
            recipientRepo: {
                create: (x: any) => x,
                save: jest.fn(async (x: any) => x),
                find: jest.fn(async () => [{ userId: 10 }]),
            },
        });
        const result = await service.syncSystemAlerts(
            1,
            2,
            'inventory.low_stock',
            [{ dedupeKey: 'inv.low_stock:2:8', title: 'Low stock: B' }],
        );
        expect(result.opened).toBe(1);
        expect(result.resolved).toBe(1);
        expect(emit).toHaveBeenCalledWith(
            'notification:resolved',
            expect.objectContaining({ id: 90 }),
        );
    });
});
