import {
    DEFAULT_DEDUCTION_CONFIG,
    DeductionConfig,
    cumulativeLadderDeduction,
} from './settings-rules';

/**
 * Payroll computation — pure, no database, no clock reads.
 *
 * Every figure a payslip shows is produced here as an explicit line item with
 * its arithmetic attached (`calcMeta`), because the only useful answer to "why
 * is my salary short" is the sum shown back to the person asking.
 *
 * Three rules that are easy to get subtly wrong and are pinned by tests:
 *
 *  - The daily rate is ONE number, used for deductions AND off-encashment, so
 *    an employee can check both halves of their payslip against each other.
 *  - Waivers do not erase a deduction; they add an offsetting line. The
 *    machine's figure and the human's override both stay visible.
 *  - Net pay can never be negative from deductions alone.
 */

export type DailyRateBasis = 'fixed_30' | 'days_in_month' | 'working_days';

export type LineItemKind = 'earning' | 'deduction' | 'waiver' | 'adjustment';

export type PayrollLineItem = {
    componentKey: string;
    componentName: string;
    kind: LineItemKind;
    quantity: number;
    rate: number;
    amount: number;
    calcMeta: Record<string, unknown>;
};

export type AttendanceFacts = {
    presentDays: number;
    halfDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    absentDays: number;
    weeklyOffDays: number;
    holidayDays: number;
    /** Lates in the period; drives the 1st-free / 2nd-half / 3rd-full ladder. */
    lateCount: number;
    approvedOvertimeMinutes: number;
    /** Riders only. */
    deliveredOrders: number;
    /**
     * Days where the employee has clocked in and is still on shift. Neither
     * present nor absent — excluded from both so nobody is deducted a day they
     * are currently working.
     */
    inProgressDays?: number;
    /**
     * Days flagged as left-early / missing a clock-out. Both deduct nothing
     * unless a tenant configures a rule for them, so they are counted here and
     * charged only on request.
     */
    earlyLeaveDays?: number;
    missedPunchDays?: number;
};

/**
 * Recovery amount for one advance this period.
 *
 * Never more than what is still owed — over-recovering would turn a settled
 * advance into a debt owed back to the employee.
 */
export function advanceRecoveryAmount(recovery: AdvanceRecovery): number {
    const owed = Math.max(0, recovery.outstandingAmount);
    if (owed === 0) return 0;
    if (recovery.recoverInFull) return round2(owed);
    return round2(Math.min(owed, Math.max(0, recovery.installmentAmount)));
}

export type SalaryConfig = {
    basicAmount: number;
    dailyRateBasis: DailyRateBasis;
    /** Fixed allowances and recurring deductions from the salary structure. */
    components: Array<{
        componentKey: string;
        name: string;
        kind: 'earning' | 'deduction';
        calcType: 'flat' | 'percent_of_basic';
        amount: number;
    }>;
    /** Per delivered order, riders only. */
    perDeliveredOrderAmount: number;
    /** Scheduled minutes in a normal working day, for the hourly OT rate. */
    scheduledMinutesPerDay: number;
    overtimeRateMultiplier: number;
};

export type PeriodConfig = {
    daysInMonth: number;
    /** Days the employee was actually on the payroll (joiners/leavers). */
    employedDays: number;
    workingDaysInPeriod: number;
    /** Monthly off entitlement, already prorated. */
    offsEntitled: number;
    offsTaken: number;
    encashUnusedOffs: boolean;
};

export type Waiver = {
    subject: string;
    reason: string;
    approvedByName: string | null;
    /** Rupees forgiven; when null the whole matching deduction is forgiven. */
    amount: number | null;
};

/**
 * Recovery of a salary advance.
 *
 * `recoverInFull` is set when the employee is leaving in this period: the last
 * payslip is the last chance to recover, so the whole outstanding balance comes
 * off rather than one instalment.
 */
export type AdvanceRecovery = {
    advanceId: number;
    outstandingAmount: number;
    installmentAmount: number;
    recoverInFull: boolean;
};

