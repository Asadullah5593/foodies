import { InventoryService } from './inventory.service';

/**
 * Focused unit tests for InventoryService.getBrandOnHand — the cross-branch
 * "my brand stock" read. Only dataSource + branchBrandsRepo are exercised, so
 * the other constructor deps are stubbed.
 */
describe('InventoryService.getBrandOnHand', () => {
    const makeService = (overrides?: {
        links?: Array<{ branchId: number }>;
        query?: jest.Mock;
    }) => {
        const branchBrandsRepo = {
            find: jest.fn(
                async () =>
                    overrides?.links ?? [{ branchId: 7 }, { branchId: 8 }],
            ),
        };
        const query =
            overrides?.query ??
            jest.fn(async (sql: string) => {
                if (sql.includes('FROM branches')) {
                    return [
                        { id: 7, name: 'Branch A' },
                        { id: 8, name: 'Branch B' },
                    ];
                }
                return [
                    {
                        inventory_item_id: 50,
                        item_code: 'TOM',
                        item_name: 'Tomato',
                        base_uom_id: 3,
                        branch_id: 7,
                        qty: '10',
                    },
                    {
                        inventory_item_id: 50,
                        item_code: 'TOM',
                        item_name: 'Tomato',
                        base_uom_id: 3,
                        branch_id: 8,
                        qty: '5',
                    },
                    {
                        inventory_item_id: 60,
                        item_code: 'OIL',
                        item_name: 'Oil',
                        base_uom_id: 4,
                        branch_id: 7,
                        qty: '2',
                    },
                ];
            });
        const dataSource = { query } as any;
        // Constructor: dataSource, branchesService, then 13 repos, then branchBrandsRepo.
        const service = new InventoryService(
            dataSource,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            branchBrandsRepo as any,
        );
        return { service, branchBrandsRepo, query };
    };

    it('pivots brand stock per item with a per-branch breakdown and totals', async () => {
        const { service } = makeService();
        const res = await service.getBrandOnHand({
            tenantId: 4,
            brandId: 5,
            allowedBranchIds: [7, 8],
        });
        expect(res.brandId).toBe(5);
        expect(res.branches).toEqual([
            { branch_id: 7, branch_name: 'Branch A' },
            { branch_id: 8, branch_name: 'Branch B' },
        ]);
        const tomato = res.items.find((i) => i.inventory_item_id === 50)!;
        expect(tomato.total_qty).toBe(15);
        expect(tomato.by_branch).toEqual({ 7: 10, 8: 5 });
        const oil = res.items.find((i) => i.inventory_item_id === 60)!;
        expect(oil.total_qty).toBe(2);
        expect(oil.by_branch).toEqual({ 7: 2 });
    });

    it('intersects the brand branches with allowedBranchIds', async () => {
        const { service, query } = makeService();
        await service.getBrandOnHand({
            tenantId: 4,
            brandId: 5,
            allowedBranchIds: [7],
        });
        // The on-hand aggregation must be scoped to the intersected branch only.
        const onHandCall = query.mock.calls.find((c: any[]) =>
            String(c[0]).includes('inventory_on_hand'),
        );
        expect(onHandCall).toBeTruthy();
        expect(onHandCall![1]).toEqual([4, [7], 5]);
    });

    it('returns empty (no query) when the brand has no in-scope branches', async () => {
        const { service, query } = makeService({ links: [{ branchId: 7 }] });
        const res = await service.getBrandOnHand({
            tenantId: 4,
            brandId: 5,
            allowedBranchIds: [99],
        });
        expect(res.items).toEqual([]);
        expect(res.branches).toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });
});
