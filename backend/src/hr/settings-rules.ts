/**
 * Resolution and application of the two configurable rule sets — pure, no
 * database (docs/HRM.md §3.5).
 *
 * Both share one resolution order, the same one `branch_menu_items` uses to
 * override `menu_items`: **designation + branch → branch → designation →
 * tenant default**. Most specific wins; ties break on `priority` then on the
 * newest row, so an edit takes effect without having to delete the old one.
 */

export type ScopedRule = {
    id: number;
    branchId: number | null;
    designationId: number | null;
    priority: number;
    isActive: boolean;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
};

/** How specific a rule is. Higher wins. */
export function specificity(
    rule: Pick<ScopedRule, 'branchId' | 'designationId'>,
): number {
    if (rule.branchId != null && rule.designationId != null) return 3;
    if (rule.branchId != null) return 2;
    if (rule.designationId != null) return 1;
    return 0;
}

function inWindow(rule: ScopedRule, onDate: string): boolean {
    if (rule.effectiveFrom && onDate < rule.effectiveFrom) return false;
    if (rule.effectiveTo && onDate > rule.effectiveTo) return false;
    return true;
}

/**
 * The single rule that applies to a (branch, designation) on a date.
 *
 * A rule scoped to ANOTHER branch or designation is not merely less specific —
 * it does not apply at all, which is why they are filtered out rather than
 * ranked low.
 */
export function resolveRule<T extends ScopedRule>(
    rules: T[],
    scope: {
        branchId?: number | null;
        designationId?: number | null;
        onDate: string;
    },
): T | null {
    const candidates = rules.filter(
        (r) =>
            r.isActive &&
            inWindow(r, scope.onDate) &&
            (r.branchId == null || r.branchId === scope.branchId) &&
            (r.designationId == null ||
                r.designationId === scope.designationId),
    );
    if (candidates.length === 0) return null;

    return candidates.sort(
        (a, b) =>
            specificity(b) - specificity(a) ||
            b.priority - a.priority ||
            b.id - a.id,
    )[0];
}

// ------------------------------------------------------------------ deductions

export type DeductionRuleInput = ScopedRule & {
    trigger: string;
    condition: Record<string, unknown>;
    effectType: string;
    effectValue: number;
};

/**
 * What the payroll engine actually needs, after resolution.
 *
 * The defaults here ARE the behaviour the module shipped with (docs/HRM.md
 * §7.2): 1st late free, 2nd half a day, 3rd another half, restarting every
 * three. A tenant with no rules is therefore identical to one seeded with the
 * defaults — the table makes the numbers visible and editable, it does not make
 * them exist.
 */
export type DeductionConfig = {
    /** Days deducted at each ladder position; repeats from the start. */
    lateLadder: number[];
    /** Days deducted per absent day. */
    absentDays: number;
    /** Days deducted per half day. */
    halfDayDays: number;
    /** Days deducted per unpaid-leave day. */
    unpaidLeaveDays: number;
    /** Days deducted per day flagged as leaving early, if configured. */
    earlyLeaveDays: number;
    /** Days deducted per day with a missing clock-out, if configured. */
    missedPunchDays: number;
};

export const DEFAULT_DEDUCTION_CONFIG: DeductionConfig = {
    lateLadder: [0, 0.5, 0.5],
    absentDays: 1,
    halfDayDays: 0.5,
    unpaidLeaveDays: 1,
    // No rule ships for these two: they are opt-in, and defaulting them to a
    // deduction would start charging people the day the table appeared.
    earlyLeaveDays: 0,
    missedPunchDays: 0,
};

const asNumber = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Turn the matching rows into the engine's config.
 *
 * Effects other than `deduct_days` are ignored HERE and applied per-item by the
 * payroll engine, which is the only place that knows the daily rate. Anything
 * unrecognised leaves the default in place rather than zeroing it: a typo in a
 * rule must not silently stop deducting for absence.
 */
