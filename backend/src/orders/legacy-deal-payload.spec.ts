import {
    isLegacyDealLine,
    normalizeLegacyDealLines,
    normalizeOrderBody,
} from './legacy-deal-payload';

/**
 * The fixture is a REAL request captured from the shipped app in production
 * (activity log, 26 Aug, the BOGO deal that returned 400). If this shape ever
 * stops matching, the shim is translating something that no longer exists.
 */
const LIVE_APP_LINE = {
    addons: [],
    quantity: 1,
    modifiers: [],
    variant_id: null,
    menu_item_id: 2514,
    deal_items: [
        {
            addons: [],
            modifiers: [{ modifier_id: 91, quantity: 1 }],
            slot_index: 0,
            variant_id: 1537,
            choice_item_id: 2422,
        },
        {
            addons: [],
            modifiers: [],
            slot_index: 1,
            variant_id: 1538,
            choice_item_id: 2423,
        },
    ],
};

describe('legacy deal payload shim', () => {
    it('converts the real shipped-app line into the shape the server expects', () => {
        const { items, legacyLines } = normalizeLegacyDealLines([
            LIVE_APP_LINE,
        ]);
        expect(legacyLines).toBe(1);
        const line = items[0] as Record<string, unknown>;

        expect(line.deal_menu_item_id).toBe(2514);
        expect(line.quantity).toBe(1);
        expect(line.components).toEqual([
            {
                slot_index: 0,
                menu_item_id: 2422,
                variant_id: 1537,
                modifiers: [{ modifier_id: 91, quantity: 1 }],
            },
            { slot_index: 1, menu_item_id: 2423, variant_id: 1538 },
        ]);
    });

    it('removes menu_item_id — leaving it would trip the plain-deal guard', () => {
        const { items } = normalizeLegacyDealLines([LIVE_APP_LINE]);
        expect(items[0]).not.toHaveProperty('menu_item_id');
        expect(items[0]).not.toHaveProperty('deal_items');
    });

    it('drops the root variant_id: the deal has no size, its slots do', () => {
        const { items } = normalizeLegacyDealLines([LIVE_APP_LINE]);
        expect(items[0]).not.toHaveProperty('variant_id');
    });

    it('never forwards a null variant_id — a sized slot refuses it', () => {
        const { items } = normalizeLegacyDealLines([
            {
                menu_item_id: 9,
                quantity: 1,
                deal_items: [
                    { slot_index: 0, choice_item_id: 5, variant_id: null },
                ],
            },
        ]);
        const c = (items[0] as { components: Record<string, unknown>[] })
            .components[0];
        expect(c).not.toHaveProperty('variant_id');
        expect(c.menu_item_id).toBe(5);
    });

    it('leaves ordinary lines completely alone', () => {
        const plain = { menu_item_id: 2678, quantity: 2, variant_id: 44 };
        const { items, legacyLines } = normalizeLegacyDealLines([plain]);
        expect(legacyLines).toBe(0);
        expect(items[0]).toEqual(plain);
    });

    it('leaves a line that already uses the current shape alone', () => {
        const modern = {
            deal_menu_item_id: 2514,
            quantity: 1,
            components: [{ slot_index: 0, menu_item_id: 2422 }],
        };
        const { items, legacyLines } = normalizeLegacyDealLines([modern]);
        expect(legacyLines).toBe(0);
        expect(items[0]).toEqual(modern);
    });

    it('handles a mixed cart — one legacy deal plus a normal item', () => {
        const { items, legacyLines } = normalizeLegacyDealLines([
            LIVE_APP_LINE,
            { menu_item_id: 2678, quantity: 1 },
        ]);
        expect(legacyLines).toBe(1);
        expect(items[0]).toHaveProperty('deal_menu_item_id', 2514);
        expect(items[1]).toEqual({ menu_item_id: 2678, quantity: 1 });
    });

    it.each([
        ['empty deal_items', { menu_item_id: 1, deal_items: [] }],
        ['no deal_items', { menu_item_id: 1, quantity: 1 }],
    ])('does not treat %s as a legacy deal', (_label, line) => {
        expect(isLegacyDealLine(line)).toBe(false);
    });

    describe('normalizeOrderBody', () => {
        it('IGNORES the duplicate top-level deals[] — merging would double-charge', () => {
            const body = {
                branch_id: 10,
                items: [LIVE_APP_LINE],
                deals: [
                    { deal_menu_item_id: 2514, quantity: 1, components: [] },
                ],
            };
            const out = normalizeOrderBody(body, '/test');
            // One deal in, one deal out.
            expect(out.items).toHaveLength(1);
            expect(out.items[0]).toHaveProperty('deal_menu_item_id', 2514);
        });

        it.each([undefined, null, {}, { items: 'nonsense' }])(
            'returns %p untouched rather than throwing',
            (body) => {
                expect(() =>
                    normalizeOrderBody(body as never, '/test'),
                ).not.toThrow();
            },
        );
    });
});
