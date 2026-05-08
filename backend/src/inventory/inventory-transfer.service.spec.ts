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
});
