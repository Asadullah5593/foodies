import { orderTypeToOfferOrderType } from '../discounts/offer-validity.util';

/**
 * Pure rules for printed vouchers (the paper coupon book) — kept free of the
 * database and of Nest so every rule is unit-tested on its own.
 *
 * A voucher is the ONLY discount on its order: the caller runs it as a single
 * `voucher` stage and switches every other stage off. Two types:
 *
 *  - `fixed_price`: ONE qualifying item is charged at the voucher's price. The
 *    price covers the item itself (base + size) and, for a meal voucher, the
 *    options listed in `includedModifierIds`; every other extra is charged on
 *    top. With several qualifying items the customer gets the best one — the
 *    line where the voucher takes the most off.
 *  - `percentage`: N% off every qualifying line, extras included, exactly as
 *    an automatic discount treats a line.
 */

export type VoucherType = 'fixed_price' | 'percentage';

/** The voucher fields the rules read; `PrintedVoucher` satisfies it. */
export interface VoucherRules {
    brandId: number;
    voucherType: VoucherType;
    value: number | string;
    maxDiscountAmount?: number | string | null;
    categoryIds?: number[] | null;
    productIds?: number[] | null;
    includedModifierIds?: number[] | null;
    eligibilityBranchIds?: number[] | null;
    orderTypes?: string[] | null;
    validFrom?: string | null;
    validUntil?: string | null;
    isActive: boolean;
}

export interface VoucherLineModifier {
    modifierId: number;
    /** Units selected, and how many of them the group gave free. */
    quantity: number;
    freeQuantity: number;
    /** What the line was charged for this option in total. */
    charge: number;
}

export interface VoucherLine {
    menuItemId: number;
    categoryId: number;
    /** Price of ONE unit before extras (base + size). */
    unitPrice?: number;
    quantity?: number;
    /** Line total: unit price x quantity + add-ons + modifiers. */
    itemSubtotal: number;
    /** Every modifier option selected on the line, free ones included. */
    modifierCharges?: VoucherLineModifier[];
}

/** Why a voucher cannot be used on this order at all. */
export type VoucherIneligible =
    | 'inactive'
    | 'wrong_brand'
    | 'wrong_branch'
    | 'wrong_order_type'
    | 'not_started'
    | 'expired';

/** Why eligible vouchers take nothing off this particular cart. */
export type VoucherMiss =
    | 'no_qualifying_item'
    | 'needs_included_option'
    | 'no_saving'
    /** More papers of one voucher than items left for it. */
    | 'not_enough_items'
    /** A percentage voucher handed over with another voucher. */
    | 'cannot_combine';

/** A voucher and how many of it the customer handed over. */
export interface VoucherRequest<V extends VoucherRules = VoucherRules> {
    voucher: V;
    quantity: number;
}

/** What one voucher took off: in total, per line, and how many papers it was. */
export interface VoucherShare<V extends VoucherRules = VoucherRules> {
    voucher: V;
    quantity: number;
    amount: number;
    alloc: number[];
}

/** The voucher that stops the whole set from applying, and why. */
export interface VoucherProblem<V extends VoucherRules = VoucherRules> {
    voucher: V;
    reason: VoucherMiss;
    /** not_enough_items: papers handed over, and how many found an item. */
    requested?: number;
    qualifying?: number;
}

export type VouchersEvaluation<V extends VoucherRules = VoucherRules> =
    | {
          applies: true;
          alloc: number[];
          amount: number;
          shares: VoucherShare<V>[];
      }
    | { applies: false; problem: VoucherProblem<V> };

const round2 = (n: number): number =>
    Math.round((n + Number.EPSILON) * 100) / 100;

const ids = (list: number[] | null | undefined): number[] =>
    Array.isArray(list) ? list.map(Number).filter(Number.isFinite) : [];

/**
 * Today's date ('YYYY-MM-DD') on the wall clock of a branch. Voucher dates are
 * whole days in the branch's own timezone, so "valid until 30/11" stays valid
 * until that branch's midnight — not until midnight UTC, five hours early.
 */
