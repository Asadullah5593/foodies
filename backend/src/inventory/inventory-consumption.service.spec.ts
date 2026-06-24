import { InventoryConsumptionService } from './inventory-consumption.service';

describe('InventoryConsumptionService', () => {
    const makeService = (opts: {
        order: any;
        orderItems: any[];
        recipe: any;
        recipeLines: any[];
        fefoBatches: any[]; // rows the FEFO SELECT returns
    }) => {
        const inventoryService = {
            convertToItemBaseQty: jest.fn(async () => 3), // 3 base units per recipe unit
        } as any;

        const savedAllocations: any[] = [];
        const queries: Array<{ sql: string; params: any[] }> = [];
        const manager: any = {
            query: jest.fn(async (sql: string, params: any[]) => {
                queries.push({ sql, params });
                if (sql.includes('FROM inventory_batch_on_hand iboh')) {
                    return opts.fefoBatches;
                }
                return [];
            }),
            getRepository: () => ({
                create: (x: any) => x,
                save: jest.fn(async (x: any) => {
                    savedAllocations.push(x);
                    return x;
                }),
            }),
        };
        const dataSource = {
            transaction: jest.fn(async (fn: any) => fn(manager)),
        } as any;

        const ordersRepo = {
            findOne: jest.fn(async () => opts.order),
        } as any;
        const orderItemsRepo = {
            find: jest.fn(async () => opts.orderItems),
        } as any;
        const recipesRepo = {
            findOne: jest.fn(async () => opts.recipe),
        } as any;
        const recipeLinesRepo = {
            find: jest.fn(async () => opts.recipeLines),
        } as any;
        const allocationsRepo = {
            findOne: jest.fn(async () => null), // not yet consumed
            find: jest.fn(async () => []),
            delete: jest.fn(),
        } as any;

        const service = new InventoryConsumptionService(
            dataSource,
            inventoryService,
            ordersRepo,
            orderItemsRepo,
            recipesRepo,
            recipeLinesRepo,
            {} as any,
            {} as any,
            {} as any,
            allocationsRepo,
        );
        return { service, queries, savedAllocations, manager };
    };

    const baseArgs = {
        order: { id: 1, tenantId: 2, branchId: 7, brandId: 5 },
        orderItems: [{ menuItemId: 50, variantId: null, quantity: 2 }],
        recipe: { id: 100, status: 'active' },
        recipeLines: [
            { inventoryItemId: 9, qty: 3, uomId: 4, wastageFactor: null },
        ],
    };

    it('deducts FEFO from the order brand bucket and records the allocation', async () => {
        const { service, queries, savedAllocations } = makeService({
            ...baseArgs,
            fefoBatches: [{ batch_id: 888, qty: '10' }],
        });

        await service.consumeForOrder(1);

        // FEFO select scoped to the brand bucket (brand_id = $3 = 5).
        const fefo = queries.find((q) =>
            q.sql.includes('FROM inventory_batch_on_hand iboh'),
        );
        expect(fefo).toBeTruthy();
        expect(fefo!.sql).toContain('iboh.brand_id IS NOT DISTINCT FROM $3');
        expect(fefo!.params[2]).toBe(5);

        // consume ledger entry carries the brand.
        const consume = queries.find((q) => q.sql.includes("'consume'"));
        expect(consume).toBeTruthy();

        // Allocation against the real batch, 6 base units (3 * 2), brand 5.
        expect(savedAllocations).toHaveLength(1);
        expect(savedAllocations[0]).toMatchObject({
            inventoryBatchId: 888,
            brandId: 5,
            qty: 6,
        });
    });

    it('allows the sale to go negative + flags it when the brand bucket is short', async () => {
        const { service, queries, savedAllocations } = makeService({
            ...baseArgs,
            fefoBatches: [], // nothing available in the brand bucket
        });

        // Must NOT throw — POS is never blocked.
        await expect(service.consumeForOrder(1)).resolves.toEqual({ ok: true });

        // A batchless shortfall ledger entry was posted.
        const shortfall = queries.find((q) =>
            q.sql.includes('consume_shortfall'),
        );
        expect(shortfall).toBeTruthy();

        // The bucket was flagged negative.
        const flag = queries.find((q) =>
            q.sql.includes('negative_flagged_at = now()'),
        );
        expect(flag).toBeTruthy();

        // A batchless allocation (null batch) of the full 6 units, so reversal works.
        expect(savedAllocations).toHaveLength(1);
        expect(savedAllocations[0]).toMatchObject({
            inventoryBatchId: null,
            brandId: 5,
            qty: 6,
        });
    });

    it('additively consumes base dish + add-on + modifier recipes scaled by their own quantities', async () => {
        const inventoryService = {
            convertToItemBaseQty: jest.fn(async (_t: any, _i: any, qty: any) =>
                Number(qty),
            ),
        } as any;
        const savedAllocations: any[] = [];
        const manager: any = {
            query: jest.fn(async (sql: string) =>
                sql.includes('FROM inventory_batch_on_hand iboh')
                    ? [{ batch_id: 900, qty: '100' }]
                    : [],
            ),
            getRepository: () => ({
                create: (x: any) => x,
                save: jest.fn(async (x: any) => {
                    savedAllocations.push(x);
                    return x;
                }),
            }),
        };
        const dataSource = {
            transaction: jest.fn(async (fn: any) => fn(manager)),
        } as any;
        const ordersRepo = {
            findOne: jest.fn(async () => ({
                id: 1,
                tenantId: 2,
                branchId: 7,
                brandId: 5,
            })),
        } as any;
        const orderItemsRepo = {
            find: jest.fn(async () => [
                {
                    menuItemId: 50,
                    variantId: null,
                    quantity: 2,
                    addons: [{ addonId: 70, quantity: 3 }],
                    modifiers: [{ modifierId: 80, quantity: 1 }],
                },
            ]),
        } as any;
        const recipesRepo = {
            findOne: jest.fn(async ({ where }: any) => {
                if (where.menuItemId === 50) return { id: 100 };
                if (where.addonId === 70) return { id: 101 };
                if (where.modifierId === 80) return { id: 102 };
                return null;
            }),
        } as any;
        const recipeLinesRepo = {
            find: jest.fn(async ({ where }: any) => {
                if (where.recipeId === 100)
                    return [
                        {
                            inventoryItemId: 9,
                            qty: 1,
                            uomId: 4,
                            wastageFactor: null,
                        },
                    ];
                if (where.recipeId === 101)
                    return [
                        {
                            inventoryItemId: 8,
                            qty: 1,
                            uomId: 4,
                            wastageFactor: null,
                        },
                    ];
                if (where.recipeId === 102)
                    return [
                        {
                            inventoryItemId: 7,
                            qty: 1,
                            uomId: 4,
                            wastageFactor: null,
                        },
                    ];
                return [];
            }),
        } as any;
        const allocationsRepo = { findOne: jest.fn(async () => null) } as any;

        const service = new InventoryConsumptionService(
            dataSource,
            inventoryService,
            ordersRepo,
            orderItemsRepo,
            recipesRepo,
            recipeLinesRepo,
            {} as any,
            {} as any,
            {} as any,
            allocationsRepo,
        );

        await service.consumeForOrder(1);

        // base item 9 -> 1×lineQty(2); add-on item 8 -> 1×addonQty(3); modifier item 7 -> 1×modQty(1)
        const byItem = Object.fromEntries(
            savedAllocations.map((a) => [a.inventoryItemId, a.qty]),
        );
        expect(byItem).toEqual({ 9: 2, 8: 3, 7: 1 });
    });
});
