/**
 * Attendance decision logic — pure, no database, no clock reads.
 *
 * Everything here works in **branch-local time** while storing UTC instants,
 * because a punch at 01:30 on a shift that started at 17:00 belongs to the
 * PREVIOUS work date. Getting that wrong is the single most likely source of
 * "the system says I was absent" (docs/HRM.md §5).
 *
 * IANA arithmetic via Intl, never a fixed +05:00 offset: Pakistan has no DST
 * today, but a hard-coded offset silently breaks the day someone opens a branch
 * where it exists.
 */

export type ScheduleTemplate = {
    /** 'HH:mm' branch-local. */
    startTime: string;
    /** 'HH:mm' branch-local. */
    endTime: string;
    crossesMidnight: boolean;
    breakMinutes: number;
    graceMinutes: number;
    /** Beyond this, the day is a half day no matter how many hours are worked. */
    halfDayAfterLateMinutes: number | null;
    minMinutesFullDay: number;
    minMinutesHalfDay: number;
    overtimeAfterMinutes: number;
    attributionLeadHours: number;
    attributionTrailHours: number;
};

export type Occurrence = {
    /** Branch-local calendar date the shift STARTS. This is the work_date. */
    workDate: string;
    plannedStartUtc: Date;
    plannedEndUtc: Date;
    scheduledMinutes: number;
};

const MINUTE = 60_000;

/** Offset of `tz` from UTC, in minutes, at this instant (+300 for PKT). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const parts = dtf.formatToParts(instant);
    const get = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value ?? '0');
    // `hour` can format as 24 for midnight under hour12:false in some ICU
    // versions; normalise so the arithmetic below cannot drift a whole day.
    const hour = get('hour') % 24;
    const asIfUtc = Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        hour,
        get('minute'),
        get('second'),
    );
    return Math.round((asIfUtc - instant.getTime()) / MINUTE);
}

/** The branch-local calendar date ('YYYY-MM-DD') of a UTC instant. */
export function branchLocalDate(instant: Date, timeZone: string): string {
    const offset = tzOffsetMinutes(instant, timeZone);
    return new Date(instant.getTime() + offset * MINUTE)
        .toISOString()
        .slice(0, 10);
}

/** Branch-local 'YYYY-MM-DD' + 'HH:mm' → the UTC instant it denotes. */
export function branchLocalToUtc(
    date: string,
    time: string,
    timeZone: string,
): Date {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    // One correction pass is enough for fixed-offset zones and for all but the
    // ambiguous hour of a DST transition, where either answer is defensible.
    const offset = tzOffsetMinutes(new Date(guess), timeZone);
    const corrected = guess - offset * MINUTE;
    const offset2 = tzOffsetMinutes(new Date(corrected), timeZone);
    return new Date(guess - offset2 * MINUTE);
}

function addLocalDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * The scheduled window for one work date.
 *
 * `workDate` is always the date the shift STARTS — a 17:00→02:00 shift on
 * Monday ends on Tuesday but is Monday's occurrence throughout.
 */
export function buildOccurrence(
    workDate: string,
    template: ScheduleTemplate,
    timeZone: string,
): Occurrence {
    const plannedStartUtc = branchLocalToUtc(
        workDate,
        template.startTime,
        timeZone,
    );
    const endDate = template.crossesMidnight
        ? addLocalDays(workDate, 1)
        : workDate;
    const plannedEndUtc = branchLocalToUtc(endDate, template.endTime, timeZone);
    return {
        workDate,
        plannedStartUtc,
        plannedEndUtc,
        scheduledMinutes: Math.max(
            0,
            Math.round(
                (plannedEndUtc.getTime() - plannedStartUtc.getTime()) / MINUTE,
            ) - template.breakMinutes,
        ),
    };
}

/**
 * Which shift does this punch belong to?
 *
 * Each occurrence owns the window `[start − lead, end + trail]`. Overlaps are
 * broken by nearest planned start. A punch matching nothing is an ORPHAN and
 * must be surfaced, never silently dropped or forced onto the nearest day.
 */
export function attributePunch(
    punchUtc: Date,
    occurrences: Occurrence[],
    leadHours: number,
    trailHours: number,
): Occurrence | null {
    const t = punchUtc.getTime();
    const matches = occurrences.filter((o) => {
        const from = o.plannedStartUtc.getTime() - leadHours * 60 * MINUTE;
        const to = o.plannedEndUtc.getTime() + trailHours * 60 * MINUTE;
        return t >= from && t <= to;
    });
    if (matches.length === 0) return null;
    return matches.reduce((best, o) =>
        Math.abs(t - o.plannedStartUtc.getTime()) <
        Math.abs(t - best.plannedStartUtc.getTime())
            ? o
            : best,
    );
}

export type RawPunch = { punchType: string; punchedAt: Date };

/**
 * Pair in/out punches into worked sessions and total them.
 *
 * ⚠️ NOT `lastOut − firstIn`. Someone who clocks out for lunch and back in has
 * two sessions, and spanning the gap pays them for the break. Equally, three
 * in/out pairs across a split shift must add up rather than being flattened.
 *
 * A trailing `in` with no `out` is an OPEN session: reported, never guessed at,
 * because inventing an end time manufactures pay.
 */
