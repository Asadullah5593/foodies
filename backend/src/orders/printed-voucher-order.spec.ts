import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { resolveOfferSettings } from './offer-settings';

/**
 * Printed vouchers on an order: who may apply them, which may sit together,
 * that they stand apart from every other discount and replace it rather than
 * stacking with it. Drives the real OrdersService methods on a prototype
 * instance with mocked repositories, like staged-offers.spec.ts.
 */
type Any = Record<string, unknown>;

const PIZZA = 999;
const voucher = (over: Any = {}): Any => ({
    id: 5,
    tenantId: 1,
    brandId: 25,
    name: 'Any Large Pizza',
    voucherType: 'fixed_price',
    value: PIZZA,
    maxDiscountAmount: null,
    categoryIds: [501],
    productIds: null,
    includedModifierIds: null,
    eligibilityBranchIds: null,
    orderTypes: ['pickup', 'dine_in'],
    validFrom: null,
    validUntil: null,
    isActive: true,
    ...over,
});

/** A 50% automatic discount on everything — the weekend BOGO-style offer. */
const autoHalfOff: Any = {
    id: 20,
    offerKind: 'discount',
    activation: 'auto',
    requiresCode: false,
    type: 'percentage',
    value: 50,
    applicationScope: 'whole_order',
    applicationScopeIds: null,
    eligibilityBranchIds: null,
    eligibilityBrandIds: null,
    requiresCard: false,
    eligibleBankCardIds: null,
    minOrderAmount: null,
    maxDiscountAmount: null,
    validFrom: null,
    validUntil: null,
    posOnly: false,
    code: null,
    funding: 'merchant',
};

const pizzaLine = (unitPrice: number, over: Any = {}): Any => ({
    menuItemId: 10,
    categoryId: 501,
    brandId: 25,
    itemSubtotal: unitPrice,
    unitPrice,
    quantity: 1,
    isDeal: false,
    ...over,
});
const drinkLine: Any = {
    menuItemId: 90,
    categoryId: 700,
    brandId: 25,
    itemSubtotal: 250,
    unitPrice: 250,
    quantity: 1,
    isDeal: false,
};

type Request = { voucherId: number; quantity: number };
type Internals = {
    assertVoucherStandsAlone: (dto: Any) => void;
    voucherRequestsOf: (dto: Any) => Request[];
    authorizeVouchers: (
        requests: Request[],
        tenantId: number,
        actor: Any | null,
        branchId: number,
        orderBrandId: number | null,
        orderType: string | null,
    ) => Promise<Array<{ voucher: Any; quantity: number }>>;
    resolveStagedOffers: (ctx: Any) => Promise<
        Any & {
            combinedLineDiscount: number[];
            totalDiscount: number;
            voucherDiscountAmount: number;
            voucherShares: Array<{
                voucher: Any;
                quantity: number;
                amount: number;
            }>;
            voucherMiss: { voucher: Any; reason: string } | null;
            discountAmount: number;
            discountId: number | null;
            lineBreakdown: Array<{ discounts: Array<{ kind: string }> }>;
        }
    >;
    voucherMissText: (problem: {
        voucher: Any;
        reason: string;
        requested?: number;
        qualifying?: number;
    }) => Promise<string>;
};

function service(
    opts: { found?: Any | null; vouchers?: Any[]; autoOffers?: Any[] } = {},
) {
    const discountFind = jest.fn().mockResolvedValue(opts.autoOffers ?? []);
    const svc = Object.create(OrdersService.prototype) as unknown as Internals &
        Any;
    Object.assign(svc, {
        printedVoucherRepo: {
            findOne: jest.fn(({ where }: { where: { id: number } }) => {
                if (opts.vouchers)
                    return Promise.resolve(
                        opts.vouchers.find((v) => v.id === where.id) ?? null,
                    );
                return Promise.resolve(
                    opts.found === undefined ? voucher() : opts.found,
                );
            }),
        },
        branchRepo: {
            findOne: jest.fn().mockResolvedValue({ timezone: 'Asia/Karachi' }),
        },
        discountRepo: { find: discountFind, findOne: jest.fn() },
        bankCardRepo: { find: jest.fn().mockResolvedValue([]) },
        isDiscountValidForBranchTime: jest.fn().mockResolvedValue(true),
        dataSource: {
            query: jest.fn().mockResolvedValue([{ name: 'Add Fries & Drink' }]),
        },
    });
    return { svc, discountFind };
}