export function deductionConfigFrom(
    rules: DeductionRuleInput[],
    scope: {
        branchId?: number | null;
        designationId?: number | null;
        onDate: string;
    },
): DeductionConfig {
    const config: DeductionConfig = { ...DEFAULT_DEDUCTION_CONFIG };

    const pick = (trigger: string) =>
        resolveRule(
            rules.filter((r) => r.trigger === trigger),
            scope,
        );

    const late = pick('late');
    if (late) {
        const ladder = late.condition?.ladder;
        if (Array.isArray(ladder) && ladder.length > 0) {
            const parsed = ladder.map((v) => asNumber(v, 0));
            // An all-zero ladder is legitimate ("stop deducting for lateness"),
            // but a ladder of non-numbers is a mistake, not a policy.
            config.lateLadder = parsed;
        }
    }

    const days = (trigger: string, fallback: number) => {
        const rule = pick(trigger);
        if (!rule || rule.effectType !== 'deduct_days') return fallback;
        return asNumber(rule.effectValue, fallback);
    };

    config.absentDays = days('absent', config.absentDays);
    config.halfDayDays = days('half_day', config.halfDayDays);
    config.unpaidLeaveDays = days('unapproved_leave', config.unpaidLeaveDays);
    config.earlyLeaveDays = days('early_leave', config.earlyLeaveDays);
    config.missedPunchDays = days('missed_punch', config.missedPunchDays);

    return config;
}

/** Days deducted for the n-th late of the period, walking the ladder. */
export function ladderDeduction(ladder: number[], lateOrdinal: number): number {
    if (ladder.length === 0 || lateOrdinal < 1) return 0;
    return ladder[(lateOrdinal - 1) % ladder.length] ?? 0;
}

/** Total days deducted for `count` lates in one period. */
export function cumulativeLadderDeduction(
    ladder: number[],
    count: number,
): number {
    let total = 0;
    for (let n = 1; n <= count; n += 1) total += ladderDeduction(ladder, n);
    // Half-day steps make floating point visible surprisingly fast.
    return Math.round(total * 100) / 100;
}

// -------------------------------------------------------------------- approvals

export type ApprovalRuleInput = ScopedRule & {
    subject: string;
    condition: Record<string, unknown>;
    requiredPermission: string;
    escalateToPermission: string | null;
};

export type ApprovalContext = {
    /** Money involved — a waiver amount, an adjustment, a payroll net total. */
    amount?: number;
    /** Days involved — the length of a leave request. */
    days?: number;
    /** Minutes involved — overtime being approved. */
    minutes?: number;
};

/**
 * Does this decision need a permission beyond the endpoint's own gate?
 *
 * Every threshold in the condition must hold, so `{}` matches everything and
 * `{ amountGt: 2000, daysGt: 3 }` matches only a decision that is both. Returns
 * null when nothing applies — which, with an empty table, is always, and is why
 * introducing this cannot change who can approve what until somebody writes a
 * rule.
 */
export function requiredApproval(
    rules: ApprovalRuleInput[],
    subject: string,
    scope: { branchId?: number | null; onDate: string },
    context: ApprovalContext,
): ApprovalRuleInput | null {
    const matching = rules.filter((r) => {
        if (r.subject !== subject) return false;
        const c = r.condition ?? {};
        if (
            c.amountGt != null &&
            !((context.amount ?? 0) > asNumber(c.amountGt, Infinity))
        ) {
            return false;
        }
        if (
            c.daysGt != null &&
            !((context.days ?? 0) > asNumber(c.daysGt, Infinity))
        ) {
            return false;
        }
        if (
            c.minutesGt != null &&
            !((context.minutes ?? 0) > asNumber(c.minutesGt, Infinity))
        ) {
            return false;
        }
        return true;
    });

    return resolveRule(matching, {
        branchId: scope.branchId,
        designationId: null,
        onDate: scope.onDate,
    });
}
