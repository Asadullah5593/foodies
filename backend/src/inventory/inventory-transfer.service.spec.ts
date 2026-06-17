import { InventoryTransferService } from './inventory-transfer.service';

describe('InventoryTransferService', () => {
    const makeService = () => {
        const inventoryService = {
            resolveTenantId: jest.fn(),
            convertToItemBaseQty: jest.fn(),
            postLedgerMovements: jest.fn(),
        } as any;
        const dataSource = { transaction: jest.fn() } as any;
        const requestRepo = {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
        } as any;
        const requestLineRepo = {} as any;
        const orderRepo = {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
        } as any;
        const receiptRepo = { findOne: jest.fn() } as any;
        const receiptLineRepo = {} as any;
        const service = new InventoryTransferService(
            dataSource,
            inventoryService,
            requestRepo,
            requestLineRepo,
            orderRepo,
            receiptRepo,
            receiptLineRepo,
        );
        return { service, inventoryService, orderRepo };
    };

    it('dispatches transfer with stock-out movement', async () => {
        const { service, inventoryService, orderRepo } = makeService();
        orderRepo.findOne.mockResolvedValue({
            id: 21,
            tenantId: 4,
            sourceBranchId: 7,
            status: 'approved',
        });
        inventoryService.resolveTenantId.mockResolvedValue(4);
        inventoryService.convertToItemBaseQty.mockResolvedValue(12);
        orderRepo.save.mockImplementation(async (x: any) => x);

        await service.dispatchOrder({ id: 8, tenantId: 4 }, 21, {
            lines: [
                {
                    inventory_item_id: 99,
                    qty: 2,
                    qty_uom_id: 3,
                },
            ],
        });

        expect(inventoryService.postLedgerMovements).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 4,
                branchId: 7,
                movements: [
                    expect.objectContaining({
                        inventoryItemId: 99,
                        qtyDelta: -12,
                        eventType: 'transfer_order',
                    }),
                ],
            }),
        );
    });

    it('receiveOrder marks order closed when ledger totals match requested (transfer_receipt rows)', async () => {
        const inventoryService = {
            resolveTenantId: jest.fn(),
            convertToItemBaseQty: jest.fn(),
            postLedgerMovements: jest.fn(),
        } as any;
        const orderSave = jest.fn(async (o: any) => o);
        const mockManager: any = {
            getRepository: (Entity: any) => {
                const name = Entity.name;
                if (name === 'InventoryTransferReceipt') {
                    return {
                        create: (x: any) => x,
                        save: jest.fn(async (x: any) => ({ ...x, id: 400 })),
                    };
                }
                if (name === 'InventoryItem') {
                    return {
                        findOne: jest.fn(async () => ({
                            trackExpiry: false,
                            code: 'ITEMA',
                        })),
                    };
                }
                if (name === 'InventoryBatch') {
                    return {
                        create: (x: any) => x,
                        save: jest.fn(async (x: any) => ({ ...x, id: 888 })),
                    };
                }
                if (name === 'InventoryTransferReceiptLine') {
                    return {
                        create: (x: any) => x,
                        save: jest.fn(async (x: any) => x),
                    };
                }
                if (name === 'InventoryTransferOrder') {
                    return { save: orderSave };
                }
                throw new Error(`Unexpected repo ${name}`);
            },
            query: jest
                .fn()
                .mockResolvedValue([{ inventory_item_id: 50, qty: '100' }]),
        };
        const dataSource = {
            transaction: jest.fn(async (fn: any) => fn(mockManager)),
        } as any;
        const requestRepo = {} as any;
        const requestLineRepo = {} as any;
        const orderRepo = {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
        } as any;
        const receiptRepo = {
            findOne: jest.fn().mockResolvedValue({ id: 400, lines: [] }),
        } as any;
        const receiptLineRepo = {} as any;
        const service = new InventoryTransferService(
            dataSource,
            inventoryService,
            requestRepo,
            requestLineRepo,
            orderRepo,
            receiptRepo,
            receiptLineRepo,
        );

        const orderEntity = {
            id: 10,
            tenantId: 2,
            destinationBranchId: 30,
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
        };
        orderRepo.findOne.mockResolvedValue(orderEntity);

        inventoryService.resolveTenantId.mockResolvedValue(2);
        inventoryService.convertToItemBaseQty.mockResolvedValue(100);
        inventoryService.postLedgerMovements.mockResolvedValue(undefined);

        await service.receiveOrder({ id: 1, tenantId: 2 }, 10, {
            lines: [
                {
                    inventory_item_id: 50,
                    received_qty: 10,
                    received_uom_id: 3,
                },
            ],
        });

        expect(orderSave).toHaveBeenCalled();
        expect(orderSave.mock.calls[0][0].status).toBe('closed');
        expect(mockManager.query).toHaveBeenCalledWith(
            expect.stringContaining(
                "l.event_type IN ('transfer_receipt', 'transfer_in')",
            ),
            expect.any(Array),
        );
    });
});
