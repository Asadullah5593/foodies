import {
    addMonths,
    isOverdue,
    nextScheduledCycle,
    outcomeEffects,
    ReviewQuestion,
    scoreReview,
    shouldCreateCycle,
    trainingReadiness,
} from './review-rules';

describe('addMonths', () => {
    it('advances by whole months', () => {
        expect(addMonths('2026-01-15', 3)).toBe('2026-04-15');
    });

    /**
     * 31 Jan + 1 month must clamp to the end of February, not roll into March.
     * Rolling over drifts a quarterly cycle by days every time it passes a short
     * month, and the drift compounds.
     */
    it('clamps to the end of a shorter month instead of rolling over', () => {
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
        expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
        expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
    });

    it('crosses a year boundary', () => {
        expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    });
});

describe('nextScheduledCycle', () => {
    it('schedules the first review three months after joining', () => {
        const c = nextScheduledCycle({
            dateOfJoining: '2026-08-17',
            lastScheduled: null,
        });
        expect(c).toMatchObject({
            sequenceNo: 1,
            cycleType: 'probation_3m',
            dueDate: '2026-11-17',
        });
    });

    it('schedules every three months after that', () => {
        const c = nextScheduledCycle({
            dateOfJoining: '2026-08-17',
            lastScheduled: { sequenceNo: 1, periodTo: '2026-11-17' },
        });
        expect(c).toMatchObject({
            sequenceNo: 2,
            cycleType: 'quarterly',
            periodFrom: '2026-11-17',
            dueDate: '2027-02-17',
        });
    });

    /**
     * THE rule. `lastScheduled` is fed only from cycles with origin='system',
     * so an ad-hoc review cannot delay, replace or satisfy a scheduled one. The
     * cadence is anchored to the joining date and nothing else moves it.
     */
    it('is anchored to joining and prior SCHEDULED cycles only', () => {
        // Whatever ad-hoc reviews happened in between, the 2nd scheduled review
        // is still three months after the 1st.
        const c = nextScheduledCycle({
            dateOfJoining: '2026-01-01',
            lastScheduled: { sequenceNo: 1, periodTo: '2026-04-01' },
        });
        expect(c?.dueDate).toBe('2026-07-01');
        expect(c?.sequenceNo).toBe(2);
    });

    it('schedules nothing for someone who has left', () => {
        expect(
            nextScheduledCycle({
                dateOfJoining: '2026-01-01',
                dateOfLeaving: '2026-06-01',
                lastScheduled: null,
            }),
        ).toBeNull();
    });

    it('honours a different interval', () => {
        const c = nextScheduledCycle({
            dateOfJoining: '2026-01-01',
            lastScheduled: null,
            intervalMonths: 6,
        });
        expect(c?.dueDate).toBe('2026-07-01');
    });
});

describe('shouldCreateCycle', () => {
    const cycle = {
        sequenceNo: 1,
        cycleType: 'probation_3m' as const,
        periodFrom: '2026-08-17',
        periodTo: '2026-11-17',
        dueDate: '2026-11-17',
    };

    it('creates it inside the lead window, so the reviewer has notice', () => {
        expect(shouldCreateCycle(cycle, '2026-11-05')).toBe(true);
    });

    it('does not create it months early', () => {
        expect(shouldCreateCycle(cycle, '2026-09-01')).toBe(false);
    });

    it('creates it once due, and after', () => {
        expect(shouldCreateCycle(cycle, '2026-11-17')).toBe(true);
        expect(shouldCreateCycle(cycle, '2026-12-25')).toBe(true);
    });
});

describe('isOverdue', () => {
    it('is not overdue on the due date itself', () => {
        expect(isOverdue('2026-11-17', '2026-11-17')).toBe(false);
    });

    it('is overdue the day after', () => {
        expect(isOverdue('2026-11-17', '2026-11-18')).toBe(true);
    });
});

