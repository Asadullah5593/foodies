import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { resolveOfferSettings } from './offer-settings';

/**
 * A printed voucher on an order: who may apply it, that it stands alone, and
 * that it replaces every other discount rather than stacking with them. Drives
 * the real OrdersService methods on a prototype instance with mocked
 * repositories, like staged-offers.spec.ts.
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

type Internals = {
    assertVoucherStandsAlone: (dto: Any) => void;
    authorizeVoucher: (
        voucherId: number | null | undefined,
        tenantId: number,
        actor: Any | null,
        branchId: number,
        orderBrandId: number | null,
        orderType: string | null,
    ) => Promise<Any | null>;
    resolveStagedOffers: (ctx: Any) => Promise<
        Any & {
            combinedLineDiscount: number[];
            totalDiscount: number;
            voucherDiscountAmount: number;
            voucherMiss: string | null;
            discountAmount: number;
            discountId: number | null;
            lineBreakdown: Array<{ discounts: Array<{ kind: string }> }>;
        }
    >;
    voucherMissText: (voucher: Any, reason: string) => Promise<string>;
};

function service(opts: { found?: Any | null; autoOffers?: Any[] } = {}) {
    const discountFind = jest.fn().mockResolvedValue(opts.autoOffers ?? []);
    const svc = Object.create(OrdersService.prototype) as unknown as Internals &
        Any;
    Object.assign(svc, {
        printedVoucherRepo: {
            findOne: jest
                .fn()
                .mockResolvedValue(
                    opts.found === undefined ? voucher() : opts.found,
                ),
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
            svc.authorizeVoucher(null, 1, cashier, 10, 25, 'dine_in'),
        ).resolves.toBeNull();
    });

    it('needs a signed-in user holding printed-vouchers:apply', async () => {
        const { svc } = service();
        await expect(
            svc.authorizeVoucher(5, 1, null, 10, 25, 'dine_in'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            svc.authorizeVoucher(
                5,
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
            svc.authorizeVoucher(5, 1, cashier, 10, 25, 'dine_in'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(
            (svc.printedVoucherRepo as { findOne: jest.Mock }).findOne,
        ).toHaveBeenCalledWith({ where: { id: 5, tenantId: 1 } });
    });

    it('returns the voucher when it can be used on this order', async () => {
        const { svc } = service();
        await expect(
            svc.authorizeVoucher(5, 1, cashier, 10, 25, 'takeaway'),
        ).resolves.toMatchObject({ id: 5 });
    });

    it.each([
        ['another brand', 23, 'dine_in', /different brand/],
        ['a delivery order', 25, 'delivery', /not valid for delivery/],
    ])('refuses it on %s', async (_label, brandId, orderType, message) => {
        const { svc } = service();
        const err = await svc
            .authorizeVoucher(5, 1, cashier, 10, brandId, orderType)
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toMatch(message);
    });

    it('refuses a voucher that is switched off or past its last day', async () => {
        const off = service({ found: voucher({ isActive: false }) });
        await expect(
            off.svc.authorizeVoucher(5, 1, cashier, 10, 25, 'dine_in'),
        ).rejects.toThrow(/switched off/);
        const expired = service({
            found: voucher({ validUntil: '2020-01-01' }),
        });
        await expect(
            expired.svc.authorizeVoucher(5, 1, cashier, 10, 25, 'dine_in'),
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
                voucher: voucher(),
            }),
        );
        // Pizza 1,949 → 999; the drink stays full price. Without the voucher
        // the 50% offer would have taken 1,099.50 off instead.
        expect(r.combinedLineDiscount).toEqual([950, 0]);
        expect(r.totalDiscount).toBe(950);
        expect(r.voucherDiscountAmount).toBe(950);
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
                voucher: voucher(),
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
                voucher: voucher(),
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
                voucher: voucher(),
            }),
        );
        expect(r.voucherDiscountAmount).toBe(0);
        expect(r.voucherMiss).toBe('no_qualifying_item');
    });

    it('when the cart does not qualify, says why and prices it normally', async () => {
        const { svc, discountFind } = service({ autoOffers: [autoHalfOff] });
        const r = await svc.resolveStagedOffers(
            stagedCtx({
                subtotal: 250,
                lineDetails: [drinkLine],
                voucher: voucher(),
            }),
        );
        expect(r.voucherMiss).toBe('no_qualifying_item');
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
                voucher: meal,
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
                voucher: meal,
            }),
        );
        expect(plain.voucherMiss).toBe('needs_included_option');
    });
});

describe('telling the cashier why a voucher did not apply', () => {
    it('names the voucher and the option a meal voucher needs', async () => {
        const { svc } = service();
        await expect(
            svc.voucherMissText(
                voucher({
                    name: 'Classic Smashed Burger Meal',
                    includedModifierIds: [9001],
                }),
                'needs_included_option',
            ),
        ).resolves.toBe(
            'Classic Smashed Burger Meal: Add "Add Fries & Drink" to the item to use this voucher.',
        );
    });

    it('needs no lookup for the other reasons', async () => {
        const { svc } = service();
        await expect(
            svc.voucherMissText(voucher(), 'no_qualifying_item'),
        ).resolves.toBe(
            'Any Large Pizza: Nothing in this cart qualifies for this voucher.',
        );
        expect(
            (svc.dataSource as { query: jest.Mock }).query,
        ).not.toHaveBeenCalled();
    });
});
