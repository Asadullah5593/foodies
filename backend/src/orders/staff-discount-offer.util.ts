import { Discount } from '../entities/discount.entity';
import { StaffDiscount } from '../entities/staff-discount.entity';

/**
 * Staff discounts are their own module: a preset the cashier grants, rather
 * than an offer the cart earns. The pricing engine still speaks one language
 * (Discount), so a preset is adapted into the shape the `staff_discount` stage
 * already evaluates — no second pricing path, which is what keeps the tenant
 * cap, the cost floor and deal/override exclusion applying to it.
 *
 * The synthetic offer is never persisted. Its `id` is the STAFF DISCOUNT's id,
 * which is why callers must keep it out of anything writing `orders.discount_id`
 * (that column is FK-constrained to discounts(id) and the ids are unrelated).
 * It belongs in `orders.staff_discount_id`.
 *
 * Unlike a real offer this carries no eligibility beyond brand/branch scope:
 * no code, audience, per-customer limit, day-part or channel. Those are offer
 * concepts; discretion is gated by permission and role ceiling instead.
 */
export function staffDiscountToOffer(preset: StaffDiscount): Discount {
    return {
        id: preset.id,
        tenantId: preset.tenantId,
        name: preset.name,
        code: null,
        type: preset.discountType === 'flat' ? 'flat' : 'percentage',
        value: Number(preset.value ?? 0),
        minOrderAmount: null,
        maxDiscountAmount: preset.maxDiscountAmount,
        // Always whole-order — the cashier discounts the bill, not a line.
        applicationScope: 'whole_order',
        applicationScopeIds: null,
        eligibilityBranchIds: preset.eligibilityBranchIds ?? null,
        eligibilityBrandIds: preset.eligibilityBrandIds ?? null,
        requiresCard: false,
        eligibleBankCardIds: null,
        isActive: preset.isActive,
        // Granted by hand at the till, so it is not restricted to a channel;
        // reaching it at all requires staff-discounts:apply on an authed user.
        posOnly: false,
        channels: null,
        allowedRoles: null,
        requiresCode: false,
        validFrom: null,
        validUntil: null,
        validTimeStart: null,
        validTimeEnd: null,
        validDaysOfWeek: null,
        buyQuantity: null,
        getQuantity: null,
        getDiscountPercent: null,
        bogoMatchSameGroup: false,
        offerKind: 'staff_discount',
        audience: null,
        eligibleCustomerIds: null,
        perCustomerLimit: null,
        voucherValidityDays: null,
        globalLimit: null,
        priority: preset.sortOrder ?? 0,
        // Comes out of the merchant's own margin, so it counts toward the cap.
        funding: 'merchant',
    } as unknown as Discount;
}

/**
 * The rupee value a preset would give on a discountable base, before the engine
 * clamps it for the cost floor and the tenant cap. Used to enforce the role's
 * `maxStaffDiscountAmount` ceiling BEFORE pricing, so a cashier is refused for
 * asking too much rather than silently handed a clamped amount.
 */
export function staffDiscountRawAmount(
    preset: StaffDiscount,
    discountableBase: number,
): number {
    const value = Number(preset.value ?? 0);
    const raw =
        preset.discountType === 'flat'
            ? Math.min(value, discountableBase)
            : (discountableBase * value) / 100;
    const capped =
        preset.maxDiscountAmount != null
            ? Math.min(raw, Number(preset.maxDiscountAmount))
            : raw;
    return Math.round((capped + Number.EPSILON) * 100) / 100;
}

export interface StaffDiscountCeiling {
    /** Max configured percentage this user may grant; null = uncapped. */
    maxPercent: number | null;
    /** Max resulting rupees this user may grant; null = uncapped. */
    maxAmount: number | null;
}

/**
 * A user's effective ceiling across all their roles: most permissive wins
 * (null/uncapped beats any number, otherwise the largest), mirroring how
 * roles.order_history_days resolves.
 */
export function resolveStaffDiscountCeiling(
    roles: {
        maxStaffDiscountPercent: unknown;
        maxStaffDiscountAmount: unknown;
    }[],
): StaffDiscountCeiling {
    if (roles.length === 0) return { maxPercent: 0, maxAmount: 0 };
    let maxPercent: number | null = 0;
    let maxAmount: number | null = 0;
    for (const r of roles) {
        if (maxPercent !== null) {
            const v = r.maxStaffDiscountPercent;
            if (v == null) maxPercent = null;
            else maxPercent = Math.max(maxPercent, Number(v));
        }
        if (maxAmount !== null) {
            const v = r.maxStaffDiscountAmount;
            if (v == null) maxAmount = null;
            else maxAmount = Math.max(maxAmount, Number(v));
        }
    }
    return { maxPercent, maxAmount };
}

/**
 * Whether a preset is within a ceiling. Percentage presets are gated on their
 * configured value; every preset is additionally gated on the rupees it would
 * actually produce, which is the only meaningful check for a flat one.
 */
export function staffDiscountWithinCeiling(
    preset: StaffDiscount,
    ceiling: StaffDiscountCeiling,
    rawAmount: number,
): boolean {
    if (
        preset.discountType === 'percentage' &&
        ceiling.maxPercent != null &&
        Number(preset.value ?? 0) > ceiling.maxPercent
    )
        return false;
    if (ceiling.maxAmount != null && rawAmount > ceiling.maxAmount)
        return false;
    return true;
}
