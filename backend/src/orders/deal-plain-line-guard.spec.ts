import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * A deal ordered as a plain `menu_item_id` records none of the customer's slot
 * choices: the kitchen gets a bundle name with no contents and the receipt has
 * nothing to print. `expandDealItems` refuses it at placement instead of
 * letting an unfulfillable order through — while leaving ordinary lines, which
 * are the overwhelming majority, byte-for-byte unchanged.
 */
describe('expandDealItems — deal root sent as a plain line', () => {
    /** @param dealRootIds menu_item_ids that have rows in deal_components */
    const makeSvc = (dealRootIds: number[]) => {
        const query = jest.fn((sql: string, params: unknown[]) => {
            if (sql.includes('deal_components')) {
                const asked = (params?.[0] as number[]) ?? [];
                return Promise.resolve(
                    dealRootIds
                        .filter((id) => asked.includes(id))
                        .map((id) => ({ menu_item_id: id })),
                );
            }
            return Promise.resolve([]);
        });
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, { dataSource: { query } });
        // Private by design; the guard lives inside it.
        const expand = (
            svc as unknown as {
                expandDealItems: (
                    branchId: number,
                    items: unknown[],
                    orderType: string,
                ) => Promise<unknown[]>;
            }
        ).expandDealItems.bind(svc);
        return { expand, query };
    };

    it('rejects a plain line whose menu item is a deal root', async () => {
        const { expand } = makeSvc([2586]);
        await expect(
            expand(10, [{ menu_item_id: 2586, quantity: 1 }], 'delivery'),
        ).rejects.toThrow(BadRequestException);
    });

    it('names the id and the payload to send, so the client can fix itself', async () => {
        const { expand } = makeSvc([2586]);
        await expect(
            expand(10, [{ menu_item_id: 2586, quantity: 1 }], 'delivery'),
        ).rejects.toThrow(/2586.*deal_menu_item_id.*components/s);
    });

    it('leaves an ordinary item untouched', async () => {
        const { expand } = makeSvc([2586]);
        const out = await expand(
            10,
            [
                {
                    menu_item_id: 999,
                    quantity: 2,
                    variant_id: 3,
                    addons: [{ addon_id: 1, quantity: 1 }],
                    modifiers: [{ modifier_id: 7 }],
                    notes: 'No onions',
                },
            ],
            'delivery',
        );
        expect(out).toEqual([
            {
                menu_item_id: 999,
                quantity: 2,
                variant_id: 3,
                addons: [{ addon_id: 1, quantity: 1 }],
                modifiers: [{ modifier_id: 7 }],
                notes: 'No onions',
                branch_id: undefined,
                source_index: 0,
            },
        ]);
    });

    it('defaults quantity and preserves order for several ordinary items', async () => {
        const { expand } = makeSvc([2586]);
        const out = (await expand(
            10,
            [{ menu_item_id: 11 }, { menu_item_id: 12, quantity: 4 }],
            'delivery',
        )) as Array<{ menu_item_id: number; quantity: number }>;
        expect(out.map((l) => [l.menu_item_id, l.quantity])).toEqual([
            [11, 1],
            [12, 4],
        ]);
    });

    it('rejects the whole order when one line of many is a deal root', async () => {
        const { expand } = makeSvc([2586]);
        await expect(
            expand(
                10,
                [{ menu_item_id: 999 }, { menu_item_id: 2586 }],
                'delivery',
            ),
        ).rejects.toThrow(BadRequestException);
    });

    it('looks the ids up once for the whole order, not per line', async () => {
        const { expand, query } = makeSvc([]);
        await expand(
            10,
            [{ menu_item_id: 11 }, { menu_item_id: 12 }, { menu_item_id: 11 }],
            'delivery',
        );
        const dealLookups = query.mock.calls.filter((c) =>
            String(c[0]).includes('deal_components'),
        );
        expect(dealLookups).toHaveLength(1);
        // De-duplicated ids only.
        expect(dealLookups[0][1]).toEqual([[11, 12]]);
    });

    it('runs no lookup when the order has no plain lines', async () => {
        const { expand, query } = makeSvc([2586]);
        await expand(10, [], 'delivery');
        expect(
            query.mock.calls.filter((c) =>
                String(c[0]).includes('deal_components'),
            ),
        ).toHaveLength(0);
    });
});
