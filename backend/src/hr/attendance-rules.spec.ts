import {
    attributePunch,
    branchLocalDate,
    branchLocalToUtc,
    buildOccurrence,
    computeStatus,
    cumulativeLateDeduction,
    lateLadderDeduction,
    lateMinutes,
    overtimeMinutes,
    ScheduleTemplate,
    tzOffsetMinutes,
} from './attendance-rules';

const KHI = 'Asia/Karachi';

/** The client's agreed policy: 17:00 → 02:00, grace 15 (docs/HRM.md §5.3). */
const nightShift: ScheduleTemplate = {
    startTime: '17:00',
    endTime: '02:00',
    crossesMidnight: true,
    breakMinutes: 0,
    graceMinutes: 15,
    halfDayAfterLateMinutes: 120,
    minMinutesFullDay: 480,
    minMinutesHalfDay: 270,
    overtimeAfterMinutes: 0,
    attributionLeadHours: 6,
    attributionTrailHours: 6,
};

const dayShift: ScheduleTemplate = {
    ...nightShift,
    startTime: '11:00',
    endTime: '20:00',
    crossesMidnight: false,
};

describe('timezone primitives', () => {
    it('resolves Asia/Karachi as UTC+5', () => {
        expect(tzOffsetMinutes(new Date('2026-08-17T12:00:00Z'), KHI)).toBe(
            300,
        );
    });

    it('round-trips local → UTC → local', () => {
        const utc = branchLocalToUtc('2026-08-17', '17:00', KHI);
        expect(utc.toISOString()).toBe('2026-08-17T12:00:00.000Z');
        expect(branchLocalDate(utc, KHI)).toBe('2026-08-17');
    });

    /**
     * The bug this guards: a punch just after local midnight is still the
     * PREVIOUS UTC day. Reading the UTC date directly would file it a day early.
     */
    it('a punch at 01:30 local is 20:30 UTC the previous day, but a local date of the 18th', () => {
        const utc = branchLocalToUtc('2026-08-18', '01:30', KHI);
        expect(utc.toISOString()).toBe('2026-08-17T20:30:00.000Z');
        expect(branchLocalDate(utc, KHI)).toBe('2026-08-18');
    });

    it('handles a DST zone without a hard-coded offset', () => {
        // London: +1 in August, 0 in January. A fixed offset would break one.
        expect(
            tzOffsetMinutes(new Date('2026-08-17T12:00:00Z'), 'Europe/London'),
        ).toBe(60);
        expect(
            tzOffsetMinutes(new Date('2026-01-17T12:00:00Z'), 'Europe/London'),
        ).toBe(0);
    });
});

describe('buildOccurrence', () => {
    it('ends on the next calendar day when the shift crosses midnight', () => {
        const occ = buildOccurrence('2026-08-17', nightShift, KHI);
        expect(occ.workDate).toBe('2026-08-17');
        expect(occ.plannedStartUtc.toISOString()).toBe(
            '2026-08-17T12:00:00.000Z',
        );
        expect(occ.plannedEndUtc.toISOString()).toBe(
            '2026-08-17T21:00:00.000Z',
        );
        expect(occ.scheduledMinutes).toBe(540);
    });

    it('stays within the day for a normal shift', () => {
        const occ = buildOccurrence('2026-08-17', dayShift, KHI);
        expect(occ.scheduledMinutes).toBe(540);
        expect(branchLocalDate(occ.plannedEndUtc, KHI)).toBe('2026-08-17');
    });

    it('subtracts the unpaid break from scheduled minutes', () => {
        const occ = buildOccurrence(
            '2026-08-17',
            { ...dayShift, breakMinutes: 60 },
            KHI,
        );
        expect(occ.scheduledMinutes).toBe(480);
    });

    /**
     * Caught in end-to-end verification, not by these tests: the seeded
     * template had 11:00→23:00 flagged crossesMidnight. The flag is DERIVABLE,
     * and when it disagrees with the times the shift is treated as ending at
     * 23:00 the NEXT day — a 36-hour scheduled day, which silently zeroes
     * overtime and stretches punch attribution across two days.
     *
     * The database now rejects the inconsistency (CHK_wst_crosses_midnight).
     * This pins why it matters.
     */
    it('a mis-flagged crossesMidnight produces an absurd multi-day shift', () => {
        // 11:00 → 20:00 the NEXT day = 33 hours instead of 9.
        const misflagged = buildOccurrence(
            '2026-08-17',
            { ...dayShift, crossesMidnight: true },
            KHI,
        );
        expect(misflagged.scheduledMinutes).toBe(33 * 60);

        const correct = buildOccurrence('2026-08-17', dayShift, KHI);
        expect(correct.scheduledMinutes).toBe(540);
    });

    it('crossesMidnight is exactly "end is earlier than start"', () => {
        const shouldCross = (t: { startTime: string; endTime: string }) =>
            t.endTime < t.startTime;
        expect(shouldCross(nightShift)).toBe(nightShift.crossesMidnight);
        expect(shouldCross(dayShift)).toBe(dayShift.crossesMidnight);
    });
});

/**
 * The table from docs/HRM.md §5.3. These are the cases a naive
 * `work_date = DATE(punched_at)` implementation gets wrong — it splits one
 * night into two attendance days, producing a missing clock-out on Monday and a
 * phantom 2am arrival on Tuesday, both of which cascade into deductions.
 */