const cashier = { permissions: ['printed-vouchers:apply'] };
const one = (voucherId: number): Request[] => [{ voucherId, quantity: 1 }];
/** A single voucher in the pricing context, the way createOrder passes it. */
const applied = (v: Any, quantity = 1) => [{ voucher: v, quantity }];
const stagedCtx = (over: Any): Any => ({
    tenantId: 1,
    subtotal: 0,
    source: 'pos',
    orderType: 'dine_in',
    branchId: 10,
    orderBrandId: 25,
    couponCode: null,
    fullCardPayment: false,
    bankCardId: null,
    settings: resolveOfferSettings(null),
    ...over,
});

describe('who may apply a printed voucher', () => {
    it('is nothing to authorize when no voucher was asked for', async () => {
        const { svc } = service();
        await expect(
            svc.authorizeVouchers([], 1, cashier, 10, 25, 'dine_in'),
        ).resolves.toEqual([]);
    });

    it('reads the list, the one-voucher shorthand, and adds repeats up', () => {
        const { svc } = service();
        expect(svc.voucherRequestsOf({})).toEqual([]);
        expect(svc.voucherRequestsOf({ voucher_id: 5 })).toEqual(one(5));
        expect(
            svc.voucherRequestsOf({
                vouchers: [
                    { voucher_id: 5, quantity: 2 },
                    { voucher_id: 6 },
                    { voucher_id: 5, quantity: 1 },
                    { voucher_id: 'x', quantity: 1 },
                    { voucher_id: 7, quantity: 0 },
                ],
            }),
        ).toEqual([
            { voucherId: 5, quantity: 3 },
            { voucherId: 6, quantity: 1 },
        ]);
    });

    it('needs a signed-in user holding printed-vouchers:apply', async () => {
        const { svc } = service();
        await expect(
            svc.authorizeVouchers(one(5), 1, null, 10, 25, 'dine_in'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            svc.authorizeVouchers(
                one(5),
                1,
                { permissions: ['staff-discounts:apply'] },
                10,
                25,
                'dine_in',
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is looked up inside the tenant only', async () => {
        const { svc } = service({ found: null });
        await expect(
            svc.authorizeVouchers(one(5), 1, cashier, 10, 25, 'dine_in'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(
            (svc.printedVoucherRepo as { findOne: jest.Mock }).findOne,
        ).toHaveBeenCalledWith({ where: { id: 5, tenantId: 1 } });
    });

    it('returns the vouchers, with their paper counts, when they can be used on this order', async () => {
        const { svc } = service();
        await expect(
            svc.authorizeVouchers(
                [{ voucherId: 5, quantity: 3 }],
                1,
                cashier,
                10,
                25,
                'takeaway',
            ),
        ).resolves.toMatchObject([{ voucher: { id: 5 }, quantity: 3 }]);
    });

    it('lets fixed-price vouchers sit together, and a percentage voucher only alone', async () => {
        const pizza = voucher();
        const box = voucher({
            id: 7,
            name: 'Any Classic Box',
            categoryIds: [502],
        });
        const thirty = voucher({
            id: 8,
            name: '30% Off Entire Menu',
            voucherType: 'percentage',
            value: 30,
        });
        const { svc } = service({ vouchers: [pizza, box, thirty] });
        await expect(
            svc.authorizeVouchers(
                [
                    { voucherId: 5, quantity: 2 },
                    { voucherId: 7, quantity: 1 },
                ],
                1,
                cashier,
                10,
                25,
                'dine_in',
            ),
        ).resolves.toHaveLength(2);
        await expect(
            svc.authorizeVouchers(one(8), 1, cashier, 10, 25, 'dine_in'),
        ).resolves.toHaveLength(1);
        for (const requests of [
            [...one(8), ...one(5)],
            [...one(5), ...one(8)],
            [{ voucherId: 8, quantity: 2 }],
        ]) {
            const err = await svc
                .authorizeVouchers(requests, 1, cashier, 10, 25, 'dine_in')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(BadRequestException);
            expect((err as Error).message).toBe(
                '30% Off Entire Menu: A percentage voucher cannot be combined with other vouchers.',
            );
        }
    });

    it.each([
        ['another brand', 23, 'dine_in', /different brand/],
        ['a delivery order', 25, 'delivery', /not valid for delivery/],
    ])('refuses it on %s', async (_label, brandId, orderType, message) => {
        const { svc } = service();
        const err = await svc
            .authorizeVouchers(one(5), 1, cashier, 10, brandId, orderType)
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toMatch(message);
    });

    it('refuses a voucher that is switched off or past its last day', async () => {
        const off = service({ found: voucher({ isActive: false }) });
        await expect(
            off.svc.authorizeVouchers(one(5), 1, cashier, 10, 25, 'dine_in'),
        ).rejects.toThrow(/switched off/);
        const expired = service({
            found: voucher({ validUntil: '2020-01-01' }),
        });
        await expect(
            expired.svc.authorizeVouchers(
                one(5),
                1,
                cashier,
                10,
                25,
                'dine_in',
            ),
        ).rejects.toThrow(/expired on 1 Jan 2020/);
    });
});

describe('a voucher stands alone', () => {
    const { svc } = service();

    it('accepts a request that asks for nothing else', () => {
        expect(() =>
            svc.assertVoucherStandsAlone({
                discount_code: '  ',
                loyalty_points_to_redeem: 0,
            }),
        ).not.toThrow();
    });

    it.each([
        [{ staff_discount_id: 3 }, /staff discount/],
        [{ manual_offer_id: 9 }, /the offer/],
        [{ discount_code: 'SAVE10' }, /discount code/],
        [{ loyalty_points_to_redeem: 50 }, /loyalty points/],
    ])('refuses to combine with %j', (dto, message) => {
        expect(() => svc.assertVoucherStandsAlone(dto)).toThrow(
            BadRequestException,
        );
        expect(() => svc.assertVoucherStandsAlone(dto)).toThrow(message);
    });
});

describe('pricing an order with a voucher', () => {
    it('is the only discount: the automatic 50% offer does not run', async () => {
        const { svc, discountFind } = service({ autoOffers: [autoHalfOff] });
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 1949 + 250,
                lineDetails: [pizzaLine(1949), drinkLine],
                vouchers: applied(voucher()),
            }),
        );
        // Pizza 1,949 → 999; the drink stays full price. Without the voucher
        // the 50% offer would have taken 1,099.50 off instead.
        expect(r.combinedLineDiscount).toEqual([950, 0]);
        expect(r.totalDiscount).toBe(950);
        expect(r.voucherDiscountAmount).toBe(950);
        expect(r.voucherShares).toMatchObject([
            { voucher: { id: 5 }, quantity: 1, amount: 950 },
        ]);
        expect(r.voucherMiss).toBeNull();
        expect(r.discountAmount).toBe(0);
        expect(r.lineBreakdown[0].discounts.map((d) => d.kind)).toEqual([
            'voucher',
        ]);
        // Other offers are not even looked up.
        expect(discountFind).not.toHaveBeenCalled();
    });

    it('is never written to orders.discount_id (not a discounts row)', async () => {
        const { svc } = service();
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 1949,
                lineDetails: [pizzaLine(1949)],
                vouchers: applied(voucher()),
            }),
        );
        expect(r.discountId).toBeNull();
    });

    it('honours the printed price past the tenant cap and the cost floor', async () => {
        const { svc } = service();
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 1949,
                lineDetails: [pizzaLine(1949, { unitCost: 1500 })],
                vouchers: applied(voucher()),
                settings: resolveOfferSettings({ maxTotalDiscountPercent: 10 }),
            }),
        );
        expect(r.voucherDiscountAmount).toBe(950);
    });

    it('leaves a pizza inside a deal alone', async () => {
        const { svc } = service();
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 1949,
                lineDetails: [pizzaLine(1949, { isDeal: true })],
                vouchers: applied(voucher()),
            }),
        );
        expect(r.voucherDiscountAmount).toBe(0);
        expect(r.voucherMiss).toMatchObject({ reason: 'no_qualifying_item' });
    });

    it('when the cart does not qualify, says why and prices it normally', async () => {
        const { svc, discountFind } = service({ autoOffers: [autoHalfOff] });
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 250,
                lineDetails: [drinkLine],
                vouchers: applied(voucher()),
            }),
        );
        expect(r.voucherMiss).toMatchObject({ reason: 'no_qualifying_item' });
        expect(r.voucherDiscountAmount).toBe(0);
        // The cart is priced as if no voucher had been asked for.
        expect(discountFind).toHaveBeenCalled();
        expect(r.discountAmount).toBe(125);
    });

    it('prices a meal voucher on the burger and its meal option together', async () => {
        const { svc } = service();
        const meal = voucher({
            id: 6,
            brandId: 23,
            name: 'Classic Smashed Burger Meal',
            value: 799,
            categoryIds: null,
            productIds: [300],
            includedModifierIds: [9001],
        });
        const burger = {
            menuItemId: 300,
            categoryId: 600,
            brandId: 23,
            itemSubtotal: 999 + 350,
            unitPrice: 999,
            quantity: 1,
            modifierCharges: [
                { modifierId: 9001, quantity: 1, freeQuantity: 0, charge: 350 },
            ],
        };
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                orderBrandId: 23,
                subtotal: 1349,
                lineDetails: [burger],
                vouchers: applied(meal),
            }),
        );
        expect(r.voucherDiscountAmount).toBe(550);

        const plain = await svc.resolveStagedOffers(
            stagedCtx({
                orderBrandId: 23,
                subtotal: 999,
                lineDetails: [
                    { ...burger, itemSubtotal: 999, modifierCharges: [] },
                ],
                vouchers: applied(meal),
            }),
        );
        expect(plain.voucherMiss).toMatchObject({
            reason: 'needs_included_option',
        });
    });
});

