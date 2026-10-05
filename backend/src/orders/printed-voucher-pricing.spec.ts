import {
    branchLocalDate,
    evaluateVoucher,
    voucherIneligibleMessage,
    voucherIneligibleReason,
    voucherMissMessage,
    VoucherLine,
    VoucherRules,
} from './printed-voucher-pricing';

/**
 * The printed coupon book, rule by rule. Prices are the real menu's: a 12"
 * pizza is Rs 1,499–1,949, a Smashed Classic Rs 999 and its "Add Fries &
 * Drink" option Rs 350.
 */
const voucher = (over: Partial<VoucherRules>): VoucherRules => ({
    brandId: 25,
    voucherType: 'fixed_price',
    value: 999,
    isActive: true,
    ...over,
});

const PIZZA_CATEGORIES = [501, 502]; // Classic, Signature
const MEAL_OPTION = 9001; // "Add Fries & Drink"

const pizza = (unitPrice: number, over: Partial<VoucherLine> = {}) => ({
    menuItemId: 10,
    categoryId: 501,
    unitPrice,
    quantity: 1,
    itemSubtotal: unitPrice,
    ...over,
});

const run = (v: VoucherRules, lines: VoucherLine[], excluded?: boolean[]) =>
    evaluateVoucher(
        v,
        lines,
        excluded ?? lines.map(() => false),
        lines.map((l) => l.itemSubtotal),
    );

describe('fixed-price voucher ("Any large pizza for Rs 999")', () => {
    const v = voucher({ categoryIds: PIZZA_CATEGORIES });

    it('charges the qualifying item at the voucher price', () => {
        expect(run(v, [pizza(1949)])).toEqual({
            applies: true,
            alloc: [950],
            amount: 950,
        });
    });

    it('covers ONE item — the one where the customer saves most', () => {
        const res = run(v, [pizza(1499), pizza(1949), pizza(1749)]);
        expect(res).toEqual({
            applies: true,
            alloc: [0, 950, 0],
            amount: 950,
        });
    });

    it('covers one unit of a line with quantity 3, not all three', () => {
        const res = run(v, [pizza(1949, { quantity: 3, itemSubtotal: 5847 })]);
        expect(res).toEqual({ applies: true, alloc: [950], amount: 950 });
    });

    it('charges extras on top: toppings are not part of the voucher price', () => {
        // 1,949 pizza + Rs 249 extra cheese = 2,198 → pays 999 + 249.
        const res = run(v, [
            pizza(1949, {
                itemSubtotal: 2198,
                modifierCharges: [
                    {
                        modifierId: 77,
                        quantity: 1,
                        freeQuantity: 0,
                        charge: 249,
                    },
                ],
            }),
        ]);
        expect(res).toMatchObject({ applies: true, amount: 950 });
    });

    it('leaves items outside its categories at full price', () => {
        const res = run(v, [
            {
                menuItemId: 90,
                categoryId: 700,
                unitPrice: 299,
                itemSubtotal: 299,
            },
            pizza(1499),
        ]);
        expect(res).toMatchObject({ applies: true, alloc: [0, 500] });
    });

    it('qualifies an item by product as well as by category', () => {
        const cookie = voucher({ value: 399, productIds: [42] });
        const res = run(cookie, [
            {
                menuItemId: 42,
                categoryId: 800,
                unitPrice: 499,
                itemSubtotal: 499,
            },
        ]);
        expect(res).toMatchObject({ applies: true, amount: 100 });
    });

    it('never raises a price: an item cheaper than the voucher gives nothing', () => {
        expect(run(v, [pizza(899)])).toEqual({
            applies: false,
            reason: 'no_saving',
        });
    });

    it('says so when nothing in the cart qualifies', () => {
        expect(
            run(v, [
                {
                    menuItemId: 90,
                    categoryId: 700,
                    unitPrice: 299,
                    itemSubtotal: 299,
                },
            ]),
        ).toEqual({ applies: false, reason: 'no_qualifying_item' });
    });

    it('never touches an item inside a deal', () => {
        expect(run(v, [pizza(1949)], [true])).toEqual({
            applies: false,
            reason: 'no_qualifying_item',
        });
    });
});

