/**
 * Leave and holiday arithmetic — pure, no database, no clock reads.
 *
 * Two rules carry the weight here:
 *
 *  - A leave request must not consume entitlement on a day the employee was
 *    never going to work. Charging someone a leave day for their weekly off is
 *    the complaint that arrives first and is hardest to argue with.
 *
 *  - When a request exceeds the balance, the overflow becomes UNPAID rather
 *    than being rejected. The client's policy is that days beyond quota are
 *    unpaid (docs/HRM.md §8) — refusing the request would just move the
 *    argument off-system, where payroll can no longer see it.
 */

export type DayPart = 'full' | 'first_half' | 'second_half';

/** One calendar day of a request, once non-working days are excluded. */
export type LeaveDay = {
    date: string;
    /** 1 for a full day, 0.5 for a half. */
    units: number;
};

function eachDate(from: string, to: string): string[] {
    const out: string[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

/**
 * Expand a request into chargeable days.
 *
 * `isNonWorkingDay` covers weekly offs and public holidays. A half-day part
 * applies only to the first and last date, and only when that date is actually
 * worked — a "second half" on a day that turns out to be a public holiday is
 * silently nothing rather than half a day of entitlement.
 */
export function expandLeaveDays(
    from: string,
    to: string,
    opts: {
        firstDayPart?: DayPart;
        lastDayPart?: DayPart;
        isNonWorkingDay: (date: string) => boolean;
    },
): LeaveDay[] {
    if (to < from) return [];
    const dates = eachDate(from, to).filter((d) => !opts.isNonWorkingDay(d));
    return dates.map((date) => {
        let units = 1;
        if (
            date === from &&
            opts.firstDayPart &&
            opts.firstDayPart !== 'full'
        ) {
            units = 0.5;
        }
        if (date === to && opts.lastDayPart && opts.lastDayPart !== 'full') {
            // A single-date request with both parts set is still half a day,
            // not a quarter — the two flags describe the same day.
            units = 0.5;
        }
        return { date, units };
    });
}

export function totalLeaveUnits(days: LeaveDay[]): number {
    return days.reduce((sum, d) => sum + d.units, 0);
}

/**
 * Split a request across the available balance.
 *
 * Days are consumed in order, so the paid portion is always the START of the
 * request. That matters when a request straddles a month boundary and only the
 * first part is covered — the employee is paid for the days they had left, not
 * for an arbitrary subset.
 */
export function allocateAgainstBalance(
    days: LeaveDay[],
    availableUnits: number,
): {
    paid: LeaveDay[];
    unpaid: LeaveDay[];
    paidUnits: number;
    unpaidUnits: number;
} {
    let remaining = Math.max(0, availableUnits);
    const paid: LeaveDay[] = [];
    const unpaid: LeaveDay[] = [];

    for (const day of days) {
        if (remaining >= day.units) {
            paid.push(day);
            remaining -= day.units;
        } else {
            unpaid.push(day);
        }
    }

    return {
        paid,
        unpaid,
        paidUnits: totalLeaveUnits(paid),
        unpaidUnits: totalLeaveUnits(unpaid),
    };
}

/**
 * Monthly off entitlement remaining, and what it is worth if unused.
 *
 * The client's policy: 4 per month, paid, no carry-forward, and unused offs are
 * ENCASHED at the same daily rate used for deductions (docs/HRM.md §8). An
 * employee who never takes a day off therefore earns four extra days' pay —
 * deliberate, and the reason `encashableDays` is surfaced rather than buried in
 * the payroll run.
 */
export function monthlyOffPosition(input: {
    entitledPerMonth: number;
    takenThisMonth: number;
    encashUnused: boolean;
    dailyRate: number;
}): { remaining: number; encashableDays: number; encashmentAmount: number } {
    const remaining = Math.max(
        0,
        input.entitledPerMonth - input.takenThisMonth,
    );
    const encashableDays = input.encashUnused ? remaining : 0;
    return {
        remaining,
        encashableDays,
        encashmentAmount: Number((encashableDays * input.dailyRate).toFixed(2)),
    };
}

/**
 * Pro-rate the monthly off entitlement for someone who joined or left mid-month.
 *
 * A joiner on the 25th has not earned four offs. Rounded to the nearest half day
 * so the figure stays expressible in the same units as everything else.
 */
export function proratedMonthlyOffs(
    entitledPerMonth: number,
    daysEmployedInMonth: number,
    daysInMonth: number,
): number {
    if (daysInMonth <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, daysEmployedInMonth / daysInMonth));
    return Math.round(entitledPerMonth * ratio * 2) / 2;
}
