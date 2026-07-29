import {
    staffDiscountToOffer,
    staffDiscountRawAmount,
    staffDiscountWithinCeiling,
    resolveStaffDiscountCeiling,
} from './staff-discount-offer.util';
import { StaffDiscount } from '../entities/staff-discount.entity';
import { runOfferEngine, EngineLine, EngineStage } from './offer-engine';
import { DEFAULT_OFFER_SETTINGS } from './offer-settings';

const preset = (over: Partial<StaffDiscount> = {}): StaffDiscount =>
    ({
        id: 1,
        tenantId: 1,
        name: '10% off',
        discountType: 'percentage',
        value: 10,
        maxDiscountAmount: null,
        eligibilityBrandIds: null,
        eligibilityBranchIds: null,
        sortOrder: 0,
        isActive: true,
        ...over,
    }) as StaffDiscount;

describe('staffDiscountToOffer', () => {
    it('is merchant-funded, so the tenant cap binds it', () => {
        expect(staffDiscountToOffer(preset()).funding).toBe('merchant');
    });

    it('carries none of the offer-only eligibility machinery', () => {
        const o = staffDiscountToOffer(preset());
        expect(o.code).toBeNull();
        expect(o.requiresCode).toBe(false);
        expect(o.validFrom).toBeNull();
        expect(o.validDaysOfWeek).toBeNull();
        expect(o.perCustomerLimit).toBeNull();
        expect(o.audience).toBeNull();
    });

    it('is always whole-order', () => {
        expect(staffDiscountToOffer(preset()).applicationScope).toBe(
            'whole_order',
        );
    });

    it('keeps its own id — callers must not write it to orders.discount_id', () => {
        // The id belongs to staff_discounts, and orders.discount_id is
        // FK-constrained to discounts(id). Same trap as bank card offers.
        expect(staffDiscountToOffer(preset({ id: 42 })).id).toBe(42);
    });
});

describe('staffDiscountRawAmount', () => {
    it('takes a percentage of the discountable base', () => {
        expect(staffDiscountRawAmount(preset({ value: 10 }), 1990)).toBe(199);
    });

    it('honours the rupee cap on a percentage preset', () => {
        expect(
            staffDiscountRawAmount(
                preset({ value: 25, maxDiscountAmount: 300 }),
                4000,
            ),
        ).toBe(300);
    });

    it('never gives more than the bill on a flat preset', () => {
        expect(
            staffDiscountRawAmount(
                preset({ discountType: 'flat', value: 500 }),
                200,
            ),
        ).toBe(200);
    });
});

describe('resolveStaffDiscountCeiling', () => {
    it('takes the most permissive across a user’s roles', () => {
        expect(
            resolveStaffDiscountCeiling([
                { maxStaffDiscountPercent: 10, maxStaffDiscountAmount: 500 },
                { maxStaffDiscountPercent: 25, maxStaffDiscountAmount: 200 },
            ]),
        ).toEqual({ maxPercent: 25, maxAmount: 500 });
    });

    it('treats a null on any role as uncapped', () => {
        expect(
            resolveStaffDiscountCeiling([
                { maxStaffDiscountPercent: 10, maxStaffDiscountAmount: 500 },
                { maxStaffDiscountPercent: null, maxStaffDiscountAmount: 500 },
            ]).maxPercent,
        ).toBeNull();
    });

    it('grants nothing to a user with no roles rather than inheriting uncapped', () => {
        expect(resolveStaffDiscountCeiling([])).toEqual({
            maxPercent: 0,
            maxAmount: 0,
        });
    });
});

describe('staffDiscountWithinCeiling', () => {
    const ceiling = { maxPercent: 10, maxAmount: null };

    it('allows a percentage at the ceiling', () => {
        const p = preset({ value: 10 });
        expect(
            staffDiscountWithinCeiling(
                p,
                ceiling,
                staffDiscountRawAmount(p, 1000),
            ),
        ).toBe(true);
    });

    it('refuses a percentage above the ceiling', () => {
        const p = preset({ value: 25 });
        expect(
            staffDiscountWithinCeiling(
                p,
                ceiling,
                staffDiscountRawAmount(p, 1000),
            ),
        ).toBe(false);
    });

    it('gates a flat preset on rupees, since a percentage ceiling cannot', () => {
        // The only meaningful check on "Rs. 200 off" — maxPercent says nothing
        // about it, so a percent-only ceiling must let it through.
        const p = preset({ discountType: 'flat', value: 200 });
        expect(staffDiscountWithinCeiling(p, ceiling, 200)).toBe(true);
        expect(
            staffDiscountWithinCeiling(
                p,
                { maxPercent: 10, maxAmount: 150 },
                200,
            ),
        ).toBe(false);
    });
});

describe('staff_discount stage in the pricing engine', () => {
    const line = (
        subtotal: number,
        over: Partial<EngineLine> = {},
    ): EngineLine => ({
        itemSubtotal: subtotal,
        lineCost: null,
        isDeal: false,
        isOverridden: false,
        ...over,
    });
    /** A whole-order percentage stage, pro-rated across lines like the real one. */
    const staffStage = (percent: number): EngineStage => ({
        kind: 'staff_discount',
        funding: 'merchant',
        compute: (running) => running.map((r) => (r * percent) / 100),
    });

    it('books its own bucket, separate from the other stages', () => {
        const r = runOfferEngine([line(1000)], [staffStage(10)], {
            ...DEFAULT_OFFER_SETTINGS,
        });
        expect(r.byKind.staff_discount).toBe(100);
        expect(r.byKind.discount).toBe(0);
        expect(r.byKind.coupon).toBe(0);
        expect(r.totalDiscount).toBe(100);
    });

    it('computes on the running amount, so it compounds after an earlier stage', () => {
        const promo: EngineStage = {
            kind: 'product_promotion',
            funding: 'merchant',
            compute: (running) => running.map((r) => r * 0.1),
        };
        const r = runOfferEngine([line(1000)], [promo, staffStage(10)], {
            ...DEFAULT_OFFER_SETTINGS,
        });
        expect(r.byKind.product_promotion).toBe(100);
        // 10% of the remaining 900, not of the original 1000.
        expect(r.byKind.staff_discount).toBe(90);
    });

    it('is clamped by the tenant cap like any merchant-funded stage', () => {
        const promo: EngineStage = {
            kind: 'product_promotion',
            funding: 'merchant',
            compute: (running) => running.map((r) => r * 0.15),
        };
        const r = runOfferEngine([line(1000)], [promo, staffStage(25)], {
            ...DEFAULT_OFFER_SETTINGS,
            maxTotalDiscountPercent: 20,
        });
        expect(r.capApplied).toBe(true);
        // 150 spent by the promo leaves 50 of the 200 cap for the give-away.
        expect(r.byKind.staff_discount).toBe(50);
        expect(r.totalDiscount).toBe(200);
    });

    it('respects the cost floor — a give-away never sells below cost', () => {
        const r = runOfferEngine(
            [line(1000, { lineCost: 950 })],
            [staffStage(25)],
            {
                ...DEFAULT_OFFER_SETTINGS,
            },
        );
        expect(r.byKind.staff_discount).toBe(50);
    });

    it('leaves deal lines alone by default', () => {
        const r = runOfferEngine(
            [line(1000, { isDeal: true }), line(500)],
            [staffStage(10)],
            { ...DEFAULT_OFFER_SETTINGS },
        );
        expect(r.lines[0].totalDiscount).toBe(0);
        expect(r.lines[1].totalDiscount).toBe(50);
    });
});