describe('scoreReview', () => {
    const questions: ReviewQuestion[] = [
        { key: 'punctuality', label: 'Punctuality', type: 'rating', max: 5 },
        { key: 'hygiene', label: 'Hygiene', type: 'rating', max: 5, weight: 2 },
        { key: 'notes', label: 'Notes', type: 'text' },
        { key: 'recommend', label: 'Recommend', type: 'boolean' },
    ];

    it('weights rating questions', () => {
        const r = scoreReview(questions, { punctuality: 4, hygiene: 5 });
        // 4×1 + 5×2 = 14 out of 5×1 + 5×2 = 15
        expect(r.totalScore).toBe(14);
        expect(r.maxScore).toBe(15);
        expect(r.normalizedPercent).toBeCloseTo(93.33, 1);
    });

    it('ignores text and boolean answers', () => {
        const r = scoreReview(questions, {
            punctuality: 5,
            hygiene: 5,
            notes: 'excellent',
            recommend: true,
        });
        expect(r.maxScore).toBe(15);
    });

    /**
     * An unanswered rating is excluded, not zero. A half-finished form should
     * read as incomplete rather than as a damning review.
     */
    it('excludes unanswered ratings rather than scoring them zero', () => {
        const r = scoreReview(questions, { punctuality: 4 });
        expect(r.totalScore).toBe(4);
        expect(r.maxScore).toBe(5);
        expect(r.answered).toBe(1);
        expect(r.ratingCount).toBe(2);
    });

    it('returns a null percentage when nothing scoreable was answered', () => {
        const r = scoreReview(questions, { notes: 'later' });
        expect(r.normalizedPercent).toBeNull();
    });

    it('ignores a non-numeric rating answer', () => {
        const r = scoreReview(questions, { punctuality: 'good' });
        expect(r.answered).toBe(0);
    });
});

describe('trainingReadiness', () => {
    const required = [
        { programId: 1, programName: 'Food Safety L2', minScore: 70 },
        { programId: 2, programName: 'Fire Safety', minScore: null },
    ];

    it('is ready when everything is completed and scored', () => {
        const r = trainingReadiness(required, [
            { programId: 1, status: 'completed', score: 80 },
            { programId: 2, status: 'completed', score: null },
        ]);
        expect(r.ready).toBe(true);
        expect(r.missing).toEqual([]);
    });

    it('reports a program never started', () => {
        const r = trainingReadiness(required, [
            { programId: 1, status: 'completed', score: 90 },
        ]);
        expect(r.ready).toBe(false);
        expect(r.missing[0]).toMatchObject({
            programName: 'Fire Safety',
            reason: 'not started',
        });
    });

    it('reports one that is expired rather than treating it as done', () => {
        const r = trainingReadiness(required, [
            { programId: 1, status: 'expired', score: 90 },
            { programId: 2, status: 'completed', score: null },
        ]);
        expect(r.missing[0].reason).toBe('status is expired');
    });

    it('reports a completed program that scored too low', () => {
        const r = trainingReadiness(required, [
            { programId: 1, status: 'completed', score: 50 },
            { programId: 2, status: 'completed', score: null },
        ]);
        expect(r.missing[0].reason).toBe('scored 50, needs 70');
    });

    it('is ready when nothing is required', () => {
        expect(trainingReadiness([], []).ready).toBe(true);
    });
});

describe('outcomeEffects', () => {
    it('a promotion moves designation and pay', () => {
        expect(outcomeEffects('promoted')).toEqual({
            changesDesignation: true,
            changesSalary: true,
            endsEmployment: false,
        });
    });

    it('an increment touches pay only', () => {
        expect(outcomeEffects('increment_only')).toMatchObject({
            changesDesignation: false,
            changesSalary: true,
        });
    });

    it('no promotion changes nothing', () => {
        expect(outcomeEffects('no_promotion')).toEqual({
            changesDesignation: false,
            changesSalary: false,
            endsEmployment: false,
        });
    });

    it('a PIP changes nothing structural', () => {
        expect(outcomeEffects('pip').changesSalary).toBe(false);
    });

    it('terminate ends employment', () => {
        expect(outcomeEffects('terminate').endsEmployment).toBe(true);
    });
});
