/**
 * Pure HR decision logic, kept out of the services so it can be tested without
 * a database. Same split as rider-hrm's payroll.utils.ts.
 */

/** ISO date arithmetic without pulling in a date library. */
export function addDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * When a new assignment starts on `effectiveFrom`, the outgoing one is closed
 * the day BEFORE — never on the same day.
 *
 * Closing on the same date would make both rows valid on that date, so any
 * "assignment as at date X" query (payroll, reporting, scoping) would find two
 * and pick one arbitrarily.
 */
export function assignmentCloseDate(effectiveFrom: string): string {
    return addDays(effectiveFrom, -1);
}

/**
 * A promotion has to move up the ladder. Sideways or downward moves are
 * legitimate changes — they just aren't promotions, and mislabelling them
 * corrupts both the timeline and any "time since last promotion" reporting.
 */
export function isValidPromotion(fromLevel: number, toLevel: number): boolean {
    return toLevel > fromLevel;
}

/**
 * Status after an exit is recorded.
 *
 * An exit dated in the future means the person is serving notice and is still
 * at work — marking them `resigned` immediately would stop today's attendance
 * and payroll for someone who is standing behind the counter.
 */
export function exitStatusFor(
    exitType: string,
    lastWorkingDate: string,
    today: string,
): 'notice_period' | 'resigned' | 'terminated' {
    if (lastWorkingDate > today) return 'notice_period';
    return exitType === 'termination' ? 'terminated' : 'resigned';
}

/**
 * Roll an exit's clearance status up from its checklist, so the list screen can
 * never disagree with the checklist behind it.
 *
 * `withheld` wins over everything: one unreturned uniform or unsettled advance
 * is the whole point of the checklist, and must not be averaged away by the
 * other items being done.
 */
export function rollUpClearanceStatus(
    items: Array<{ status: string }>,
): 'pending' | 'in_progress' | 'cleared' | 'withheld' {
    if (items.length === 0) return 'pending';
    if (items.some((i) => i.status === 'withheld')) return 'withheld';
    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return 'cleared';
    if (pending.length === items.length) return 'pending';
    return 'in_progress';
}
