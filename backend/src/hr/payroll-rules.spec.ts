import {
    absenceDeductionDays,
    AdvanceRecovery,
    advanceRecoveryAmount,
    AttendanceFacts,
    computePayrollLines,
    dailyRate,
    hourlyRate,
    PeriodConfig,
    proratedBasic,
    proratedOffEntitlement,
    SalaryConfig,
} from './payroll-rules';

const facts = (over: Partial<AttendanceFacts> = {}): AttendanceFacts => ({
    presentDays: 26,
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    weeklyOffDays: 4,
    holidayDays: 0,
    lateCount: 0,
    approvedOvertimeMinutes: 0,
    deliveredOrders: 0,
    ...over,
});

const salary = (over: Partial<SalaryConfig> = {}): SalaryConfig => ({
    basicAmount: 30000,
    dailyRateBasis: 'fixed_30',
    components: [],
    perDeliveredOrderAmount: 0,
    scheduledMinutesPerDay: 540,
    overtimeRateMultiplier: 1,
    ...over,
});

const period = (over: Partial<PeriodConfig> = {}): PeriodConfig => ({
    daysInMonth: 31,
    employedDays: 31,
    workingDaysInPeriod: 26,
    offsEntitled: 4,
    offsTaken: 4,
    encashUnusedOffs: true,
    ...over,
});

const run = (
    over: {
        facts?: Partial<AttendanceFacts>;
        salary?: Partial<SalaryConfig>;
        period?: Partial<PeriodConfig>;
        waivers?: Parameters<typeof computePayrollLines>[0]['waivers'];
        adjustments?: Parameters<typeof computePayrollLines>[0]['adjustments'];
        advances?: AdvanceRecovery[];
    } = {},
) =>
    computePayrollLines({
        facts: facts(over.facts),
        salary: salary(over.salary),
        period: period(over.period),
        waivers: over.waivers ?? [],
        adjustments: over.adjustments ?? [],
        advances: over.advances ?? [],
    });

const item = (result: ReturnType<typeof computePayrollLines>, key: string) =>
    result.items.find((i) => i.componentKey === key);

describe('dailyRate', () => {
    /**
     * The client's choice, and the most disputed number in any payroll: an
     * absent day must cost the same in February as in July.
     */
    it('fixed_30 ignores the length of the month', () => {
        const feb = dailyRate(30000, 'fixed_30', {
            daysInMonth: 28,
            workingDaysInPeriod: 24,
        });
        const jul = dailyRate(30000, 'fixed_30', {
            daysInMonth: 31,
            workingDaysInPeriod: 27,
        });
        expect(feb).toBe(1000);
        expect(jul).toBe(1000);
    });

    it('days_in_month makes February more expensive', () => {
        expect(
            dailyRate(30000, 'days_in_month', {
                daysInMonth: 28,
                workingDaysInPeriod: 24,
            }),
        ).toBeCloseTo(1071.43, 2);
    });

    it('working_days is the harshest on the employee', () => {
        expect(
            dailyRate(30000, 'working_days', {
                daysInMonth: 30,
                workingDaysInPeriod: 26,
            }),
        ).toBeCloseTo(1153.85, 2);
    });

    it('is zero for a zero salary rather than NaN', () => {
        expect(
            dailyRate(0, 'fixed_30', {
                daysInMonth: 30,
                workingDaysInPeriod: 26,
            }),
        ).toBe(0);
    });
});

describe('hourlyRate', () => {
    it('divides the daily rate by the scheduled hours', () => {
        expect(hourlyRate(1000, 540)).toBeCloseTo(111.11, 2);
    });

    it('is zero rather than Infinity for a zero-length day', () => {
        expect(hourlyRate(1000, 0)).toBe(0);
    });
});