describe('meal voucher ("Classic Smashed Burger Meal for Rs 799")', () => {
    const v = voucher({
        brandId: 23,
        value: 799,
        productIds: [300],
        includedModifierIds: [MEAL_OPTION],
    });
    const burger = (over: Partial<VoucherLine> = {}): VoucherLine => ({
        menuItemId: 300,
        categoryId: 600,
        unitPrice: 999,
        quantity: 1,
        itemSubtotal: 999,
        ...over,
    });
    const asMeal = (extra: VoucherLine['modifierCharges'] = []) =>
        burger({
            itemSubtotal:
                999 + 350 + (extra ?? []).reduce((s, m) => s + m.charge, 0),
            modifierCharges: [
                {
                    modifierId: MEAL_OPTION,
                    quantity: 1,
                    freeQuantity: 0,
                    charge: 350,
                },
                ...(extra ?? []),
            ],
        });

    it('prices the burger and its fries + drink together', () => {
        // 999 + 350 = 1,349 → 799.
        expect(run(v, [asMeal()])).toEqual({
            applies: true,
            alloc: [550],
            amount: 550,
        });
    });

    it('needs the meal option: the burger on its own does not qualify', () => {
        expect(run(v, [burger()])).toEqual({
            applies: false,
            reason: 'needs_included_option',
        });
    });

    it('charges a paid drink upgrade on top of the meal price', () => {
        // + 500ml drink upgrade Rs 50: still 550 off, so the customer pays 849.
        const res = run(v, [
            asMeal([
                { modifierId: 9100, quantity: 1, freeQuantity: 0, charge: 50 },
            ]),
        ]);
        expect(res).toMatchObject({ applies: true, amount: 550 });
    });

    it('treats several included options as alternatives, not a checklist', () => {
        const either = voucher({
            brandId: 23,
            value: 799,
            productIds: [300],
            includedModifierIds: [MEAL_OPTION, 9002],
        });
        const spicy = burger({
            itemSubtotal: 999 + 380,
            modifierCharges: [
                { modifierId: 9002, quantity: 1, freeQuantity: 0, charge: 380 },
            ],
        });
        // 999 + 380 = 1,379 → 799.
        expect(run(either, [spicy])).toMatchObject({
            applies: true,
            amount: 580,
        });
    });

    it('covers one meal on a line of two burgers sharing one meal option', () => {
        // The server prices extras once per line: 2 x 999 + 350.
        const res = run(v, [
            burger({
                quantity: 2,
                itemSubtotal: 2 * 999 + 350,
                modifierCharges: [
                    {
                        modifierId: MEAL_OPTION,
                        quantity: 1,
                        freeQuantity: 0,
                        charge: 350,
                    },
                ],
            }),
        ]);
        expect(res).toMatchObject({ applies: true, amount: 550 });
    });

    it('covers nothing extra for an option the group already gave free', () => {
        const res = run(v, [
            burger({
                itemSubtotal: 999,
                modifierCharges: [
                    {
                        modifierId: MEAL_OPTION,
                        quantity: 1,
                        freeQuantity: 1,
                        charge: 0,
                    },
                ],
            }),
        ]);
        // 999 → 799.
        expect(res).toMatchObject({ applies: true, amount: 200 });
    });
});

describe('percentage voucher ("30% off")', () => {
    const v = voucher({
        voucherType: 'percentage',
        value: 30,
        categoryIds: PIZZA_CATEGORIES,
    });

    it('takes the percentage off every qualifying line, extras included', () => {
        const res = run(v, [
            pizza(1499),
            pizza(1949, { itemSubtotal: 2198 }),
            {
                menuItemId: 90,
                categoryId: 700,
                unitPrice: 250,
                itemSubtotal: 250,
            },
        ]);
        // 30% of (1,499 + 2,198) = 1,109.10; the drink is out of scope.
        expect(res).toEqual({
            applies: true,
            alloc: [449.7, 659.4, 0],
            amount: 1109.1,
        });
    });

    it('splits to the paisa: the parts always sum to the whole', () => {
        const res = run(voucher({ voucherType: 'percentage', value: 33 }), [
            pizza(333.33),
            pizza(333.33),
            pizza(333.34),
        ]);
        expect(res.applies).toBe(true);
        if (res.applies) {
            const sum = res.alloc.reduce((s, x) => s + x, 0);
            expect(Math.round(sum * 100)).toBe(Math.round(res.amount * 100));
            expect(res.amount).toBe(330);
        }
    });

    it('with no categories or products, covers the whole menu', () => {
        const res = run(voucher({ voucherType: 'percentage', value: 10 }), [
            pizza(1000),
            {
                menuItemId: 90,
                categoryId: 700,
                unitPrice: 500,
                itemSubtotal: 500,
            },
        ]);
        expect(res).toMatchObject({ applies: true, amount: 150 });
    });

    it('honours a maximum discount', () => {
        const res = run({ ...v, maxDiscountAmount: 400 }, [pizza(1949)]);
        expect(res).toMatchObject({ applies: true, amount: 400 });
    });

    it('skips deal lines and says so when only deals qualify', () => {
        expect(run(v, [pizza(1949), pizza(1499)], [true, false])).toMatchObject(
            { applies: true, alloc: [0, 449.7] },
        );
        expect(run(v, [pizza(1949)], [true])).toEqual({
            applies: false,
            reason: 'no_qualifying_item',
        });
    });
});

