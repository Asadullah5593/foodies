import {
    hasEnded,
    hasPickedDate,
    hasStarted,
    isPickedDate,
    isWithinValidity,
    localDate,
    validityTimezone,
} from './validity-window';

const KARACHI = 'Asia/Karachi'; // UTC+5, no daylight saving
const NEW_YORK = 'America/New_York'; // UTC-4 in October, UTC-5 in November

/** What the admin forms save for a picked date. */
const picked = (day: string) => new Date(day);
/** A wall-clock time in Pakistan, as the moment it is. */
const pkt = (local: string) => new Date(`${local}+05:00`);

describe('localDate', () => {
    it('reads the calendar date on the given clock, not on UTC', () => {
        expect(localDate(KARACHI, new Date('2026-11-30T18:59:59Z'))).toBe(
            '2026-11-30',
        );
        expect(localDate(KARACHI, new Date('2026-11-30T19:00:00Z'))).toBe(
            '2026-12-01',
        );
        expect(localDate(NEW_YORK, new Date('2026-12-01T04:59:59Z'))).toBe(
            '2026-11-30',
        );
    });

    it('falls back to UTC when no timezone is known', () => {
        const at = new Date('2026-11-30T23:30:00Z');
        expect(localDate(null, at)).toBe('2026-11-30');
        expect(localDate(undefined, at)).toBe('2026-11-30');
        expect(localDate('', at)).toBe('2026-11-30');
    });
});

describe('isPickedDate', () => {
    it('recognises what a date-only input is saved as', () => {
        expect(isPickedDate(picked('2026-11-30'))).toBe(true);
    });

    it('leaves a value with a time of day as a real moment', () => {
        expect(isPickedDate(new Date('2026-11-30T09:23:11.123Z'))).toBe(false);
        expect(isPickedDate(new Date('2026-11-30T00:00:00.001Z'))).toBe(false);
    });

    it('is false for no value', () => {
        expect(isPickedDate(null)).toBe(false);
        expect(isPickedDate(undefined)).toBe(false);
    });

    it('hasPickedDate looks at both ends', () => {
        expect(hasPickedDate({})).toBe(false);
        expect(hasPickedDate({ validFrom: null, validUntil: null })).toBe(
            false,
        );
        expect(hasPickedDate({ validFrom: picked('2026-10-01') })).toBe(true);
        expect(hasPickedDate({ validUntil: picked('2026-11-30') })).toBe(true);
        expect(
            hasPickedDate({ validUntil: new Date('2026-11-30T09:23:11Z') }),
        ).toBe(false);
    });
});

describe('"Valid until" picked in the admin form', () => {
    const offer = { validUntil: picked('2026-11-30') };
    const live = (local: string) =>
        isWithinValidity(offer, KARACHI, pkt(local));

    it('covers the whole last day on the branch clock', () => {
        // The stored value is 05:00 in Pakistan; the offer used to stop there.
        expect(live('2026-11-30T04:59:00')).toBe(true);
        expect(live('2026-11-30T05:01:00')).toBe(true);
        expect(live('2026-11-30T21:00:00')).toBe(true);
        expect(live('2026-11-30T23:59:59')).toBe(true);
    });

    it('ends at midnight, when the day is over', () => {
        expect(live('2026-12-01T00:00:00')).toBe(false);
        expect(live('2026-12-01T04:59:00')).toBe(false);
        expect(live('2026-12-15T12:00:00')).toBe(false);
    });

    it('is still live on every earlier day', () => {
        expect(live('2026-11-29T23:59:59')).toBe(true);
        expect(live('2026-01-01T00:00:00')).toBe(true);
    });
});

describe('"Valid from" picked in the admin form', () => {
    const offer = { validFrom: picked('2026-10-01') };
    const live = (local: string) =>
        isWithinValidity(offer, KARACHI, pkt(local));

    it('starts at midnight on the branch clock, not at 05:00', () => {
        expect(live('2026-09-30T23:59:59')).toBe(false);
        expect(live('2026-10-01T00:00:00')).toBe(true);
        expect(live('2026-10-01T04:59:00')).toBe(true);
        expect(live('2026-10-01T05:01:00')).toBe(true);
    });
});

describe('a one-day offer', () => {
    const offer = {
        validFrom: picked('2026-10-15'),
        validUntil: picked('2026-10-15'),
    };
    const live = (local: string) =>
        isWithinValidity(offer, KARACHI, pkt(local));

    it('runs for exactly that day', () => {
        expect(live('2026-10-14T23:59:59')).toBe(false);
        expect(live('2026-10-15T00:00:00')).toBe(true);
        expect(live('2026-10-15T12:00:00')).toBe(true);
        expect(live('2026-10-15T23:59:59')).toBe(true);
        expect(live('2026-10-16T00:00:00')).toBe(false);
    });
});

describe('the day follows the timezone it is read in', () => {
    const offer = {
        validFrom: picked('2026-10-01'),
        validUntil: picked('2026-11-30'),
    };

    it('uses the UTC day for a branch left on UTC', () => {
        const live = (iso: string) =>
            isWithinValidity(offer, 'UTC', new Date(iso));
        expect(live('2026-09-30T23:59:59Z')).toBe(false);
        expect(live('2026-10-01T00:00:00Z')).toBe(true);
        expect(live('2026-11-30T23:59:59Z')).toBe(true);
        expect(live('2026-12-01T00:00:00Z')).toBe(false);
    });

    it('does not start early or end early west of UTC', () => {
        const live = (iso: string) =>
            isWithinValidity(offer, NEW_YORK, new Date(iso));
        // 1 Oct 00:00 in New York is 04:00 UTC.
        expect(live('2026-10-01T03:59:59Z')).toBe(false);
        expect(live('2026-10-01T04:00:00Z')).toBe(true);
        // 1 Dec 00:00 in New York is 05:00 UTC.
        expect(live('2026-12-01T04:59:59Z')).toBe(true);
        expect(live('2026-12-01T05:00:00Z')).toBe(false);
    });
});