describe('proratedBasic', () => {
    it('pays a full month in full', () => {
        expect(proratedBasic(30000, 31, 31, 1000)).toBe(30000);
    });

    /**
     * Regression: proration must use the SAME daily rate as deductions.
     *
     * Under fixed_30 a day is worth basic/30 = 1000, so 15 days is 15,000. The
     * first implementation divided by days-in-month instead and paid 14,516 for
     * a half-month leaver while charging 1,000 a day elsewhere on the same
     * payslip — a discrepancy the employee spots and nobody can justify.
     */
    it('pays 15 days at the fixed_30 daily rate, not basic × 15/31', () => {
        expect(proratedBasic(30000, 15, 31, 1000)).toBe(15000);
        expect(proratedBasic(30000, 15, 31, 1000)).not.toBeCloseTo(14516.13, 2);
    });

    it('a one-week leaver gets exactly seven days', () => {
        expect(proratedBasic(30000, 7, 31, 1000)).toBe(7000);
    });

    it('a single day gets one day', () => {
        expect(proratedBasic(30000, 1, 31, 1000)).toBe(1000);
    });

    it('is capped at the full basic even in a 31-day month', () => {
        // 31 × 1000 would be 31,000; nobody is paid more than their salary.
        expect(proratedBasic(30000, 31, 31, 1000)).toBe(30000);
        expect(proratedBasic(30000, 40, 30, 1000)).toBe(30000);
    });

    it('honours a different daily-rate basis', () => {
        // days_in_month in a 28-day February: a day is worth basic/28.
        expect(proratedBasic(30000, 14, 28, 30000 / 28)).toBe(15000);
    });

    it('pays nothing for zero days employed', () => {
        expect(proratedBasic(30000, 0, 31, 1000)).toBe(0);
    });
});

describe('proratedOffEntitlement', () => {
    it('gives the full entitlement for a full month', () => {
        expect(proratedOffEntitlement(4, 31, 31)).toBe(4);
    });

    /**
     * Regression: a mid-month leaver was credited all four offs and had the
     * unused ones encashed, paying for time never worked.
     */
    it('halves the entitlement for a half-month leaver', () => {
        expect(proratedOffEntitlement(4, 15, 31)).toBe(2);
    });

    it('gives half a day to a one-week employee', () => {
        expect(proratedOffEntitlement(4, 7, 31)).toBe(1);
    });

    it('never exceeds the monthly entitlement', () => {
        expect(proratedOffEntitlement(4, 40, 31)).toBe(4);
    });
});

describe('absenceDeductionDays', () => {
    it('counts a half day as half', () => {
        expect(absenceDeductionDays(facts({ halfDays: 3 }))).toBe(1.5);
    });

    it('adds absences and unpaid leave', () => {
        expect(
            absenceDeductionDays(
                facts({ absentDays: 2, halfDays: 1, unpaidLeaveDays: 1 }),
            ),
        ).toBe(3.5);
    });

    it('ignores paid leave, weekly offs and holidays', () => {
        expect(
            absenceDeductionDays(
                facts({ paidLeaveDays: 4, weeklyOffDays: 4, holidayDays: 2 }),
            ),
        ).toBe(0);
    });
});

describe('computePayrollLines — a clean month', () => {
    it('pays basic and nothing else', () => {
        const result = run();
        expect(result.grossEarnings).toBe(30000);
        expect(result.totalDeductions).toBe(0);
        expect(result.netPayable).toBe(30000);
    });

    it('adds allowances, flat and percentage', () => {
        const result = run({
            salary: {
                components: [
                    {
                        componentKey: 'fuel',
                        name: 'Fuel allowance',
                        kind: 'earning',
                        calcType: 'flat',
                        amount: 3000,
                    },
                    {
                        componentKey: 'house',
                        name: 'House rent',
                        kind: 'earning',
                        calcType: 'percent_of_basic',
                        amount: 10,
                    },
                ],
            },
        });
        expect(item(result, 'fuel')?.amount).toBe(3000);
        expect(item(result, 'house')?.amount).toBe(3000);
        expect(result.grossEarnings).toBe(36000);
    });
});

describe('computePayrollLines — deductions', () => {
    it('deducts a full day per absence at the daily rate', () => {
        const result = run({ facts: { absentDays: 2 } });
        expect(item(result, 'absence')?.amount).toBe(2000);
        expect(result.netPayable).toBe(28000);
    });

    /** The agreed ladder: 1st free, 2nd ½ day, 3rd another ½. */
    it.each([
        [1, 0],
        [2, 500],
        [3, 1000],
        [4, 1000],
        [6, 2000],
    ])('%i late(s) costs %i', (lateCount, expected) => {
        const result = run({ facts: { lateCount } });
        expect(item(result, 'late')?.amount ?? 0).toBe(expected);
    });

    it('shows the ladder arithmetic on the line', () => {
        const result = run({ facts: { lateCount: 3 } });
        expect(item(result, 'late')?.calcMeta).toMatchObject({
            late_count: 3,
            days_deducted: 1,
        });
    });
});