describe('where and when a voucher can be used', () => {
    const order = {
        brandId: 25,
        branchId: 10,
        orderType: 'dine_in',
        today: '2026-11-30',
    };
    const v = voucher({
        eligibilityBranchIds: [10, 17],
        orderTypes: ['pickup', 'dine_in'],
        validFrom: '2026-10-01',
        validUntil: '2026-11-30',
    });

    it('is usable inside its brand, branch, order type and dates', () => {
        expect(voucherIneligibleReason(v, order)).toBeNull();
    });

    it('works all day on its last day and not the day after', () => {
        expect(
            voucherIneligibleReason(v, { ...order, today: '2026-11-30' }),
        ).toBeNull();
        expect(
            voucherIneligibleReason(v, { ...order, today: '2026-12-01' }),
        ).toBe('expired');
    });

    it('is not usable before its first day', () => {
        expect(
            voucherIneligibleReason(v, { ...order, today: '2026-09-30' }),
        ).toBe('not_started');
    });

    it('is not valid for delivery when delivery is unticked', () => {
        expect(
            voucherIneligibleReason(v, { ...order, orderType: 'delivery' }),
        ).toBe('wrong_order_type');
    });

    it("treats the till's takeaway as pickup", () => {
        expect(
            voucherIneligibleReason(v, { ...order, orderType: 'takeaway' }),
        ).toBeNull();
    });

    it('belongs to one brand, and never to a mixed-brand cart', () => {
        expect(voucherIneligibleReason(v, { ...order, brandId: 23 })).toBe(
            'wrong_brand',
        );
        expect(voucherIneligibleReason(v, { ...order, brandId: null })).toBe(
            'wrong_brand',
        );
    });

    it('is limited to its branches', () => {
        expect(voucherIneligibleReason(v, { ...order, branchId: 16 })).toBe(
            'wrong_branch',
        );
    });

    it('with no branches, order types or dates set, is usable everywhere', () => {
        const open = voucher({});
        expect(
            voucherIneligibleReason(open, {
                brandId: 25,
                branchId: 99,
                orderType: 'delivery',
                today: '2030-01-01',
            }),
        ).toBeNull();
    });

    it('cannot be used once switched off', () => {
        expect(voucherIneligibleReason({ ...v, isActive: false }, order)).toBe(
            'inactive',
        );
    });
});

describe('branch-local date', () => {
    it('is still the 30th in Karachi at 23:30 local, though UTC has moved on', () => {
        // 23:30 PKT on 30 Nov = 18:30 UTC the same day.
        expect(
            branchLocalDate('Asia/Karachi', new Date('2026-11-30T18:30:00Z')),
        ).toBe('2026-11-30');
        // 02:00 PKT on 1 Dec = 21:00 UTC on 30 Nov: the voucher's day is over.
        expect(
            branchLocalDate('Asia/Karachi', new Date('2026-11-30T21:00:00Z')),
        ).toBe('2026-12-01');
    });

    it('falls back to UTC for a branch with no timezone', () => {
        expect(branchLocalDate(null, new Date('2026-11-30T21:00:00Z'))).toBe(
            '2026-11-30',
        );
    });
});

describe('messages for the cashier', () => {
    it('names the option a meal voucher needs', () => {
        expect(
            voucherMissMessage('needs_included_option', ['Add Fries & Drink']),
        ).toBe('Add "Add Fries & Drink" to the item to use this voucher.');
    });

    it('explains the other misses', () => {
        expect(voucherMissMessage('no_qualifying_item')).toMatch(/qualifies/);
        expect(voucherMissMessage('no_saving')).toMatch(/voucher price/);
    });

    it('explains why a voucher is not usable on this order', () => {
        const v = { validFrom: '2026-10-01', validUntil: '2026-11-30' };
        expect(voucherIneligibleMessage('expired', v)).toBe(
            'This voucher expired on 30 Nov 2026.',
        );
        expect(voucherIneligibleMessage('not_started', v)).toBe(
            'This voucher is not valid until 1 Oct 2026.',
        );
        expect(
            voucherIneligibleMessage('wrong_order_type', v, 'delivery'),
        ).toBe('This voucher is not valid for delivery orders.');
        expect(
            voucherIneligibleMessage('wrong_order_type', v, 'takeaway'),
        ).toBe('This voucher is not valid for takeaway orders.');
    });
});