describe('a real moment is still compared as one', () => {
    // The coupon minted when a customer claims a promotion: claim + N×24h.
    const until = new Date('2026-10-12T09:23:11.123Z');

    it('ends at that moment whatever the timezone', () => {
        for (const tz of [KARACHI, NEW_YORK, 'UTC', null]) {
            const live = (at: Date) =>
                isWithinValidity({ validUntil: until }, tz, at);
            expect(live(new Date(until.getTime() - 1))).toBe(true);
            expect(live(until)).toBe(true);
            expect(live(new Date(until.getTime() + 1))).toBe(false);
        }
    });

    it('is not cut short when its UTC date is a day behind the local one', () => {
        // 21:00 UTC on the 12th is 02:00 on the 13th in Pakistan. Read as a
        // picked date it would have ended at midnight, two hours early.
        const late = { validUntil: new Date('2026-10-12T21:00:00Z') };
        expect(
            isWithinValidity(late, KARACHI, new Date('2026-10-12T20:30:00Z')),
        ).toBe(true);
        expect(
            isWithinValidity(late, KARACHI, new Date('2026-10-12T21:00:01Z')),
        ).toBe(false);
    });

    it('starts at that moment too', () => {
        const from = new Date('2026-10-12T09:23:11.123Z');
        expect(hasStarted(from, KARACHI, new Date(from.getTime() - 1))).toBe(
            false,
        );
        expect(hasStarted(from, KARACHI, from)).toBe(true);
    });
});

describe('open ends', () => {
    const now = pkt('2026-10-05T16:00:00');

    it('never restricts', () => {
        expect(isWithinValidity({}, KARACHI, now)).toBe(true);
        expect(
            isWithinValidity({ validFrom: null, validUntil: null }, null, now),
        ).toBe(true);
        expect(hasStarted(null, KARACHI, now)).toBe(true);
        expect(hasEnded(null, KARACHI, now)).toBe(false);
        expect(hasEnded(undefined, KARACHI, now)).toBe(false);
    });

    it('checks the one end that is set', () => {
        expect(
            isWithinValidity({ validFrom: picked('2026-10-06') }, KARACHI, now),
        ).toBe(false);
        expect(
            isWithinValidity(
                { validUntil: picked('2026-10-04') },
                KARACHI,
                now,
            ),
        ).toBe(false);
        expect(
            isWithinValidity(
                { validUntil: picked('2026-10-05') },
                KARACHI,
                now,
            ),
        ).toBe(true);
    });
});

describe('validityTimezone', () => {
    /** Answers each query from a list, in order, and records what was asked. */
    const runner = (...answers: unknown[][]) => {
        const query = jest.fn<Promise<unknown>, [string, unknown[]?]>();
        for (const a of answers) query.mockResolvedValueOnce(a);
        return { query };
    };

    it("uses the branch's own timezone when the sale has a branch", async () => {
        const db = runner([{ timezone: KARACHI }]);
        await expect(
            validityTimezone(db, { branchId: 16, tenantId: 6 }),
        ).resolves.toBe(KARACHI);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][0]).toContain('FROM branches');
        expect(db.query.mock.calls[0][1]).toEqual([16]);
    });

    it("uses the timezone most of the tenant's branches run on otherwise", async () => {
        const db = runner([{ timezone: KARACHI }]);
        await expect(validityTimezone(db, { tenantId: 6 })).resolves.toBe(
            KARACHI,
        );
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('branch_brands');
        expect(sql).toContain('br.tenant_id = $1');
        expect(sql).toContain('ORDER BY count(*) DESC');
        expect(params).toEqual([6]);
    });

    it('falls through an unknown branch to the tenant', async () => {
        const db = runner([], [{ timezone: KARACHI }]);
        await expect(
            validityTimezone(db, { branchId: 999, tenantId: 6 }),
        ).resolves.toBe(KARACHI);
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("reads the tenant's default only when it has no active branch", async () => {
        const db = runner([], [{ timezone: 'Asia/Dubai' }]);
        await expect(validityTimezone(db, { tenantId: 6 })).resolves.toBe(
            'Asia/Dubai',
        );
        expect(db.query.mock.calls[1][0]).toContain('FROM tenants');
    });

    it('treats an unparsable id as none instead of sending it to the database', async () => {
        // `Number('abc')` from a malformed query string.
        const db = runner([{ timezone: KARACHI }]);
        await expect(
            validityTimezone(db, { branchId: NaN, tenantId: 6 }),
        ).resolves.toBe(KARACHI);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][1]).toEqual([6]);

        const none = runner();
        await expect(
            validityTimezone(none, { branchId: NaN, tenantId: NaN }),
        ).resolves.toBe('UTC');
        expect(none.query).not.toHaveBeenCalled();
    });

    it('ends on UTC when nothing is known', async () => {
        await expect(validityTimezone(runner(), {})).resolves.toBe('UTC');
        await expect(
            validityTimezone(runner([], []), { tenantId: 6 }),
        ).resolves.toBe('UTC');
    });
});