export function branchLocalDate(
    timezone: string | null | undefined,
    now: Date = new Date(),
): string {
    // en-CA formats a date as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

/**
 * Whether the voucher can be used on an order of this brand, at this branch,
 * of this order type, today. Null = usable. Says nothing about the cart.
 */
export function voucherIneligibleReason(
    voucher: VoucherRules,
    order: {
        brandId: number | null;
        branchId: number;
        orderType: string | null | undefined;
        /** Branch-local 'YYYY-MM-DD' — see branchLocalDate. */
        today: string;
    },
): VoucherIneligible | null {
    if (!voucher.isActive) return 'inactive';
    // A voucher belongs to one brand and an order to one brand; a mixed cart
    // (no single brand) can never carry one.
    if (order.brandId == null || Number(voucher.brandId) !== order.brandId)
        return 'wrong_brand';
    const branches = ids(voucher.eligibilityBranchIds);
    if (branches.length > 0 && !branches.includes(Number(order.branchId)))
        return 'wrong_branch';
    const types = Array.isArray(voucher.orderTypes) ? voucher.orderTypes : [];
    if (types.length > 0) {
        const type = orderTypeToOfferOrderType(order.orderType);
        if (type == null || !types.includes(type)) return 'wrong_order_type';
    }
    // Plain string comparison: both sides are zero-padded ISO dates.
    if (voucher.validFrom && order.today < voucher.validFrom)
        return 'not_started';
    if (voucher.validUntil && order.today > voucher.validUntil)
        return 'expired';
    return null;
}

/** A line qualifies by its category OR by the item itself; no scope = whole menu. */
function inScope(voucher: VoucherRules, line: VoucherLine): boolean {
    const categories = ids(voucher.categoryIds);
    const products = ids(voucher.productIds);
    if (categories.length === 0 && products.length === 0) return true;
    return (
        categories.includes(Number(line.categoryId)) ||
        products.includes(Number(line.menuItemId))
    );
}

/** What ONE unit of a selected option cost on its line (0 when it was free). */
function chargePerUnit(m: VoucherLineModifier): number {
    const charged = (Number(m.quantity) || 0) - (Number(m.freeQuantity) || 0);
    if (charged <= 0) return 0;
    return (Number(m.charge) || 0) / charged;
}

/** A percentage voucher: N% off every qualifying line, pro rata. */
function percentageShare(
    voucher: VoucherRules,
    lines: VoucherLine[],
    excluded: boolean[],
    running: number[],
): { alloc: number[]; amount: number } | { reason: VoucherMiss } {
    const value = Number(voucher.value) || 0;
    const alloc = new Array<number>(lines.length).fill(0);
    const candidates = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line, i }) => !excluded[i] && inScope(voucher, line));
    if (candidates.length === 0) return { reason: 'no_qualifying_item' };
    const base = candidates.reduce((s, { i }) => s + (running[i] || 0), 0);
    if (base <= 0) return { reason: 'no_qualifying_item' };
    let amount = (base * value) / 100;
    if (voucher.maxDiscountAmount != null)
        amount = Math.min(amount, Number(voucher.maxDiscountAmount));
    amount = round2(amount);
    if (amount <= 0) return { reason: 'no_saving' };
    // Pro-rata across the qualifying lines; the last one takes the rounding
    // remainder so the parts sum to the whole exactly.
    let allocated = 0;
    for (const { i } of candidates) {
        alloc[i] = round2(amount * ((running[i] || 0) / base));
        allocated += alloc[i];
    }
    const last = candidates[candidates.length - 1].i;
    alloc[last] = round2(alloc[last] + (amount - allocated));
    return { alloc, amount };
}