describe('computePayrollLines — waivers', () => {
    /**
     * A waiver must NOT erase the deduction. Both lines print, so the payslip
     * answers "what did the machine decide" and "who overrode it" separately.
     */
    it('offsets the deduction instead of removing it', () => {
        const result = run({
            facts: { lateCount: 3 },
            waivers: [
                {
                    subject: 'late',
                    reason: 'bike breakdown, receipt verified',
                    approvedByName: 'Ali Raza',
                    amount: null,
                },
            ],
        });
        expect(item(result, 'late')?.amount).toBe(1000);
        expect(item(result, 'late_waiver')?.amount).toBe(1000);
        expect(result.totalDeductions).toBe(0);
        expect(result.netPayable).toBe(30000);
    });

    it('records who forgave it and why', () => {
        const result = run({
            facts: { lateCount: 2 },
            waivers: [
                {
                    subject: 'late',
                    reason: 'traffic closure',
                    approvedByName: 'Sara Khan',
                    amount: null,
                },
            ],
        });
        expect(item(result, 'late_waiver')?.calcMeta).toMatchObject({
            reason: 'traffic closure',
            approved_by: 'Sara Khan',
            original_deduction: 500,
        });
    });

    it('forgives only part when an amount is given', () => {
        const result = run({
            facts: { absentDays: 2 },
            waivers: [
                {
                    subject: 'absence',
                    reason: 'one day was hospital leave',
                    approvedByName: 'HR',
                    amount: 1000,
                },
            ],
        });
        expect(result.totalDeductions).toBe(1000);
    });

    it('cannot forgive more than was charged', () => {
        const result = run({
            facts: { lateCount: 2 },
            waivers: [
                {
                    subject: 'late',
                    reason: 'over-generous',
                    approvedByName: 'HR',
                    amount: 999999,
                },
            ],
        });
        expect(result.totalDeductions).toBe(0);
        // Forgiving beyond the charge must not become a payment.
        expect(result.netPayable).toBe(30000);
    });

    it('ignores a waiver whose deduction does not exist', () => {
        const result = run({
            waivers: [
                {
                    subject: 'late',
                    reason: 'nothing to forgive',
                    approvedByName: 'HR',
                    amount: null,
                },
            ],
        });
        expect(item(result, 'late_waiver')).toBeUndefined();
        expect(result.netPayable).toBe(30000);
    });
});

describe('computePayrollLines — overtime', () => {
    it('pays only approved minutes at the hourly rate', () => {
        const result = run({ facts: { approvedOvertimeMinutes: 120 } });
        // daily 1000 over a 9h day = 111.11/h, 2h = 222.22
        expect(item(result, 'overtime')?.amount).toBeCloseTo(222.22, 1);
    });

    it('applies the multiplier', () => {
        const result = run({
            facts: { approvedOvertimeMinutes: 120 },
            salary: { overtimeRateMultiplier: 2 },
        });
        expect(item(result, 'overtime')?.amount).toBeCloseTo(444.44, 1);
    });

    it('pays nothing when no overtime was approved', () => {
        expect(item(run(), 'overtime')).toBeUndefined();
    });
});

describe('computePayrollLines — off encashment', () => {
    /**
     * Paid, non-carrying AND encashed is deliberate client policy: someone who
     * never takes a day off earns four extra days' pay.
     */
    it('pays every unused off at the same daily rate as deductions', () => {
        const result = run({ period: { offsTaken: 0 } });
        expect(item(result, 'off_encashment')?.amount).toBe(4000);
        expect(result.grossEarnings).toBe(34000);
    });

    it('pays only what is left', () => {
        const result = run({ period: { offsTaken: 3 } });
        expect(item(result, 'off_encashment')?.amount).toBe(1000);
    });

    it('pays nothing when encashment is disabled', () => {
        const result = run({
            period: { offsTaken: 0, encashUnusedOffs: false },
        });
        expect(item(result, 'off_encashment')).toBeUndefined();
    });

    it('never goes negative when more offs were taken than earned', () => {
        const result = run({ period: { offsTaken: 6 } });
        expect(item(result, 'off_encashment')).toBeUndefined();
    });
});

