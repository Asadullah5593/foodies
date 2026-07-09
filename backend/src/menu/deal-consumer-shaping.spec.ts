import {
    restrictVariantsToSlotSize,
    restrictDealChoiceItemsForConsumer,
} from './deal-consumer-shaping';

/** A choice item resembling the real Fireaway "Chicken Wings" slot item (5/10 pcs variants). */
const wings = () => ({
    id: 2126,
    name: 'Chicken Wings',
    price: 799,
    addons: [{ id: 9, name: 'Extra dip', price: 100 }],
    variants: [
        { id: 1276, name: '5 Pcs', price_modifier: 0, size_key: '5' },
        { id: 1277, name: '10 Pcs', price_modifier: 700, size_key: '10' },
    ],
    modifier_groups: [
        {
            id: 533,
            name: 'Choose your Flavour',
            hide_in_deals: false,
            modifiers: [{ id: 3230, name: 'Plain' }],
        },
        {
            id: 999,
            name: 'Add a drink',
            hide_in_deals: true,
            modifiers: [{ id: 4000, name: 'Coke' }],
        },
    ],
});

describe('restrictVariantsToSlotSize', () => {
    const v = [
        { id: 1, size_key: '5' },
        { id: 2, size_key: '10' },
    ];

    it('keeps only the locked size (slot_size_key)', () => {
        expect(restrictVariantsToSlotSize(v, '5', null).map((x) => x.id)).toEqual([1]);
    });

    it('keeps only whitelisted sizes (allowed_size_keys)', () => {
        const three = [...v, { id: 3, size_key: '14' }];
        expect(
            restrictVariantsToSlotSize(three, null, ['5', '14']).map((x) => x.id),
        ).toEqual([1, 3]);
    });

    it('slot_size_key takes precedence over allowed_size_keys', () => {
        expect(
            restrictVariantsToSlotSize(v, '10', ['5']).map((x) => x.id),
        ).toEqual([2]);
    });

    it('falls back to ALL variants when no variant matches the locked size (non-size side)', () => {
        // e.g. a dip with a single sizeless variant sharing a "5"-locked slot.
        const side = [{ id: 7, size_key: null }];
        expect(restrictVariantsToSlotSize(side, '5', null)).toEqual(side);
    });

    it('falls back to ALL variants when no variant matches the whitelist', () => {
        expect(restrictVariantsToSlotSize(v, null, ['99'])).toEqual(v);
    });

    it('returns all variants unchanged when there is no size restriction', () => {
        expect(restrictVariantsToSlotSize(v, null, null)).toEqual(v);
        expect(restrictVariantsToSlotSize(v, null, [])).toEqual(v);
    });
});

describe('restrictDealChoiceItemsForConsumer', () => {
    it('drops the 10-piece variant for a 5-piece slot', () => {
        const [out] = restrictDealChoiceItemsForConsumer([wings()], '5', null);
        expect(out.variants.map((v) => v.size_key)).toEqual(['5']);
    });

    it('removes hide_in_deals cross-sell groups but keeps in-deal groups', () => {
        const [out] = restrictDealChoiceItemsForConsumer([wings()], '5', null);
        expect(out.modifier_groups.map((g) => g.id)).toEqual([533]);
    });

    it('strips add-ons entirely inside a deal', () => {
        const [out] = restrictDealChoiceItemsForConsumer([wings()], '5', null);
        expect(out.addons).toEqual([]);
    });

    it('does not mutate the input item', () => {
        const item = wings();
        restrictDealChoiceItemsForConsumer([item], '5', null);
        expect(item.variants).toHaveLength(2);
        expect(item.modifier_groups).toHaveLength(2);
        expect(item.addons).toHaveLength(1);
    });

    it('preserves all other fields (id, name, price)', () => {
        const [out] = restrictDealChoiceItemsForConsumer([wings()], '5', null);
        expect(out.id).toBe(2126);
        expect(out.name).toBe('Chicken Wings');
        expect(out.price).toBe(799);
    });

    it('tolerates items with no variants / groups / addons', () => {
        const bare = { id: 1, name: 'Dip' };
        const [out] = restrictDealChoiceItemsForConsumer([bare], null, null);
        expect(out).toMatchObject({ id: 1, name: 'Dip', addons: [], variants: [], modifier_groups: [] });
    });
});
