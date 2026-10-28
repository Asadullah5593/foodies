import { OrdersService } from './orders.service';

/**
 * Extras are chosen per unit. Raising a customised burger to 3 means three
 * burgers, each with its extra patty, so the line bills three patties. The
 * server used to add a plain line's extras once, whatever its quantity
 * (order #001, 28 Oct: Kiwi Kick × 3 + extra patty billed 3,847, not 4,347).
 */
describe('priceOrderLine — extras per unit', () => {
    const KIWI_KICK = 1199;
    const PATTY = { id: 81, name: 'Add Extra single patty', price: 250 };

    const makeSvc = () => {
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, {
            menuService: {
                getEffectiveUnitPrice: jest.fn(() =>
                    Promise.resolve(KIWI_KICK),
                ),
            },
        });
        return (
            svc as unknown as {
                priceOrderLine: (
                    branchId: number,
                    line: Record<string, unknown>,
                    menuItem: Record<string, unknown>,
                ) => Promise<{ itemSubtotal: number; unitPrice: number }>;
            }
        ).priceOrderLine.bind(svc);
    };

    const burger = {
        addons: [{ id: 5, price: 60 }],
        modifierGroups: [{ id: 1, modifiers: [PATTY] }],
    };

    it('bills an extra patty on each of three burgers', async () => {
        const price = makeSvc();
        const res = await price(
            10,
            {
                menu_item_id: 1,
                quantity: 3,
                modifiers: [{ modifier_id: PATTY.id, quantity: 1 }],
            },
            burger,
        );
        expect(res.unitPrice).toBe(KIWI_KICK);
        // 3 × (1,199 + 250)
        expect(res.itemSubtotal).toBe(4347);
    });

    it('leaves a single burger as it was', async () => {
        const price = makeSvc();
        const res = await price(
            10,
            {
                menu_item_id: 1,
                quantity: 1,
                modifiers: [{ modifier_id: PATTY.id, quantity: 1 }],
            },
            burger,
        );
        expect(res.itemSubtotal).toBe(1449);
    });

    it('bills add-ons per unit too', async () => {
        const price = makeSvc();
        const res = await price(
            10,
            {
                menu_item_id: 1,
                quantity: 3,
                addons: [{ addon_id: 5, quantity: 2 }],
            },
            burger,
        );
        // 3 × (1,199 + 2 × 60)
        expect(res.itemSubtotal).toBe(3957);
    });

    it("gives the group's free allowance on every unit", async () => {
        const price = makeSvc();
        const res = await price(
            10,
            {
                menu_item_id: 1,
                quantity: 2,
                modifiers: [
                    { modifier_id: 91, quantity: 1 },
                    { modifier_id: 92, quantity: 1 },
                ],
            },
            {
                modifierGroups: [
                    {
                        id: 2,
                        includedQuantity: 1,
                        modifiers: [
                            { id: 91, name: 'Jalapeños', price: 100 },
                            { id: 92, name: 'Olives', price: 100 },
                        ],
                    },
                ],
            },
        );
        // One topping free per burger: 2 × (1,199 + 100)
        expect(res.itemSubtotal).toBe(2598);
    });

    it("bills a deal component's extras once: the row is one deal unit", async () => {
        const price = makeSvc();
        const res = await price(
            10,
            {
                menu_item_id: 1,
                quantity: 2,
                deal_unit_price: 500,
                modifiers: [{ modifier_id: PATTY.id, quantity: 1 }],
            },
            burger,
        );
        expect(res.itemSubtotal).toBe(750);
    });
});