describe('computePayrollLines — riders', () => {
    /** Riders run through the same engine, not a parallel payroll. */
    it('adds basic and per-delivered-order earnings', () => {
        const result = run({
            salary: { basicAmount: 20000, perDeliveredOrderAmount: 60 },
            facts: { deliveredOrders: 180 },
        });
        expect(item(result, 'per_delivered_order')?.amount).toBe(10800);
        expect(result.grossEarnings).toBe(30800);
    });

    it('ignores delivery earnings for non-riders', () => {
        const result = run({ facts: { deliveredOrders: 180 } });
        expect(item(result, 'per_delivered_order')).toBeUndefined();
    });
});

describe('advanceRecoveryAmount', () => {
    const advance = (over: Partial<AdvanceRecovery> = {}): AdvanceRecovery => ({
        advanceId: 1,
        outstandingAmount: 10000,
        installmentAmount: 2500,
        recoverInFull: false,
        ...over,
    });

    it('recovers one instalment in a normal month', () => {
        expect(advanceRecoveryAmount(advance())).toBe(2500);
    });

    /**
     * Never more than what is owed. Over-recovering would turn a settled
     * advance into a debt owed back to the employee.
     */
    it('never recovers more than the outstanding balance', () => {
        expect(
            advanceRecoveryAmount(advance({ outstandingAmount: 1000 })),
        ).toBe(1000);
    });

    /** A leaver's final payslip is the last chance to recover. */
    it('recovers the whole balance for a leaver', () => {
        expect(advanceRecoveryAmount(advance({ recoverInFull: true }))).toBe(
            10000,
        );
    });

    it('recovers nothing on a settled advance', () => {
        expect(advanceRecoveryAmount(advance({ outstandingAmount: 0 }))).toBe(
            0,
        );
        expect(advanceRecoveryAmount(advance({ outstandingAmount: -50 }))).toBe(
            0,
        );
    });
});

describe('computePayrollLines — advance recovery', () => {
    const withAdvance = (over: Partial<AdvanceRecovery> = {}) =>
        run({
            advances: [
                {
                    advanceId: 4,
                    outstandingAmount: 10000,
                    installmentAmount: 2500,
                    recoverInFull: false,
                    ...over,
                },
            ],
        });

    it('deducts the instalment and shows the balance either side', () => {
        const result = withAdvance();
        const line = item(result, 'advance_4');
        expect(line?.amount).toBe(2500);
        expect(line?.calcMeta).toMatchObject({
            outstanding_before: 10000,
            outstanding_after: 7500,
            recovered_in_full: false,
        });
        expect(result.netPayable).toBe(27500);
    });

    it("takes the whole balance on a leaver's final payslip", () => {
        const result = withAdvance({ recoverInFull: true });
        expect(item(result, 'advance_4')?.amount).toBe(10000);
        expect(result.netPayable).toBe(20000);
    });

    /**
     * Recovery must not be waivable from the payslip: forgiving it would write
     * off money the employee actually received. Writing off is a decision on the
     * advance itself.
     */
    it('is not cancelled by a waiver aimed at it', () => {
        const result = run({
            advances: [
                {
                    advanceId: 4,
                    outstandingAmount: 10000,
                    installmentAmount: 2500,
                    recoverInFull: false,
                },
            ],
            waivers: [
                {
                    subject: 'advance_4',
                    reason: 'attempted forgiveness',
                    approvedByName: 'HR',
                    amount: null,
                },
            ],
        });
        // The waiver produces no offsetting line, so the deduction stands.
        expect(item(result, 'advance_4_waiver')).toBeUndefined();
        expect(result.totalDeductions).toBe(2500);
    });

    it('cannot push net pay below zero', () => {
        const result = withAdvance({
            outstandingAmount: 999999,
            recoverInFull: true,
        });
        expect(result.netPayable).toBe(0);
    });
});