export function pairSessions(punches: RawPunch[]): {
    sessions: Array<{ inAt: Date; outAt: Date; minutes: number }>;
    workedMinutes: number;
    firstInAt: Date | null;
    lastOutAt: Date | null;
    openSession: boolean;
    /** An `out` with no preceding `in` — a data problem worth surfacing. */
    strayOut: boolean;
} {
    const ordered = [...punches]
        .filter((p) => p.punchType === 'in' || p.punchType === 'out')
        .sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());

    const sessions: Array<{ inAt: Date; outAt: Date; minutes: number }> = [];
    let openIn: Date | null = null;
    let strayOut = false;

    for (const p of ordered) {
        if (p.punchType === 'in') {
            // A second `in` without an `out` keeps the EARLIER one: the person
            // has been at work since then, and moving the start forward would
            // quietly shorten their day.
            if (openIn == null) openIn = p.punchedAt;
            continue;
        }
        if (openIn == null) {
            strayOut = true;
            continue;
        }
        const minutes = Math.max(
            0,
            Math.round((p.punchedAt.getTime() - openIn.getTime()) / MINUTE),
        );
        sessions.push({ inAt: openIn, outAt: p.punchedAt, minutes });
        openIn = null;
    }

    return {
        sessions,
        workedMinutes: sessions.reduce((sum, s) => sum + s.minutes, 0),
        firstInAt: ordered.find((p) => p.punchType === 'in')?.punchedAt ?? null,
        lastOutAt:
            [...ordered].reverse().find((p) => p.punchType === 'out')
                ?.punchedAt ?? null,
        openSession: openIn != null,
        strayOut,
    };
}

/**
 * Is this punch type allowed given what came before it today?
 *
 * Clocking in twice without clocking out, or out twice in a row, is always a
 * mistake — usually a double tap or someone who forgot they already punched.
 * Several in/out PAIRS in a day are fine and expected (split shifts, breaks).
 */
export function canPunch(
    punchType: string,
    lastPunchType: string | null,
): { allowed: boolean; reason?: string } {
    if (punchType === 'in' && lastPunchType === 'in') {
        return {
            allowed: false,
            reason: 'You are already clocked in — clock out first',
        };
    }
    if (punchType === 'out' && lastPunchType !== 'in') {
        return {
            allowed: false,
            reason:
                lastPunchType === 'out'
                    ? 'You are already clocked out'
                    : 'You have not clocked in yet',
        };
    }
    return { allowed: true };
}

/** Minutes late, counting the grace period as on time. */
export function lateMinutes(
    firstInUtc: Date,
    plannedStartUtc: Date,
    graceMinutes: number,
): number {
    const diff =
        (firstInUtc.getTime() - plannedStartUtc.getTime()) / MINUTE -
        graceMinutes;
    return Math.max(0, Math.round(diff));
}

export type AttendanceStatus =
    | 'present'
    | 'half_day'
    | 'absent'
    | 'leave_paid'
    | 'leave_unpaid'
    | 'weekly_off'
    | 'holiday';

/**
 * Day status (docs/HRM.md §6 step 8).
 *
 * ⚠️ Order matters. The severe-late check runs FIRST and is not overridable by
 * working longer: arriving three hours late and staying three hours later is
 * still a half day, because the cost of lateness is that nobody covered the
 * counter at opening and staying past close does not undo it. The check can
 * only make a day worse — a day that is `absent` on hours worked stays absent.
 */
export function computeStatus(input: {
    workedMinutes: number;
    lateMinutes: number;
    minMinutesFullDay: number;
    minMinutesHalfDay: number;
    halfDayAfterLateMinutes: number | null;
}): AttendanceStatus {
    const byHours: AttendanceStatus =
        input.workedMinutes >= input.minMinutesFullDay
            ? 'present'
            : input.workedMinutes >= input.minMinutesHalfDay
              ? 'half_day'
              : 'absent';

    if (
        input.halfDayAfterLateMinutes != null &&
        input.lateMinutes > input.halfDayAfterLateMinutes
    ) {
        return byHours === 'absent' ? 'absent' : 'half_day';
    }
    return byHours;
}

/**
 * Days deducted for the n-th late of the payroll period (1-based).
 *
 * 1st free, 2nd costs ½ day, 3rd costs another ½ (one full day for three), then
 * the ladder restarts. See the test vectors in attendance-rules.spec.ts.
 */
export function lateLadderDeduction(lateOrdinal: number): number {
    if (lateOrdinal < 1) return 0;
    const position = ((lateOrdinal - 1) % 3) + 1;
    return position === 1 ? 0 : 0.5;
}

/** Cumulative days deducted for `count` lates in one period. */
export function cumulativeLateDeduction(count: number): number {
    let total = 0;
    for (let n = 1; n <= count; n += 1) total += lateLadderDeduction(n);
    return total;
}

/** Overtime beyond the scheduled day, once it clears the qualifying floor. */
export function overtimeMinutes(
    workedMinutes: number,
    scheduledMinutes: number,
    opts: {
        minMinutesToQualify: number;
        roundingMinutes: number;
        dailyCapMinutes: number | null;
    },
): number {
    const raw = workedMinutes - scheduledMinutes;
    if (raw < opts.minMinutesToQualify || raw <= 0) return 0;
    const rounded =
        opts.roundingMinutes > 0
            ? Math.floor(raw / opts.roundingMinutes) * opts.roundingMinutes
            : raw;
    if (opts.dailyCapMinutes != null) {
        return Math.min(rounded, opts.dailyCapMinutes);
    }
    return rounded;
}