describe('pricing an order with several vouchers', () => {
    it('three pizza vouchers price three pizzas, and the report sees one kind with three papers', async () => {
        const { svc, discountFind } = service({ autoOffers: [autoHalfOff] });
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 1949 + 1749 + 1499 + 250,
                lineDetails: [
                    pizzaLine(1949),
                    pizzaLine(1749),
                    pizzaLine(1499),
                    drinkLine,
                ],
                vouchers: applied(voucher(), 3),
            }),
        );
        expect(r.combinedLineDiscount).toEqual([950, 750, 500, 0]);
        expect(r.voucherDiscountAmount).toBe(2200);
        expect(r.voucherShares).toMatchObject([
            { voucher: { id: 5 }, quantity: 3, amount: 2200 },
        ]);
        expect(discountFind).not.toHaveBeenCalled();
    });

    it('a burger meal and a full chicken together, each on its own item', async () => {
        const { svc } = service();
        const meal = voucher({
            id: 6,
            brandId: 23,
            name: 'Classic Smashed Burger Meal',
            value: 799,
            categoryIds: null,
            productIds: [300],
            includedModifierIds: [9001],
        });
        const chicken = voucher({
            id: 7,
            brandId: 23,
            name: 'Full Peri Peri Chicken',
            value: 1499,
            categoryIds: null,
            productIds: [301],
        });
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                orderBrandId: 23,
                subtotal: 1349 + 2499,
                lineDetails: [
                    {
                        menuItemId: 300,
                        categoryId: 600,
                        brandId: 23,
                        itemSubtotal: 1349,
                        unitPrice: 999,
                        quantity: 1,
                        modifierCharges: [
                            {
                                modifierId: 9001,
                                quantity: 1,
                                freeQuantity: 0,
                                charge: 350,
                            },
                        ],
                    },
                    {
                        menuItemId: 301,
                        categoryId: 601,
                        brandId: 23,
                        itemSubtotal: 2499,
                        unitPrice: 2499,
                        quantity: 1,
                    },
                ],
                vouchers: [
                    { voucher: meal, quantity: 1 },
                    { voucher: chicken, quantity: 1 },
                ],
            }),
        );
        expect(r.combinedLineDiscount).toEqual([550, 1000]);
        expect(r.voucherShares).toMatchObject([
            { voucher: { id: 6 }, amount: 550 },
            { voucher: { id: 7 }, amount: 1000 },
        ]);
    });

    it('with more papers than pizzas, names the voucher and the count', async () => {
        const { svc } = service();
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 1949 + 1749,
                lineDetails: [pizzaLine(1949), pizzaLine(1749)],
                vouchers: applied(voucher(), 3),
            }),
        );
        expect(r.voucherDiscountAmount).toBe(0);
        expect(r.voucherMiss).toMatchObject({
            voucher: { id: 5 },
            reason: 'not_enough_items',
            requested: 3,
            qualifying: 2,
        });
        await expect(svc.voucherMissText(r.voucherMiss!)).resolves.toBe(
            'Any Large Pizza: Only 2 items in the cart qualify, but 3 vouchers were applied. Remove one or add the item.',
        );
    });
});

describe('telling the cashier why a voucher did not apply', () => {
    it('names the voucher and the option a meal voucher needs', async () => {
        const { svc } = service();
        await expect(
            svc.voucherMissText({
                voucher: voucher({
                    name: 'Classic Smashed Burger Meal',
                    includedModifierIds: [9001],
                }),
                reason: 'needs_included_option',
            }),
        ).resolves.toBe(
            'Classic Smashed Burger Meal: Add "Add Fries & Drink" to the item to use this voucher.',
        );
    });

    it('needs no lookup for the other reasons', async () => {
        const { svc } = service();
        await expect(
            svc.voucherMissText({
                voucher: voucher(),
                reason: 'no_qualifying_item',
            }),
        ).resolves.toBe(
            'Any Large Pizza: Nothing in this cart qualifies for this voucher.',
        );
        expect(
            (svc.dataSource as { query: jest.Mock }).query,
        ).not.toHaveBeenCalled();
    });
});