describe('computePayrollLines — manual adjustments', () => {
    it('adds a manual deduction with its reason and actor', () => {
        const result = run({
            adjustments: [
                {
                    direction: 'add_deduction',
                    targetComponentKey: null,
                    amount: 500,
                    reason: 'broken crockery',
                    actorName: 'HR Manager',
                },
            ],
        });
        expect(result.totalDeductions).toBe(500);
        expect(result.netPayable).toBe(29500);
        expect(item(result, 'manual_add_deduction')?.calcMeta).toMatchObject({
            reason: 'broken crockery',
            actor: 'HR Manager',
        });
    });

    it('adds a manual payment', () => {
        const result = run({
            adjustments: [
                {
                    direction: 'add_earning',
                    targetComponentKey: null,
                    amount: 2000,
                    reason: 'Eid bonus',
                    actorName: 'Owner',
                },
            ],
        });
        expect(result.netPayable).toBe(32000);
    });
});

describe('computePayrollLines — floors', () => {
    it('never returns a negative net from deductions alone', () => {
        const result = run({
            facts: { absentDays: 40 },
        });
        expect(result.netPayable).toBe(0);
        expect(result.grossEarnings).toBe(30000);
    });

    it('prorates a mid-month joiner and still deducts absence separately', () => {
        // Proration is by days employed; absence is charged on top. Doing both
        // from the same figure would charge twice for one day.
        const result = run({
            period: { daysInMonth: 30, employedDays: 15 },
            facts: { absentDays: 1 },
        });
        expect(item(result, 'basic')?.amount).toBe(15000);
        expect(item(result, 'absence')?.amount).toBe(1000);
        expect(result.netPayable).toBe(14000);
    });
});

/**
 * The case the client asked about directly: hired and fired inside one month.
 * Both figures must be consistent with the daily rate the rest of the payslip
 * uses, or the settlement is indefensible.
 */
describe('computePayrollLines — hired and terminated mid-month', () => {
    const partial = (employedDays: number) =>
        run({
            period: {
                daysInMonth: 31,
                employedDays,
                offsEntitled: 4,
                offsTaken: 0,
                encashUnusedOffs: true,
            },
            facts: { presentDays: employedDays, weeklyOffDays: 0 },
        });

    it('joined 1st, terminated 15th: 15 days basic + 2 earned offs', () => {
        const result = partial(15);
        expect(item(result, 'basic')?.amount).toBe(15000);
        expect(item(result, 'off_encashment')?.amount).toBe(2000);
        expect(result.netPayable).toBe(17000);
    });

    it('terminated after one week: 7 days basic + 1 earned off', () => {
        const result = partial(7);
        expect(item(result, 'basic')?.amount).toBe(7000);
        expect(item(result, 'off_encashment')?.amount).toBe(1000);
        expect(result.netPayable).toBe(8000);
    });

    it('terminated after three days: 3 days basic + half an earned off', () => {
        const result = partial(3);
        expect(item(result, 'basic')?.amount).toBe(3000);
        // 4 × 3/31 = 0.387, rounded to the nearest half day = 0.5.
        expect(item(result, 'off_encashment')?.amount).toBe(500);
        expect(result.netPayable).toBe(3500);
    });

    it('terminated on the first day earns no off at all', () => {
        // 4 × 1/31 = 0.13 → rounds to zero, so nothing is encashed.
        const result = partial(1);
        expect(item(result, 'basic')?.amount).toBe(1000);
        expect(item(result, 'off_encashment')).toBeUndefined();
        expect(result.netPayable).toBe(1000);
    });

    it('marks the encashment line as prorated so the payslip explains itself', () => {
        const result = partial(15);
        expect(item(result, 'off_encashment')?.calcMeta).toMatchObject({
            offs_entitled: 4,
            offs_earned: 2,
            prorated: true,
        });
    });

    it('a leaver who already took their offs gets no encashment', () => {
        const result = run({
            period: {
                daysInMonth: 31,
                employedDays: 15,
                offsEntitled: 4,
                offsTaken: 2,
                encashUnusedOffs: true,
            },
            facts: { presentDays: 13, paidLeaveDays: 2, weeklyOffDays: 0 },
        });
        expect(item(result, 'off_encashment')).toBeUndefined();
        expect(item(result, 'basic')?.amount).toBe(15000);
    });
});
