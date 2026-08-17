import { cumulativeLateDeduction } from './attendance-rules';

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
};

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
 * A joiner on the 25th is not owed a full month. Proration is by DAYS EMPLOYED,
 * independent of attendance — absence is deducted separately, and doing both
 * from the same figure would charge twice for the same day.
 */
export function proratedBasic(
    basicAmount: number,
    employedDays: number,
    daysInMonth: number,
): number {
    if (daysInMonth <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, employedDays / daysInMonth));
    return round2(basicAmount * ratio);
}

/** Days of pay lost to absence, half days and unpaid leave. */
export function absenceDeductionDays(facts: AttendanceFacts): number {
    return facts.absentDays + facts.halfDays * 0.5 + facts.unpaidLeaveDays;
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
}): {
    items: PayrollLineItem[];
    grossEarnings: number;
    totalDeductions: number;
    netPayable: number;
    dailyRate: number;
} {
    const { facts, salary, period } = input;
    const items: PayrollLineItem[] = [];

    const daily = round2(
        dailyRate(salary.basicAmount, salary.dailyRateBasis, period),
    );

    // --- earnings ---------------------------------------------------------
    const basic = proratedBasic(
        salary.basicAmount,
        period.employedDays,
        period.daysInMonth,
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
        const hourly = hourlyRate(daily, salary.scheduledMinutesPerDay);
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

    const encashableOffs = period.encashUnusedOffs
        ? Math.max(0, period.offsEntitled - period.offsTaken)
        : 0;
    if (encashableOffs > 0) {
        const amount = round2(encashableOffs * daily);
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
                offs_taken: period.offsTaken,
            },
        });
    }

    // --- deductions --------------------------------------------------------
    const absenceDays = absenceDeductionDays(facts);
    if (absenceDays > 0) {
        const amount = round2(absenceDays * daily);
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
            },
        });
    }

    const lateDays = cumulativeLateDeduction(facts.lateCount);
    if (lateDays > 0) {
        const amount = round2(lateDays * daily);
        items.push({
            componentKey: 'late',
            componentName: 'Late arrivals',
            kind: 'deduction',
            quantity: lateDays,
            rate: daily,
            amount,
            calcMeta: {
                late_count: facts.lateCount,
                // 1st free, 2nd costs half a day, 3rd another half; restarts
                // every three lates.
                ladder: '1st free, 2nd ½ day, 3rd full day, restarts every 3',
                days_deducted: lateDays,
            },
        });
    }

    // --- waivers ------------------------------------------------------------
    // A waiver never erases the deduction line above; it offsets it, so the
    // payslip shows what the machine decided AND who forgave it.
    for (const waiver of input.waivers) {
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
