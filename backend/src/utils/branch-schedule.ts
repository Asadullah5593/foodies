/**
 * Recurring time-of-day + day-of-week scheduling, evaluated in a branch's timezone.
 * Shared by discounts (validTimeStart/End + validDaysOfWeek) and menu items
 * (availableTimeStart/End + availableDaysOfWeek) so lunch deals and time-limited
 * items behave identically wherever they are priced.
 */

export interface RecurringSchedule {
    /** 'HH:mm' (or 'HH:mm:ss') in branch timezone; null = no lower bound. */
    timeStart?: string | null;
    timeEnd?: string | null;
    /** 0=Sun … 6=Sat; null/empty = every day. */
    daysOfWeek?: number[] | null;
}

export interface BranchClock {
    /** Minutes since midnight in the branch timezone. */
    currentMinutes: number;
    /** 0=Sun … 6=Sat in the branch timezone. */
    dayOfWeek: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Current wall-clock minutes + weekday in the given IANA timezone. */
export function getBranchClock(timezone: string | null | undefined, now: Date = new Date()): BranchClock {
    const tz = timezone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        weekday: 'short',
    }).formatToParts(now);
    let hour = 0;
    let minute = 0;
    let dayOfWeek = 0;
    for (const p of parts) {
        if (p.type === 'hour') hour = parseInt(p.value, 10) || 0;
        if (p.type === 'minute') minute = parseInt(p.value, 10) || 0;
        if (p.type === 'weekday') dayOfWeek = Math.max(0, WEEKDAYS.indexOf(p.value));
    }
    // Intl can emit hour "24" at midnight in some locales; normalize to 0.
    if (hour >= 24) hour -= 24;
    return { currentMinutes: hour * 60 + minute, dayOfWeek };
}

const parseTimeToMinutes = (t: string | null | undefined): number | null => {
    if (!t) return null;
    const [h, m] = String(t)
        .trim()
        .split(':')
        .map((x) => parseInt(x, 10) || 0);
    return h * 60 + m;
};

/** True when the schedule has no constraints, or `clock` falls inside the window. */
export function isWithinSchedule(schedule: RecurringSchedule, clock: BranchClock): boolean {
    const hasTime = schedule.timeStart != null || schedule.timeEnd != null;
    const hasDays =
        Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0;
    if (!hasTime && !hasDays) return true;

    if (hasDays && !schedule.daysOfWeek!.includes(clock.dayOfWeek)) return false;

    if (hasTime) {
        const startM = parseTimeToMinutes(schedule.timeStart);
        const endM = parseTimeToMinutes(schedule.timeEnd);
        if (startM != null && clock.currentMinutes < startM) return false;
        if (endM != null && clock.currentMinutes > endM) return false;
    }
    return true;
}
