import {
    allocateAgainstBalance,
    expandLeaveDays,
    monthlyOffPosition,
    proratedMonthlyOffs,
    totalLeaveUnits,
} from './leave-rules';

const alwaysWorking = () => false;

describe('expandLeaveDays', () => {
    it('counts a plain range inclusively', () => {
        const days = expandLeaveDays('2026-08-17', '2026-08-19', {
            isNonWorkingDay: alwaysWorking,
        });
        expect(days.map((d) => d.date)).toEqual([
            '2026-08-17',
            '2026-08-18',
            '2026-08-19',
        ]);
        expect(totalLeaveUnits(days)).toBe(3);
    });

    /**
     * The complaint that arrives first and is hardest to argue with: being
     * charged a leave day for a day you were never going to work.
     */
    it('does not charge entitlement for weekly offs or public holidays', () => {
        const offDays = new Set(['2026-08-18']);
        const days = expandLeaveDays('2026-08-17', '2026-08-19', {
            isNonWorkingDay: (d) => offDays.has(d),
        });
        expect(days.map((d) => d.date)).toEqual(['2026-08-17', '2026-08-19']);
        expect(totalLeaveUnits(days)).toBe(2);
    });

    it('charges half a day for a half-day start', () => {
        const days = expandLeaveDays('2026-08-17', '2026-08-18', {
            firstDayPart: 'second_half',
            isNonWorkingDay: alwaysWorking,
        });
        expect(totalLeaveUnits(days)).toBe(1.5);
    });

    it('a single half-day request is 0.5, not 0.25', () => {
        // Both parts describe the SAME date here; they must not compound.
        const days = expandLeaveDays('2026-08-17', '2026-08-17', {
            firstDayPart: 'first_half',
            lastDayPart: 'first_half',
            isNonWorkingDay: alwaysWorking,
        });
        expect(totalLeaveUnits(days)).toBe(0.5);
    });

    it('a half-day part on a non-working day costs nothing at all', () => {
        const days = expandLeaveDays('2026-08-17', '2026-08-17', {
            firstDayPart: 'first_half',
            isNonWorkingDay: () => true,
        });
        expect(days).toEqual([]);
        expect(totalLeaveUnits(days)).toBe(0);
    });

    it('rejects an inverted range rather than counting backwards', () => {
        expect(
            expandLeaveDays('2026-08-19', '2026-08-17', {
                isNonWorkingDay: alwaysWorking,
            }),
        ).toEqual([]);
    });

    it('spans a month boundary', () => {
        const days = expandLeaveDays('2026-08-30', '2026-09-02', {
            isNonWorkingDay: alwaysWorking,
        });
        expect(totalLeaveUnits(days)).toBe(4);
    });
});

describe('allocateAgainstBalance', () => {
    const days = expandLeaveDays('2026-08-17', '2026-08-21', {
        isNonWorkingDay: alwaysWorking,
    });

    it('pays everything when the balance covers it', () => {
        const split = allocateAgainstBalance(days, 5);
        expect(split.paidUnits).toBe(5);
        expect(split.unpaidUnits).toBe(0);
    });

    /**
     * Overflow becomes unpaid rather than rejected — days beyond quota are
     * unpaid by policy, and refusing would move the argument off-system where
     * payroll can no longer see it.
     */
    it('spills the excess into unpaid instead of refusing', () => {
        const split = allocateAgainstBalance(days, 2);
        expect(split.paidUnits).toBe(2);
        expect(split.unpaidUnits).toBe(3);
        expect(split.paid.map((d) => d.date)).toEqual([
            '2026-08-17',
            '2026-08-18',
        ]);
    });

    it('pays the START of the request, not an arbitrary subset', () => {
        const split = allocateAgainstBalance(days, 1);
        expect(split.paid.map((d) => d.date)).toEqual(['2026-08-17']);
        expect(split.unpaid[0].date).toBe('2026-08-18');
    });

    it('makes everything unpaid on a zero or negative balance', () => {
        expect(allocateAgainstBalance(days, 0).unpaidUnits).toBe(5);
        expect(allocateAgainstBalance(days, -3).unpaidUnits).toBe(5);
    });

    it('handles half days without floating-point drift', () => {
        const halves = expandLeaveDays('2026-08-17', '2026-08-18', {
            firstDayPart: 'second_half',
            isNonWorkingDay: alwaysWorking,
        });
        const split = allocateAgainstBalance(halves, 0.5);
        expect(split.paidUnits).toBe(0.5);
        expect(split.unpaidUnits).toBe(1);
    });
});

describe('monthlyOffPosition', () => {
    /**
     * Paid, non-carrying AND encashed is intentional client policy: someone who
     * never takes a day off earns four extra days' pay. Pinned so it cannot be
     * "tidied up" later as an apparent bug.
     */
    it('encashes every unused off at the daily rate', () => {
        const pos = monthlyOffPosition({
            entitledPerMonth: 4,
            takenThisMonth: 0,
            encashUnused: true,
            dailyRate: 1666.67,
        });
        expect(pos.remaining).toBe(4);
        expect(pos.encashableDays).toBe(4);
        expect(pos.encashmentAmount).toBe(6666.68);
    });

    it('encashes only what is left', () => {
        const pos = monthlyOffPosition({
            entitledPerMonth: 4,
            takenThisMonth: 3,
            encashUnused: true,
            dailyRate: 1000,
        });
        expect(pos.encashmentAmount).toBe(1000);
    });

    it('never goes negative when more offs were taken than earned', () => {
        const pos = monthlyOffPosition({
            entitledPerMonth: 4,
            takenThisMonth: 6,
            encashUnused: true,
            dailyRate: 1000,
        });
        expect(pos.remaining).toBe(0);
        expect(pos.encashmentAmount).toBe(0);
    });

    it('pays nothing when encashment is switched off', () => {
        const pos = monthlyOffPosition({
            entitledPerMonth: 4,
            takenThisMonth: 1,
            encashUnused: false,
            dailyRate: 1000,
        });
        expect(pos.remaining).toBe(3);
        expect(pos.encashableDays).toBe(0);
        expect(pos.encashmentAmount).toBe(0);
    });
});

describe('proratedMonthlyOffs', () => {
    it('gives a full entitlement for a full month', () => {
        expect(proratedMonthlyOffs(4, 31, 31)).toBe(4);
    });

    it('halves it for someone who joined mid-month', () => {
        expect(proratedMonthlyOffs(4, 15, 30)).toBe(2);
    });

    it('gives almost nothing to a joiner on the 29th', () => {
        expect(proratedMonthlyOffs(4, 2, 30)).toBe(0.5);
    });

    it('never exceeds the entitlement', () => {
        expect(proratedMonthlyOffs(4, 40, 30)).toBe(4);
    });
});