/**
 * Work out what the vouchers the customer handed over take off each line.
 *
 * A percentage voucher stands alone: with any other paper it is refused. Fixed
 * prices combine: every paper prices ONE unit — the unit left in the cart on
 * which it saves most — and a unit never carries two papers, so three pizza
 * vouchers price three pizzas and the dearest ones first. The papers are
 * placed in the order given; a paper that finds no unit stops the whole set,
 * with the voucher and the reason, so the cashier can fix the cart or hand a
 * paper back.
 *
 * `excluded[i]` marks lines no offer may touch (deal components, price
 * overrides); `running[i]` is the line's current amount — its full subtotal,
 * since vouchers run alone. `requests` must not be empty.
 */
export function evaluateVouchers<V extends VoucherRules>(
    requests: VoucherRequest<V>[],
    lines: VoucherLine[],
    excluded: boolean[],
    running: number[],
): VouchersEvaluation<V> {
    const n = lines.length;
    const papers = requests.reduce(
        (s, r) => s + Math.max(1, Math.floor(Number(r.quantity) || 1)),
        0,
    );
    const percentage = requests.find(
        (r) => r.voucher.voucherType === 'percentage',
    );
    if (percentage) {
        if (papers > 1) {
            return {
                applies: false,
                problem: {
                    voucher: percentage.voucher,
                    reason: 'cannot_combine',
                },
            };
        }
        const share = percentageShare(
            percentage.voucher,
            lines,
            excluded,
            running,
        );
        if ('reason' in share) {
            return {
                applies: false,
                problem: { voucher: percentage.voucher, reason: share.reason },
            };
        }
        return {
            applies: true,
            alloc: share.alloc,
            amount: share.amount,
            shares: [
                {
                    voucher: percentage.voucher,
                    quantity: 1,
                    amount: share.amount,
                    alloc: share.alloc,
                },
            ],
        };
    }

    const usedUnits = new Array<number>(n).fill(0);
    const left = running.map((x) => x || 0);
    const alloc = new Array<number>(n).fill(0);
    const shares: VoucherShare<V>[] = [];
    let amount = 0;
    for (const request of requests) {
        const voucher = request.voucher;
        const quantity = Math.max(1, Math.floor(Number(request.quantity) || 1));
        const value = Number(voucher.value) || 0;
        const included = ids(voucher.includedModifierIds);
        const share: VoucherShare<V> = {
            voucher,
            quantity,
            amount: 0,
            alloc: new Array<number>(n).fill(0),
        };
        for (let paper = 0; paper < quantity; paper++) {
            let inScopeSeen = false;
            let freeUnitSeen = false;
            let optionSeen = included.length === 0;
            let bestIndex = -1;
            let bestSaving = 0;
            for (let i = 0; i < n; i++) {
                const line = lines[i];
                if (excluded[i] || !inScope(voucher, line)) continue;
                inScopeSeen = true;
                const units = Math.max(
                    1,
                    Math.floor(Number(line.quantity) || 1),
                );
                if (usedUnits[i] >= units) continue;
                freeUnitSeen = true;
                let covered =
                    line.unitPrice != null
                        ? Number(line.unitPrice)
                        : Number(line.itemSubtotal) / units;
                if (included.length > 0) {
                    const chosen = (line.modifierCharges ?? []).filter((m) =>
                        included.includes(Number(m.modifierId)),
                    );
                    // A meal voucher is for the meal: the item on its own does not qualify.
                    if (chosen.length === 0) continue;
                    optionSeen = true;
                    covered += chosen.reduce((s, m) => s + chargePerUnit(m), 0);
                }
                // Never more than the line still holds, and never a price rise.
                const saving = round2(Math.min(covered - value, left[i]));
                if (saving > bestSaving) {
                    bestSaving = saving;
                    bestIndex = i;
                }
            }
            if (bestIndex < 0) {
                const reason: VoucherMiss =
                    paper > 0 || (inScopeSeen && !freeUnitSeen)
                        ? 'not_enough_items'
                        : !inScopeSeen
                          ? 'no_qualifying_item'
                          : !optionSeen
                            ? 'needs_included_option'
                            : 'no_saving';
                return {
                    applies: false,
                    problem:
                        reason === 'not_enough_items'
                            ? {
                                  voucher,
                                  reason,
                                  requested: quantity,
                                  qualifying: paper,
                              }
                            : { voucher, reason },
                };
            }
            usedUnits[bestIndex] += 1;
            left[bestIndex] = round2(left[bestIndex] - bestSaving);
            alloc[bestIndex] = round2(alloc[bestIndex] + bestSaving);
            share.alloc[bestIndex] = round2(
                share.alloc[bestIndex] + bestSaving,
            );
            share.amount = round2(share.amount + bestSaving);
            amount = round2(amount + bestSaving);
        }
        shares.push(share);
    }
    return { applies: true, alloc, amount, shares };
}

