import {
    priceModifiersForLine,
    resolveModifierUnitPrice,
    resolveIncludedQuantity,
    resolveTierCharge,
    normalizePriceBySize,
    normalizeIncludedBySize,
    type PricingModifierGroup,
} from './modifier-pricing';

describe('modifier-pricing', () => {
    describe('resolveModifierUnitPrice', () => {
        it('uses the per-size price when the size matches', () => {
            const mod = { id: 1, price: 0, priceBySize: { '7': 99, '12': 249 } };
            expect(resolveModifierUnitPrice(mod, '12')).toBe(249);
        });
        it('falls back to flat price when size is absent from the map', () => {
            const mod = { id: 1, price: 50, priceBySize: { '12': 249 } };
            expect(resolveModifierUnitPrice(mod, '7')).toBe(50);
        });
        it('falls back to flat price when no size given', () => {
            const mod = { id: 1, price: 50, priceBySize: { '12': 249 } };
            expect(resolveModifierUnitPrice(mod, null)).toBe(50);
        });
    });

    describe('resolveIncludedQuantity', () => {
        it('prefers the per-size included count', () => {
            const g: PricingModifierGroup = {
                includedQuantity: 0,
                includedBySize: { '7': 2, '12': 3 },
            };
            expect(resolveIncludedQuantity(g, '12')).toBe(3);
        });
        it('falls back to includedQuantity when size missing', () => {
            const g: PricingModifierGroup = {
                includedQuantity: 1,
                includedBySize: { '12': 3 },
            };
            expect(resolveIncludedQuantity(g, '7')).toBe(1);
        });
    });

    describe('priceModifiersForLine', () => {
        it('reduces to flat sum(price*qty) with no size data or allowance (backwards compatible)', () => {
            const groups: PricingModifierGroup[] = [
                {
                    id: 1,
                    modifiers: [
                        { id: 10, name: 'Olives', price: 50 },
                        { id: 11, name: 'Mushroom', price: 30 },
                    ],
                },
            ];
            const res = priceModifiersForLine({
                modifierGroups: groups,
                selections: [
                    { modifier_id: 10, quantity: 1 },
                    { modifier_id: 11, quantity: 2 },
                ],
                sizeKey: null,
            });
            expect(res.total).toBe(50 + 30 * 2);
        });

        it('applies the size-specific surcharge (Extra Cheese 12" = 249)', () => {
            const groups: PricingModifierGroup[] = [
                {
                    id: 1,
                    modifiers: [
                        {
                            id: 10,
                            name: 'Extra Cheese',
                            price: 0,
                            priceBySize: { '7': 99, '10': 149, '12': 249, '14': 349 },
                        },
                    ],
                },
            ];
            const res = priceModifiersForLine({
                modifierGroups: groups,
                selections: [{ modifier_id: 10, quantity: 1 }],
                sizeKey: '12',
            });
            expect(res.total).toBe(249);
            expect(res.lines[0].unitPrice).toBe(249);
            expect(res.lines[0].sizeKey).toBe('12');
        });

        it('includes first N free per size, charges the rest at size price', () => {
            // "choose 3 meats free on 12\"" then extra meat = Rs199 each
            const groups: PricingModifierGroup[] = [
                {
                    id: 1,
                    includedBySize: { '7': 2, '12': 3 },
                    modifiers: [
                        { id: 1, name: 'Chicken', price: 0, priceBySize: { '12': 199 } },
                        { id: 2, name: 'Beef', price: 0, priceBySize: { '12': 199 } },
                        { id: 3, name: 'Kebab', price: 0, priceBySize: { '12': 199 } },
                        { id: 4, name: 'Sausage', price: 0, priceBySize: { '12': 199 } },
                    ],
                },
            ];
            const res = priceModifiersForLine({
                modifierGroups: groups,
                selections: [
                    { modifier_id: 1, quantity: 1 },
                    { modifier_id: 2, quantity: 1 },
                    { modifier_id: 3, quantity: 1 },
                    { modifier_id: 4, quantity: 1 },
                ],
                sizeKey: '12',
            });
            // 3 free, 1 charged @199
            expect(res.total).toBe(199);
            const charged = res.lines.filter((l) => l.charge > 0);
            expect(charged).toHaveLength(1);
        });

        it('counts "double meat" (same modifier x2) as two units against the allowance', () => {
            const groups: PricingModifierGroup[] = [
                {
                    id: 1,
                    includedBySize: { '7': 2 },
                    modifiers: [
                        { id: 1, name: 'Chicken', price: 0, priceBySize: { '7': 99 } },
                    ],
                },
            ];
            // select chicken x3 on a 7" (2 free) => 1 charged @99
            const res = priceModifiersForLine({
                modifierGroups: groups,
                selections: [{ modifier_id: 1, quantity: 3 }],
                sizeKey: '7',
            });
            expect(res.total).toBe(99);
            expect(res.lines[0].quantity).toBe(3);
            expect(res.lines[0].freeQuantity).toBe(2);
            expect(res.lines[0].charge).toBe(99);
        });

        it('frees the cheapest units across the group first', () => {
            const groups: PricingModifierGroup[] = [
                {
                    id: 1,
                    includedQuantity: 1,
                    modifiers: [
                        { id: 1, name: 'Cheap', price: 50 },
                        { id: 2, name: 'Dear', price: 100 },
                    ],
                },
            ];
            const res = priceModifiersForLine({
                modifierGroups: groups,
                selections: [
                    { modifier_id: 1, quantity: 1 },
                    { modifier_id: 2, quantity: 1 },
                ],
                sizeKey: null,
            });
            // cheapest (50) is free => charge the dear one (100)
            expect(res.total).toBe(100);
        });

        it('skips unknown modifier ids', () => {
            const res = priceModifiersForLine({
                modifierGroups: [
                    { id: 1, modifiers: [{ id: 1, name: 'X', price: 50 }] },
                ],
                selections: [{ modifier_id: 999, quantity: 1 }],
                sizeKey: null,
            });
            expect(res.total).toBe(0);
            expect(res.lines).toHaveLength(0);
        });

        it('applies allowances independently per group', () => {
            const groups: PricingModifierGroup[] = [
                {
                    id: 1,
                    includedQuantity: 1,
                    modifiers: [{ id: 1, name: 'Meat', price: 100 }],
                },
                {
                    id: 2,
                    includedQuantity: 0,
                    modifiers: [{ id: 2, name: 'Dip', price: 99 }],
                },
            ];
            const res = priceModifiersForLine({
                modifierGroups: groups,
                selections: [
                    { modifier_id: 1, quantity: 1 },
                    { modifier_id: 2, quantity: 1 },
                ],
                sizeKey: null,
            });
            // meat free (group1 allowance 1), dip charged
            expect(res.total).toBe(99);
        });
    });

    describe('resolveTierCharge', () => {
        const tiers = { '1': 99, '2': 169, '3': 249 };
        it('returns 0 for no charged units', () => {
            expect(resolveTierCharge(tiers, 0)).toBe(0);
        });
        it('uses exact tier values', () => {
            expect(resolveTierCharge(tiers, 1)).toBe(99);
            expect(resolveTierCharge(tiers, 2)).toBe(169);
            expect(resolveTierCharge(tiers, 3)).toBe(249);
        });
        it('packs largest bundles first beyond the table (no linear extrapolation)', () => {
            expect(resolveTierCharge(tiers, 4)).toBe(348); // 3 (249) + 1 (99)
            expect(resolveTierCharge(tiers, 5)).toBe(418); // 3 (249) + 2 (169)
            expect(resolveTierCharge(tiers, 6)).toBe(498); // 3 (249) + 3 (249)
            expect(resolveTierCharge(tiers, 7)).toBe(597); // 3 + 3 + 1
        });
    });

    describe('tiered group pricing (pizza dips: 1 free, then 99/169/249)', () => {
        const dipGroup: PricingModifierGroup = {
            id: 1,
            includedQuantity: 1,
            priceTiers: { '1': 99, '2': 169, '3': 249 },
            modifiers: [
                { id: 1, name: 'Ranch', price: 0 },
                { id: 2, name: 'BBQ', price: 0 },
                { id: 3, name: 'Garlic & Herb', price: 0 },
                { id: 4, name: 'Sweet Chilli', price: 0 },
            ],
        };
        const price = (sels: Array<{ modifier_id: number; quantity?: number }>) =>
            priceModifiersForLine({ modifierGroups: [dipGroup], selections: sels, sizeKey: null }).total;

        it('1 dip is free', () => {
            expect(price([{ modifier_id: 1, quantity: 1 }])).toBe(0);
        });
        it('2 dips (1 free + 1 extra) = 99', () => {
            expect(price([{ modifier_id: 1 }, { modifier_id: 2 }])).toBe(99);
        });
        it('3 dips (1 free + 2 extra) = 169', () => {
            expect(price([{ modifier_id: 1 }, { modifier_id: 2 }, { modifier_id: 3 }])).toBe(169);
        });
        it('4 dips (1 free + 3 extra) = 249', () => {
            expect(
                price([{ modifier_id: 1 }, { modifier_id: 2 }, { modifier_id: 3 }, { modifier_id: 4 }]),
            ).toBe(249);
        });
        it('same dip ×3 (1 free + 2 extra) = 169', () => {
            expect(price([{ modifier_id: 1, quantity: 3 }])).toBe(169);
        });
    });

    describe('conditional groups (visibleWhenModifierIds)', () => {
        // "Make it a Meal?" (id 100=Burger Only free, 101=Meal +350) + a conditional
        // "Choose your Meal Drink" (id 200 soda free, 201 milkshake +250) that only applies
        // when the paid meal option (101) is selected.
        const mealGroup: PricingModifierGroup = {
            id: 10,
            modifiers: [
                { id: 100, price: 0 },
                { id: 101, price: 350 },
            ],
        };
        const drinkGroup: PricingModifierGroup = {
            id: 11,
            visibleWhenModifierIds: [101],
            modifiers: [
                { id: 200, price: 0 },
                { id: 201, price: 250 },
            ],
        };
        const price = (sels: Array<{ modifier_id: number; quantity?: number }>) =>
            priceModifiersForLine({
                modifierGroups: [mealGroup, drinkGroup],
                selections: sels,
                sizeKey: null,
            });

        it('drops the meal-drink milkshake when no paid meal option is selected', () => {
            // "On its Own" (100) + a milkshake (201): the drink group is hidden → not charged.
            const res = price([{ modifier_id: 100 }, { modifier_id: 201 }]);
            expect(res.total).toBe(0);
            expect(res.lines.some((l) => l.modifierId === 201)).toBe(false);
        });
        it('charges the milkshake once the paid meal option is selected', () => {
            const res = price([{ modifier_id: 101 }, { modifier_id: 201 }]);
            expect(res.total).toBe(600); // 350 meal + 250 milkshake
        });
        it('a free soda in a triggered meal adds nothing but is kept', () => {
            const res = price([{ modifier_id: 101 }, { modifier_id: 200 }]);
            expect(res.total).toBe(350);
            expect(res.lines.some((l) => l.modifierId === 200)).toBe(true);
        });
    });

    describe('normalizers', () => {
        it('normalizePriceBySize drops invalid entries and empties to null', () => {
            expect(
                normalizePriceBySize({ '7': 99, '10': 'x', '12': -5, '14': 349 }),
            ).toEqual({ '7': 99, '14': 349 });
            expect(normalizePriceBySize({})).toBeNull();
            expect(normalizePriceBySize(null)).toBeNull();
        });
        it('normalizeIncludedBySize floors counts and drops empties', () => {
            expect(normalizeIncludedBySize({ '7': 2.9, '12': 3 })).toEqual({
                '7': 2,
                '12': 3,
            });
            expect(normalizeIncludedBySize({})).toBeNull();
        });
    });
});
