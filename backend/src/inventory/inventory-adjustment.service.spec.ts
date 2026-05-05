import { NotFoundException } from '@nestjs/common';
import { InventoryAdjustmentService } from './inventory-adjustment.service';

describe('InventoryAdjustmentService', () => {
    const makeService = () => {
        const inventoryService = {
            resolveTenantId: jest.fn(),
            convertToItemBaseQty: jest.fn(),
            postLedgerMovements: jest.fn(),
        } as any;
        const adjustmentRepo = {
            findOne: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
        } as any;
        const adjustmentLineRepo = {} as any;
        const dataSource = { transaction: jest.fn() } as any;
        const service = new InventoryAdjustmentService(
            dataSource,
            inventoryService,
            adjustmentRepo,
            adjustmentLineRepo,
        );
        return { service, inventoryService, adjustmentRepo };
    };

    it('posts adjustment_out as negative ledger movement', async () => {
        const { service, inventoryService, adjustmentRepo } = makeService();
        adjustmentRepo.findOne.mockResolvedValue({
            id: 10,
            tenantId: 2,
            branchId: 3,
            status: 'draft',
            adjustmentType: 'out',
            lines: [
                {
                    id: 55,
                    inventoryItemId: 99,
                    qty: 2,
                    qtyUomId: 1,
                    locationId: null,
                    inventoryBatchId: null,
                    notes: null,
                },
            ],
        });
        inventoryService.resolveTenantId.mockResolvedValue(2);
        inventoryService.convertToItemBaseQty.mockResolvedValue(20);
        adjustmentRepo.save.mockImplementation(async (x: any) => x);

        await service.postAdjustment({ id: 7, tenantId: 2 }, 10);

        expect(inventoryService.postLedgerMovements).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 2,
                branchId: 3,
                movements: [
                    expect.objectContaining({
                        qtyDelta: -20,
                        eventType: 'adjustment_out',
                        idempotencyKey: 'adjustment:10:line:55',
                    }),
                ],
            }),
        );
    });

    it('throws when adjustment is missing', async () => {
        const { service, adjustmentRepo } = makeService();
        adjustmentRepo.findOne.mockResolvedValue(null);
        await expect(
            service.postAdjustment({ id: 7, tenantId: 2 }, 999),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