describe('attributePunch — the midnight rule', () => {
    const mon = buildOccurrence('2026-08-17', nightShift, KHI);
    const tue = buildOccurrence('2026-08-18', nightShift, KHI);
    const occurrences = [mon, tue];
    const attribute = (localDate: string, localTime: string) =>
        attributePunch(
            branchLocalToUtc(localDate, localTime, KHI),
            occurrences,
            6,
            6,
        );

    it('clock-in shortly before the shift belongs to that shift', () => {
        expect(attribute('2026-08-17', '16:52')?.workDate).toBe('2026-08-17');
    });

    it('clock-out at 02:14 the NEXT morning still belongs to Monday', () => {
        expect(attribute('2026-08-18', '02:14')?.workDate).toBe('2026-08-17');
    });

    it('a punch inside the shift belongs to it', () => {
        expect(attribute('2026-08-17', '21:00')?.workDate).toBe('2026-08-17');
    });

    it('the next evening starts a new work date', () => {
        expect(attribute('2026-08-18', '17:05')?.workDate).toBe('2026-08-18');
    });

    it('a punch far outside every window is an orphan, not the nearest day', () => {
        // 09:30 Tuesday: Monday's trail ended 08:00, Tuesday's lead starts 11:00.
        expect(attribute('2026-08-18', '09:30')).toBeNull();
    });

    it('overlapping windows break to the nearest planned start', () => {
        // 11:30 Tuesday is inside Monday's trail only if trail were longer; with
        // lead 6h it sits in Tuesday's window and Tuesday's start is nearer.
        expect(attribute('2026-08-18', '11:30')?.workDate).toBe('2026-08-18');
    });
});

describe('lateMinutes', () => {
    const start = branchLocalToUtc('2026-08-17', '11:00', KHI);
    const at = (t: string) => branchLocalToUtc('2026-08-17', t, KHI);

    it('is zero inside the grace period', () => {
        expect(lateMinutes(at('11:00'), start, 15)).toBe(0);
        expect(lateMinutes(at('11:15'), start, 15)).toBe(0);
    });

    it('counts only the minutes beyond grace', () => {
        expect(lateMinutes(at('11:20'), start, 15)).toBe(5);
        expect(lateMinutes(at('13:00'), start, 15)).toBe(105);
    });

    it('is zero for an early arrival', () => {
        expect(lateMinutes(at('10:30'), start, 15)).toBe(0);
    });
});

/**
 * docs/HRM.md §7.2.1. Rows 3 and 5 are the ones the severe-late rule exists
 * for: full hours worked, but the day still costs half a day's pay.
 */
describe('computeStatus — severity is not undone by staying later', () => {
    const base = {
        minMinutesFullDay: 480,
        minMinutesHalfDay: 270,
        halfDayAfterLateMinutes: 120,
    };

    it('slightly late, full hours → present', () => {
        expect(
            computeStatus({ ...base, workedMinutes: 535, lateMinutes: 5 }),
        ).toBe('present');
    });

    it('2h late leaving on time → half day on hours', () => {
        expect(
            computeStatus({ ...base, workedMinutes: 420, lateMinutes: 105 }),
        ).toBe('half_day');
    });

    it('2h15 late but stays to make up the hours → still half day', () => {
        expect(
            computeStatus({ ...base, workedMinutes: 540, lateMinutes: 135 }),
        ).toBe('half_day');
    });

    it('5h late leaving on time → absent on hours', () => {
        expect(
            computeStatus({ ...base, workedMinutes: 240, lateMinutes: 285 }),
        ).toBe('absent');
    });

    it('5h late but works a full day → half day, not present', () => {
        expect(
            computeStatus({ ...base, workedMinutes: 540, lateMinutes: 285 }),
        ).toBe('half_day');
    });

    it('the late check can only make a day worse, never better', () => {
        // Badly late AND barely worked: stays absent rather than being upgraded.
        expect(
            computeStatus({ ...base, workedMinutes: 60, lateMinutes: 300 }),
        ).toBe('absent');
    });

    it('disabling the threshold falls back to hours alone', () => {
        expect(
            computeStatus({
                ...base,
                halfDayAfterLateMinutes: null,
                workedMinutes: 540,
                lateMinutes: 285,
            }),
        ).toBe('present');
    });
});

/** docs/HRM.md §7.2 — the agreed ladder, restarting every 3 lates. */
describe('late ladder', () => {
    const expected: Array<[number, number, number]> = [
        // [ordinal, deducted this time, cumulative]
        [1, 0, 0],
        [2, 0.5, 0.5],
        [3, 0.5, 1.0],
        [4, 0, 1.0],
        [5, 0.5, 1.5],
        [6, 0.5, 2.0],
        [7, 0, 2.0],
    ];

    it.each(expected)('late #%i deducts %f (cumulative %f)', (n, inc, cum) => {
        expect(lateLadderDeduction(n)).toBe(inc);
        expect(cumulativeLateDeduction(n)).toBe(cum);
    });

    it('ignores a zero or negative ordinal', () => {
        expect(lateLadderDeduction(0)).toBe(0);
        expect(cumulativeLateDeduction(0)).toBe(0);
    });
});

describe('overtimeMinutes', () => {
    const opts = {
        minMinutesToQualify: 30,
        roundingMinutes: 15,
        dailyCapMinutes: 240,
    };

    it('is zero below the qualifying floor', () => {
        expect(overtimeMinutes(555, 540, opts)).toBe(0);
    });

    it('rounds down to the rounding unit', () => {
        expect(overtimeMinutes(590, 540, opts)).toBe(45);
    });

    it('never exceeds the daily cap', () => {
        expect(overtimeMinutes(1000, 540, opts)).toBe(240);
    });

    it('is zero when the day ran short', () => {
        expect(overtimeMinutes(400, 540, opts)).toBe(0);
    });
});