export type Adjustment = {
    direction: 'waive' | 'add_deduction' | 'add_earning';
    targetComponentKey: string | null;
    amount: number;
    reason: string;
    actorName: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One daily rate for the whole payslip.
 *
 * `fixed_30` is the default and the client's choice: an absent day costs the
 * same in February as in July. The alternatives exist because the convention
 * varies, not because they are interchangeable — switching changes every
 * deduction figure in the system.
 */
export function dailyRate(
    basicAmount: number,
    basis: DailyRateBasis,
    period: { daysInMonth: number; workingDaysInPeriod: number },
): number {
    if (basicAmount <= 0) return 0;
    if (basis === 'days_in_month') {
        return period.daysInMonth > 0 ? basicAmount / period.daysInMonth : 0;
    }
    if (basis === 'working_days') {
        return period.workingDaysInPeriod > 0
            ? basicAmount / period.workingDaysInPeriod
            : 0;
    }
    return basicAmount / 30;
}

/** Hourly rate derived from the daily rate, for overtime. */
export function hourlyRate(
    daily: number,
    scheduledMinutesPerDay: number,
): number {
    const hours = scheduledMinutesPerDay / 60;
    return hours > 0 ? daily / hours : 0;
}

/**
 * Basic pay, prorated for anyone who joined or left mid-period.
 *
 * ⚠️ Prorated at the SAME daily rate used for deductions, then capped at the
 * full basic — not by `employedDays / daysInMonth`. Those two differ: under the
 * agreed `fixed_30` basis a day is worth basic/30, so 15 days must be 15 × that
 * rate. Dividing by a 31-day month instead paid 14,516 where the rest of the
 * payslip charges 1,000 a day, which is the kind of discrepancy an employee
 * spots immediately and cannot be explained.
 *
 * Proration is by DAYS EMPLOYED and is independent of attendance — absence is
 * deducted separately, and doing both from one figure would charge a mid-month
 * joiner twice for the same day.
 */
export function proratedBasic(
    basicAmount: number,
    employedDays: number,
    daysInMonth: number,
    dailyRateForPeriod: number,
): number {
    if (daysInMonth <= 0 || basicAmount <= 0) return 0;
    if (employedDays >= daysInMonth) return round2(basicAmount);
    const days = Math.max(0, employedDays);
    return round2(Math.min(basicAmount, days * dailyRateForPeriod));
}

/**
 * Monthly off entitlement earned by a partial month.
 *
 * A leaver on the 15th has not earned four offs, and crediting them all four —
 * then encashing the unused ones — pays for time never worked. Rounded to the
 * nearest half day so it stays in the same units as leave itself.
 */
export function proratedOffEntitlement(
    offsPerMonth: number,
    employedDays: number,
    daysInMonth: number,
): number {
    if (daysInMonth <= 0) return 0;
    if (employedDays >= daysInMonth) return offsPerMonth;
    const ratio = Math.min(1, Math.max(0, employedDays / daysInMonth));
    return Math.round(offsPerMonth * ratio * 2) / 2;
}

/** Days of pay lost to absence, half days and unpaid leave. */
export function absenceDeductionDays(
    facts: AttendanceFacts,
    config: DeductionConfig = DEFAULT_DEDUCTION_CONFIG,
): number {
    const days =
        facts.absentDays * config.absentDays +
        facts.halfDays * config.halfDayDays +
        facts.unpaidLeaveDays * config.unpaidLeaveDays;
    // Half-day steps make floating point visible surprisingly fast.
    return Math.round(days * 100) / 100;
}

/**
 * Build the full set of payslip lines.
 *
 * Order matters and mirrors docs/HRM.md §10.2: earnings, then deductions, then
 * waivers, then manual adjustments — so the payslip reads top to bottom as
 * "what was earned, what was taken, what was given back, and who decided".
 */
export function computePayrollLines(input: {
    facts: AttendanceFacts;
    salary: SalaryConfig;
    period: PeriodConfig;
    waivers: Waiver[];
    adjustments: Adjustment[];
    advances?: AdvanceRecovery[];
    /** Resolved from `deduction_rules`; the shipped constants when absent. */
    deduction?: DeductionConfig;
}): {
    items: PayrollLineItem[];
    grossEarnings: number;
    totalDeductions: number;
    netPayable: number;
    dailyRate: number;
} {
    const { facts, salary, period } = input;
    const deduction = input.deduction ?? DEFAULT_DEDUCTION_CONFIG;
    const items: PayrollLineItem[] = [];

    // Full precision for arithmetic; rounded only when displayed or totalled.
    // Rounding the rate first and then multiplying produced 4 × 1666.67 =
    // 6666.68 where the true figure is 6666.67 — a one-paisa drift that is
    // exactly the kind of thing an employee notices and cannot be explained.
    const dailyExact = dailyRate(
        salary.basicAmount,
        salary.dailyRateBasis,
        period,
    );
    const daily = round2(dailyExact);

    // --- earnings ---------------------------------------------------------
    const basic = proratedBasic(
        salary.basicAmount,
        period.employedDays,
        period.daysInMonth,
        dailyExact,
    );
    items.push({
        componentKey: 'basic',
        componentName: 'Basic salary',
        kind: 'earning',
        quantity: period.employedDays,
        rate: daily,
        amount: basic,
        calcMeta: {
            basic_amount: salary.basicAmount,
            employed_days: period.employedDays,
            days_in_month: period.daysInMonth,
            prorated: period.employedDays < period.daysInMonth,
        },
    });

    for (const component of salary.components) {
        const amount =
            component.calcType === 'percent_of_basic'
                ? round2((basic * component.amount) / 100)
                : round2(component.amount);
        if (amount === 0) continue;
        items.push({
            componentKey: component.componentKey,
            componentName: component.name,
            kind: component.kind,
            quantity: 1,
            rate: amount,
            amount,
            calcMeta: {
                calc_type: component.calcType,
                value: component.amount,
            },
        });
    }

    if (facts.approvedOvertimeMinutes > 0) {
        const hourly = hourlyRate(dailyExact, salary.scheduledMinutesPerDay);
        const hours = facts.approvedOvertimeMinutes / 60;
        const amount = round2(hours * hourly * salary.overtimeRateMultiplier);
        items.push({
            componentKey: 'overtime',
            componentName: 'Overtime',
            kind: 'earning',
            quantity: round2(hours),
            rate: round2(hourly * salary.overtimeRateMultiplier),
            amount,
            calcMeta: {
                // Only APPROVED minutes reach here; pending overtime is
                // reported in attendance but never paid.
                approved_minutes: facts.approvedOvertimeMinutes,
                multiplier: salary.overtimeRateMultiplier,
                hourly_rate: round2(hourly),
            },
        });
    }

    // Riders: fixed basic plus a per-delivered-order amount, through the same
    // engine as everyone else rather than a parallel payroll.
    if (salary.perDeliveredOrderAmount > 0 && facts.deliveredOrders > 0) {
        const amount = round2(
            facts.deliveredOrders * salary.perDeliveredOrderAmount,
        );
        items.push({
            componentKey: 'per_delivered_order',
            componentName: 'Delivery earnings',
            kind: 'earning',
            quantity: facts.deliveredOrders,
            rate: salary.perDeliveredOrderAmount,
            amount,
            calcMeta: { delivered_orders: facts.deliveredOrders },
        });
    }

    // Entitlement is prorated first: a mid-month leaver has not earned a full
    // month of offs, and encashing all four would pay for time never worked.
    const offsEarned = proratedOffEntitlement(
        period.offsEntitled,
        period.employedDays,
        period.daysInMonth,
    );
    const encashableOffs = period.encashUnusedOffs
        ? Math.max(0, offsEarned - period.offsTaken)
        : 0;
    if (encashableOffs > 0) {
        const amount = round2(encashableOffs * dailyExact);
        items.push({
            componentKey: 'off_encashment',
            componentName: 'Unused off encashment',
            kind: 'earning',
            quantity: encashableOffs,
            rate: daily,
            amount,
            calcMeta: {
                // Intentional client policy: offs are paid, do not carry
                // forward, AND are encashed if unused.
                offs_entitled: period.offsEntitled,
                offs_earned: offsEarned,
                offs_taken: period.offsTaken,
                prorated: offsEarned < period.offsEntitled,
            },
        });
    }

    // --- deductions --------------------------------------------------------
    const absenceDays = absenceDeductionDays(facts, deduction);
    if (absenceDays > 0) {
        const amount = round2(absenceDays * dailyExact);
        items.push({
            componentKey: 'absence',
            componentName: 'Absence & unpaid leave',
            kind: 'deduction',
            quantity: absenceDays,
            rate: daily,
            amount,
            calcMeta: {
                absent_days: facts.absentDays,
                half_days: facts.halfDays,
                unpaid_leave_days: facts.unpaidLeaveDays,
                days_per_absence: deduction.absentDays,
                days_per_half_day: deduction.halfDayDays,
                days_per_unpaid_leave: deduction.unpaidLeaveDays,
            },
        });
    }

    const lateDays = cumulativeLadderDeduction(
        deduction.lateLadder,
        facts.lateCount,
    );
    if (lateDays > 0) {
        const amount = round2(lateDays * dailyExact);
        items.push({
            componentKey: 'late',
            componentName: 'Late arrivals',
            kind: 'deduction',
            quantity: lateDays,
            rate: daily,
            amount,
            calcMeta: {
                late_count: facts.lateCount,
                // The ladder as configured, so a payslip can be checked against
                // the rule that produced it rather than against a sentence.
                ladder: deduction.lateLadder,
                days_deducted: lateDays,
            },
        });
    }

    // Opt-in deductions. Both are zero unless a tenant wrote a rule, so this
    // block does nothing at all on a default configuration.
    const optIn: Array<{
        key: string;
        name: string;
        count: number;
        perDay: number;
    }> = [
        {
            key: 'early_leave',
            name: 'Early departures',
            count: facts.earlyLeaveDays ?? 0,
            perDay: deduction.earlyLeaveDays,
        },
        {
            key: 'missed_punch',
            name: 'Missing clock-outs',
            count: facts.missedPunchDays ?? 0,
            perDay: deduction.missedPunchDays,
        },
    ];
    for (const rule of optIn) {
        const days = Math.round(rule.count * rule.perDay * 100) / 100;
        if (days <= 0) continue;
        items.push({
            componentKey: rule.key,
            componentName: rule.name,
            kind: 'deduction',
            quantity: days,
            rate: daily,
            amount: round2(days * dailyExact),
            calcMeta: {
                days_flagged: rule.count,
                days_per_occurrence: rule.perDay,
            },
        });
    }

    // Advance recovery sits with the deductions but is deliberately NOT
    // waivable: forgiving it would write off money the employee actually
    // received. Writing off an advance is a separate decision on the advance
    // itself.
    for (const advance of input.advances ?? []) {
        const amount = advanceRecoveryAmount(advance);
        if (amount <= 0) continue;
        items.push({
            componentKey: `advance_${advance.advanceId}`,
            componentName: advance.recoverInFull
                ? 'Advance recovered in full (final settlement)'
                : 'Salary advance instalment',
            kind: 'deduction',
            quantity: 1,
            rate: amount,
            amount,
            calcMeta: {
                advance_id: advance.advanceId,
                outstanding_before: round2(advance.outstandingAmount),
                outstanding_after: round2(
                    Math.max(0, advance.outstandingAmount - amount),
                ),
                recovered_in_full: advance.recoverInFull,
            },
        });
    }

    // --- waivers ------------------------------------------------------------
    // A waiver never erases the deduction line above; it offsets it, so the
    // payslip shows what the machine decided AND who forgave it.
    for (const waiver of input.waivers) {
        // Advance recovery is NOT waivable here. Forgiving it would write off
        // money the employee actually received, bypassing the write-off flow
        // and the audit entry that goes with it.
        if (waiver.subject.startsWith('advance_')) continue;
        const target = items.find(
            (i) => i.kind === 'deduction' && i.componentKey === waiver.subject,
        );
        const forgiven =
            waiver.amount != null
                ? Math.min(waiver.amount, target?.amount ?? waiver.amount)
                : (target?.amount ?? 0);
        if (forgiven <= 0) continue;
        items.push({
            componentKey: `${waiver.subject}_waiver`,
            componentName: `${target?.componentName ?? waiver.subject} waived`,
            kind: 'waiver',
            quantity: 1,
            rate: round2(forgiven),
            amount: round2(forgiven),
            calcMeta: {
                reason: waiver.reason,
                approved_by: waiver.approvedByName,
                original_deduction: target?.amount ?? null,
            },
        });
    }

    // --- manual adjustments --------------------------------------------------
    for (const adj of input.adjustments) {
        const amount = round2(Math.abs(adj.amount));
        if (amount === 0) continue;
        const kind: LineItemKind =
            adj.direction === 'add_deduction' ? 'deduction' : 'adjustment';
        items.push({
            componentKey: adj.targetComponentKey ?? `manual_${adj.direction}`,
            componentName:
                adj.direction === 'add_earning'
                    ? 'Manual addition'
                    : adj.direction === 'add_deduction'
                      ? 'Manual deduction'
                      : 'Manual waiver',
            kind,
            quantity: 1,
            rate: amount,
            amount,
            calcMeta: {
                direction: adj.direction,
                reason: adj.reason,
                actor: adj.actorName,
            },
        });
    }

    // --- totals ---------------------------------------------------------------
    const grossEarnings = round2(
        items
            .filter((i) => i.kind === 'earning')
            .reduce((sum, i) => sum + i.amount, 0),
    );
    const rawDeductions = items
        .filter((i) => i.kind === 'deduction')
        .reduce((sum, i) => sum + i.amount, 0);
    const forgiven = items
        .filter((i) => i.kind === 'waiver')
        .reduce((sum, i) => sum + i.amount, 0);
    const manualCredits = items
        .filter((i) => i.kind === 'adjustment')
        .reduce((sum, i) => sum + i.amount, 0);

    // Deductions net of what was forgiven, floored at zero: forgiving more than
    // was charged must not turn into a payment.
    const totalDeductions = round2(Math.max(0, rawDeductions - forgiven));
    const netPayable = round2(
        Math.max(0, grossEarnings + manualCredits - totalDeductions),
    );

    return {
        items,
        grossEarnings,
        totalDeductions,
        netPayable,
        dailyRate: daily,
    };
}