/**
 * One line naming the vouchers an order used, for receipts and lists:
 * "Any Large Pizza ×3", "Classic Smashed Burger Meal, Full Peri Peri Chicken".
 */
export function voucherSummary(
    parts: Array<{ name: string; quantity: number }>,
): string {
    return parts
        .map((v) =>
            Number(v.quantity) > 1
                ? `${v.name} ×${Number(v.quantity)}`
                : v.name,
        )
        .join(', ');
}

const ORDER_TYPE_WORDS: Record<string, string> = {
    delivery: 'delivery',
    pickup: 'takeaway',
    dine_in: 'dine-in',
};

/** "30 Nov 2026" from 'YYYY-MM-DD', for the cashier-facing messages. */
function prettyDate(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
    ];
    return `${d} ${months[(m || 1) - 1]} ${y}`;
}

/** What the cashier is told when a voucher cannot be used on this order. */
export function voucherIneligibleMessage(
    reason: VoucherIneligible,
    voucher: Pick<VoucherRules, 'validFrom' | 'validUntil'>,
    orderType?: string | null,
): string {
    switch (reason) {
        case 'inactive':
            return 'This voucher is switched off.';
        case 'wrong_brand':
            return 'This voucher belongs to a different brand.';
        case 'wrong_branch':
            return 'This voucher cannot be used at this branch.';
        case 'wrong_order_type': {
            const type = orderTypeToOfferOrderType(orderType);
            return type
                ? `This voucher is not valid for ${ORDER_TYPE_WORDS[type]} orders.`
                : 'This voucher is not valid for this order type.';
        }
        case 'not_started':
            return `This voucher is not valid until ${prettyDate(voucher.validFrom ?? '')}.`;
        case 'expired':
            return `This voucher expired on ${prettyDate(voucher.validUntil ?? '')}.`;
    }
}

/** What the cashier is told when the vouchers take nothing off this cart. */
export function voucherMissMessage(
    problem: Pick<VoucherProblem, 'reason' | 'requested' | 'qualifying'>,
    /** Names of the options a meal voucher covers, when known. */
    includedOptionNames: string[] = [],
): string {
    switch (problem.reason) {
        case 'no_qualifying_item':
            return 'Nothing in this cart qualifies for this voucher.';
        case 'needs_included_option': {
            const names = includedOptionNames.filter(Boolean);
            return names.length > 0
                ? `Add "${names.join('" or "')}" to the item to use this voucher.`
                : 'The item must be ordered with the option this voucher covers.';
        }
        case 'no_saving':
            return 'The item already costs no more than the voucher price.';
        case 'not_enough_items': {
            const found = problem.qualifying ?? 0;
            const papers = problem.requested ?? 0;
            if (found === 0)
                return 'Every item this voucher covers already has a voucher on it.';
            return `Only ${found} item${found === 1 ? '' : 's'} in the cart ${
                found === 1 ? 'qualifies' : 'qualify'
            }, but ${papers} vouchers were applied. Remove one or add the item.`;
        }
        case 'cannot_combine':
            return 'A percentage voucher cannot be combined with other vouchers.';
    }
}
