import { InventoryTransferService } from './inventory-transfer.service';

describe('InventoryTransferService', () => {
    const makeService = (managerOverrides?: any) => {
        const inventoryService = {
            resolveTenantId: jest.fn(),
            convertToItemBaseQty: jest.fn(),
            postLedgerMovements: jest.fn(),
        } as any;
        const batchSave = jest.fn(async (x: any) => ({ ...x, id: 888 }));
        const orderSave = jest.fn(async (o: any) => o);
        const receiptLineSave = jest.fn(async (x: any) => x);
        const manager: any = {
            getRepository: (Entity: any) => {
                const name = Entity.name;
                if (name === 'InventoryTransferReceipt')
                    return {
                        create: (x: any) => x,
                        save: jest.fn(async (x: any) => ({ ...x, id: 400 })),
                    };
                if (name === 'InventoryItem')
                    return {
                        findOne: jest.fn(async () => ({
                            id: 50,
                            trackExpiry: false,
                            code: 'ITEMA',
                        })),
                    };
                if (name === 'InventoryBatch')
                    return { create: (x: any) => x, save: batchSave };
                if (name === 'InventoryTransferReceiptLine')
                    return { create: (x: any) => x, save: receiptLineSave };
                if (name === 'InventoryTransferOrder')
                    return { create: (x: any) => x, save: orderSave };
                if (name === 'InventoryTransferRequest')
                    return {
                        create: (x: any) => x,
                        save: jest.fn(async (x: any) => ({ ...x, id: 1 })),
                    };
                if (name === 'InventoryTransferRequestLine')
                    return { create: (x: any) => x, save: jest.fn() };
                throw new Error(`Unexpected repo ${name}`);
            },
            query: jest.fn().mockResolvedValue([{ qty: '999' }]),
            ...managerOverrides,
        };
        const dataSource = {
            transaction: jest.fn(async (fn: any) => fn(manager)),
        } as any;
        const requestRepo = {
            find: jest.fn(),
            findOne: jest.fn(async () => ({ id: 1, lines: [] })),
            save: jest.fn(),
        } as any;
        const orderRepo = {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
        } as any;
        const receiptRepo = {
            findOne: jest.fn(async () => ({ id: 400, lines: [] })),
        } as any;
        const service = new InventoryTransferService(
            dataSource,
            inventoryService,
            requestRepo,
            {} as any,
            orderRepo,
            receiptRepo,
            {} as any,
        );
        return {
            service,
            inventoryService,
            orderRepo,
            requestRepo,
            manager,
            batchSave,
            orderSave,
        };
    };

    it('rejects a no-op transfer (same branch + same brand bucket)', async () => {
        const { service } = makeService();
        await expect(
            service.createRequest(
                { id: 1, tenantId: 4 },
                {
                    source_branch_id: 7,
                    destination_branch_id: 7,
                    source_brand_id: null,
                    destination_brand_id: null,
                    lines: [],
                },
            ),
        ).rejects.toThrow(/must be different/);
    });

    it('allows a same-branch brand allocation (pool → brand)', async () => {
        const { service, inventoryService } = makeService();
        inventoryService.resolveTenantId.mockResolvedValue(4);
        const result = await service.createRequest(
            { id: 1, tenantId: 4, permissions: ['inventory:transfer'] },
            {
                source_branch_id: 7,
                destination_branch_id: 7,
                source_brand_id: null,
                destination_brand_id: 5,
                lines: [],
            },
        );
        expect(result).toBeTruthy();
    });

    it('lets a brand-locked admin request FROM another brand into their own bucket', async () => {
        // Source is relaxed (the source side approves the pull); only the
        // destination must belong to the requester's brand + branch.
        const { service, inventoryService } = makeService();
        inventoryService.resolveTenantId.mockResolvedValue(4);
        const result = await service.createRequest(
            {
                id: 1,
                tenantId: 4,
                allowedBranchIds: [8],
                allowedBrandIds: [5],
                permissions: ['inventory:transfer:request'],
            },
            {
                source_branch_id: 7,
                destination_branch_id: 8,
                source_brand_id: 9, // another brand — allowed as a source
                destination_brand_id: 5, // their own brand
                lines: [],
            },
        );
        expect(result).toBeTruthy();
    });

    it('forbids requesting into a brand/branch the user does not own', async () => {
        const { service } = makeService();
        await expect(
            service.createRequest(
                {
                    id: 1,
                    tenantId: 4,
                    allowedBranchIds: [8],
                    allowedBrandIds: [5],
                    permissions: ['inventory:transfer:request'],
                },
                {
                    source_branch_id: 7,
                    destination_branch_id: 8,
                    source_brand_id: null,
                    destination_brand_id: 9, // not their brand
                    lines: [],
                },
            ),
        ).rejects.toThrow(/your own brand and branch/);
    });

    it('forbids requesting without the request permission', async () => {
        const { service } = makeService();
        await expect(
            service.createRequest(
                { id: 1, tenantId: 4, allowedBrandIds: [5] },
                {
                    source_branch_id: 7,
                    destination_branch_id: 8,
                    source_brand_id: null,
                    destination_brand_id: 5,
                    lines: [],
                },
            ),
        ).rejects.toThrow(/not allowed to request transfers/);
    });

    it('dispatches from the source brand bucket with a stock-out movement', async () => {
        const { service, inventoryService, orderRepo } = makeService();
        orderRepo.findOne.mockResolvedValue({
            id: 21,
            tenantId: 4,
            sourceBranchId: 7,
            sourceBrandId: 5,
            destinationBranchId: 7,
            destinationBrandId: null,
            status: 'approved',
        });
        inventoryService.resolveTenantId.mockResolvedValue(4);
        inventoryService.convertToItemBaseQty.mockResolvedValue(12);

        await service.dispatchOrder(
            { id: 8, tenantId: 4, permissions: ['inventory:transfer'] },
            21,
            {
                lines: [
                    {
                        inventory_item_id: 99,
                        qty: 2,
                        qty_uom_id: 3,
                        inventory_batch_id: 888,
                    },
                ],
            },
        );

        expect(inventoryService.postLedgerMovements).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 4,
                branchId: 7,
                movements: [
                    expect.objectContaining({
                        inventoryItemId: 99,
                        qtyDelta: -12,
                        brandId: 5,
                        eventType: 'transfer_order',
                    }),
                ],
            }),
        );
    });

    it('blocks a dispatch that exceeds the source bucket', async () => {
        const { service, inventoryService, orderRepo } = makeService({
            query: jest.fn().mockResolvedValue([{ qty: '3' }]),
        });
        orderRepo.findOne.mockResolvedValue({
            id: 21,
            tenantId: 4,
            sourceBranchId: 7,
            sourceBrandId: 5,
            destinationBranchId: 7,
            status: 'approved',
        });
        inventoryService.resolveTenantId.mockResolvedValue(4);
        inventoryService.convertToItemBaseQty.mockResolvedValue(12);

        await expect(
            service.dispatchOrder(
                { id: 8, tenantId: 4, permissions: ['inventory:transfer'] },
                21,
                {
                    lines: [
                        {
                            inventory_item_id: 99,
                            qty: 2,
                            qty_uom_id: 3,
                            inventory_batch_id: 888,
                        },
                    ],
                },
            ),
        ).rejects.toThrow(/Insufficient stock in source batch/);
    });

    it('same-branch receive re-credits the SAME batch under the dest brand (no new batch)', async () => {
        const query = jest.fn((sql: string) => {
            if (sql.includes("event_ref_type = 'transfer_order'")) {
                return Promise.resolve([{ batch_id: 888, qty: '100' }]);
            }
            if (sql.includes('tr.transfer_order_id')) {
                // received-so-far (empty) AND final received-totals share this clause;
                // return totals shape — harmless for the empty-received lookup.
                return Promise.resolve([{ inventory_item_id: 50, qty: '100' }]);
            }
            return Promise.resolve([]);
        });
        const { service, inventoryService, orderRepo, batchSave, manager } =
            makeService({ query });

        orderRepo.findOne.mockResolvedValue({
            id: 10,
            tenantId: 2,
            sourceBranchId: 7,
            sourceBrandId: null,
            destinationBranchId: 7,
            destinationBrandId: 5,
            status: 'dispatched_partial',
            transferRequest: {
                lines: [
                    {
                        inventoryItemId: 50,
                        requestedQty: 10,
                        requestedUomId: 3,
                    },
                ],
            },
        });
        inventoryService.resolveTenantId.mockResolvedValue(2);
        inventoryService.convertToItemBaseQty.mockResolvedValue(100);

        await service.receiveOrder(
            { id: 1, tenantId: 2, permissions: ['inventory:transfer'] },
            10,
            {
                lines: [
                    {
                        inventory_item_id: 50,
                        received_qty: 10,
                        received_uom_id: 3,
                    },
                ],
            },
        );

        // No new physical batch for an internal brand reassignment.
        expect(batchSave).not.toHaveBeenCalled();
        expect(inventoryService.postLedgerMovements).toHaveBeenCalledWith(
            expect.objectContaining({
                branchId: 7,
                movements: [
                    expect.objectContaining({
                        inventoryBatchId: 888,
                        brandId: 5,
                        eventType: 'transfer_receipt',
                    }),
                ],
            }),
        );
        void manager;
    });

    it('cross-branch receive creates a new batch at the destination brand bucket', async () => {
        const query = jest
            .fn()
            .mockResolvedValue([{ inventory_item_id: 50, qty: '100' }]);
        const { service, inventoryService, orderRepo, batchSave, orderSave } =
            makeService({ query });

        orderRepo.findOne.mockResolvedValue({
            id: 10,
            tenantId: 2,
            sourceBranchId: 7,
            sourceBrandId: null,
            destinationBranchId: 30,
            destinationBrandId: 5,
            status: 'dispatched_partial',
            transferRequest: {
                lines: [
                    {
                        inventoryItemId: 50,
                        requestedQty: 10,
                        requestedUomId: 3,
                    },
                ],
            },
        });
        inventoryService.resolveTenantId.mockResolvedValue(2);
        inventoryService.convertToItemBaseQty.mockResolvedValue(100);

        await service.receiveOrder(
            { id: 1, tenantId: 2, permissions: ['inventory:transfer'] },
            10,
            {
                lines: [
                    {
                        inventory_item_id: 50,
                        received_qty: 10,
                        received_uom_id: 3,
                    },
                ],
            },
        );

        expect(batchSave).toHaveBeenCalled();
        expect(inventoryService.postLedgerMovements).toHaveBeenCalledWith(
            expect.objectContaining({
                branchId: 30,
                movements: [
                    expect.objectContaining({
                        inventoryBatchId: 888,
                        brandId: 5,
                        eventType: 'transfer_receipt',
                    }),
                ],
            }),
        );
        expect(orderSave.mock.calls[0][0].status).toBe('closed');
    });

    it('blocks a brand admin from approving their own pull (no source authority)', async () => {
        const { service, inventoryService, requestRepo } = makeService();
        requestRepo.findOne.mockResolvedValue({
            id: 1,
            tenantId: 4,
            status: 'submitted',
            sourceBranchId: 7,
            sourceBrandId: null, // pulling from the source branch pool
            destinationBranchId: 8,
            destinationBrandId: 5,
            lines: [],
        });
        inventoryService.resolveTenantId.mockResolvedValue(4);
        await expect(
            service.approveRequest(
                {
                    id: 1,
                    tenantId: 4,
                    allowedBranchIds: [8],
                    allowedBrandIds: [5],
                    permissions: [
                        'inventory:transfer:request',
                        'inventory:transfer:approve',
                    ],
                },
                1,
            ),
        ).rejects.toThrow(/source branch\/brand/);
    });

    it('lets a source-bucket holder approve a pull from the pool', async () => {
        const { service, inventoryService, requestRepo } = makeService();
        requestRepo.findOne.mockResolvedValue({
            id: 2,
            tenantId: 4,
            status: 'submitted',
            sourceBranchId: 7,
            sourceBrandId: null,
            destinationBranchId: 8,
            destinationBrandId: 5,
            lines: [],
        });
        inventoryService.resolveTenantId.mockResolvedValue(4);
        const order = await service.approveRequest(
            // No branch/brand lock → whole-branch authority over the pool.
            { id: 9, tenantId: 4, permissions: ['inventory:transfer:approve'] },
            2,
        );
        expect(order).toBeTruthy();
    });

    it('blocks dispatch without the approve permission', async () => {
        const { service, inventoryService, orderRepo } = makeService();
        orderRepo.findOne.mockResolvedValue({
            id: 21,
            tenantId: 4,
            sourceBranchId: 7,
            sourceBrandId: 5,
            destinationBranchId: 7,
            destinationBrandId: null,
            status: 'approved',
        });
        inventoryService.resolveTenantId.mockResolvedValue(4);
        await expect(
            service.dispatchOrder(
                {
                    id: 1,
                    tenantId: 4,
                    permissions: ['inventory:transfer:request'],
                },
                21,
                {
                    lines: [{ inventory_item_id: 99, qty: 2, qty_uom_id: 3 }],
                },
            ),
        ).rejects.toThrow(/approve or dispatch/);
    });

    it('scopes request lists to buckets the user controls', async () => {
        const { service, requestRepo } = makeService();
        requestRepo.find.mockResolvedValue([
            // mine: destination brand 5 @ branch 8
            {
                id: 1,
                sourceBranchId: 7,
                sourceBrandId: null,
                destinationBranchId: 8,
                destinationBrandId: 5,
            },
            // incoming: source brand 5 @ branch 8
            {
                id: 2,
                sourceBranchId: 8,
                sourceBrandId: 5,
                destinationBranchId: 9,
                destinationBrandId: 3,
            },
            // neither
            {
                id: 3,
                sourceBranchId: 1,
                sourceBrandId: 2,
                destinationBranchId: 1,
                destinationBrandId: 2,
            },
        ]);
        const user = {
            id: 1,
            tenantId: 4,
            allowedBranchIds: [8],
            allowedBrandIds: [5],
            permissions: ['inventory:transfer:request'],
        };
        const all = await service.listRequests(user, 4);
        expect(all.map((r: any) => r.id).sort()).toEqual([1, 2]);
        const mine = await service.listRequests(user, 4, 'mine');
        expect(mine.map((r: any) => r.id)).toEqual([1]);
        const incoming = await service.listRequests(user, 4, 'incoming');
        expect(incoming.map((r: any) => r.id)).toEqual([2]);
    });
});
