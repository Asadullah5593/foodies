import {
    addDays,
    assignmentCloseDate,
    exitStatusFor,
    isValidPromotion,
    rollUpClearanceStatus,
} from './hr-rules';

describe('assignmentCloseDate', () => {
    /**
     * The invariant the whole history model rests on: no date is ever covered by
     * two assignments. If the outgoing row were closed ON the start date, every
     * "assignment as at date X" query would find two rows and pick one at
     * random — which silently corrupts payroll, scoping and reporting alike.
     */
    it('closes the previous assignment the day before the new one starts', () => {
        expect(assignmentCloseDate('2026-09-01')).toBe('2026-08-31');
    });

    it('handles month boundaries', () => {
        expect(assignmentCloseDate('2026-03-01')).toBe('2026-02-28');
        expect(assignmentCloseDate('2028-03-01')).toBe('2028-02-29'); // leap year
    });

    it('handles year boundaries', () => {
        expect(assignmentCloseDate('2027-01-01')).toBe('2026-12-31');
    });

    it('is not affected by the local timezone', () => {
        // Parsed as UTC on purpose. Naive `new Date('2026-09-01')` arithmetic in
        // a UTC+5 environment can land on the wrong day.
        expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
        expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    });
});

describe('isValidPromotion', () => {
    it('accepts a move up the ladder', () => {
        expect(isValidPromotion(30, 50)).toBe(true);
    });

    it('rejects a sideways move at the same level', () => {
        expect(isValidPromotion(30, 30)).toBe(false);
    });

    it('rejects a move down', () => {
        expect(isValidPromotion(50, 30)).toBe(false);
    });
});

describe('exitStatusFor', () => {
    const today = '2026-08-17';

    /**
     * The case that matters: an exit recorded today for someone whose last day
     * is a month away. They are still at work, so attendance and payroll must
     * keep running until then.
     */
    it('is notice_period while the last working date is in the future', () => {
        expect(exitStatusFor('resignation', '2026-09-16', today)).toBe(
            'notice_period',
        );
        expect(exitStatusFor('termination', '2026-09-16', today)).toBe(
            'notice_period',
        );
    });

    it('is final on the last working day itself', () => {
        expect(exitStatusFor('resignation', today, today)).toBe('resigned');
        expect(exitStatusFor('termination', today, today)).toBe('terminated');
    });

    it('is final when backdated', () => {
        expect(exitStatusFor('resignation', '2026-08-01', today)).toBe(
            'resigned',
        );
        expect(exitStatusFor('end_of_contract', '2026-08-01', today)).toBe(
            'resigned',
        );
        expect(exitStatusFor('termination', '2026-08-01', today)).toBe(
            'terminated',
        );
    });
});

describe('rollUpClearanceStatus', () => {
    const p = { status: 'pending' };
    const c = { status: 'cleared' };
    const w = { status: 'withheld' };
    const na = { status: 'not_applicable' };

    it('is pending when nothing has been touched', () => {
        expect(rollUpClearanceStatus([p, p, p])).toBe('pending');
    });

    it('is in_progress once some items are done', () => {
        expect(rollUpClearanceStatus([c, p, p])).toBe('in_progress');
    });

    it('is cleared when nothing is left pending', () => {
        expect(rollUpClearanceStatus([c, c, na])).toBe('cleared');
    });

    /**
     * One unreturned uniform or unsettled advance is the entire reason the
     * checklist exists. It must not be averaged away by the other items.
     */
    it('withheld beats everything, even when all other items are cleared', () => {
        expect(rollUpClearanceStatus([c, c, w])).toBe('withheld');
        expect(rollUpClearanceStatus([w, p, p])).toBe('withheld');
    });

    it('treats an empty checklist as pending, not cleared', () => {
        expect(rollUpClearanceStatus([])).toBe('pending');
    });
});
