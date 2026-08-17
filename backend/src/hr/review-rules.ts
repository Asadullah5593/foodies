/**
 * Review scheduling, scoring and training readiness — pure, no database.
 *
 * The rule that matters most: an ad-hoc review must NEVER move the scheduled
 * cadence. Every function here that computes a due date takes only SCHEDULED
 * history, so an ad-hoc review is structurally incapable of delaying, replacing
 * or satisfying one (docs/HRM.md §13.1).
 */

export type CycleType = 'probation_3m' | 'quarterly' | 'ad_hoc';
export type CycleOrigin = 'system' | 'manual';

/** Month arithmetic that clamps rather than rolling over. */
export function addMonths(isoDate: string, months: number): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    // 31 Jan + 1 month is 28/29 Feb, not 2/3 March. Rolling over would drift a
    // review cycle by days every time it passed a short month.
    const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const day = Math.min(d, lastDay);
    return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export type ScheduledCycle = {
    sequenceNo: number;
    cycleType: CycleType;
    periodFrom: string;
    periodTo: string;
    dueDate: string;
};

/**
 * The next scheduled cycle for an employee.
 *
 * First review is three months after joining (`probation_3m`), then every three
 * months. Anchored to the joining date and the last SCHEDULED cycle only —
 * `lastScheduled` must never be populated from an ad-hoc review.
 *
 * Returns null when the employee has left: there is nothing to schedule.
 */
export function nextScheduledCycle(input: {
    dateOfJoining: string;
    dateOfLeaving?: string | null;
    lastScheduled: { sequenceNo: number; periodTo: string } | null;
    intervalMonths?: number;
}): ScheduledCycle | null {
    if (input.dateOfLeaving) return null;
    const interval = input.intervalMonths ?? 3;

    if (!input.lastScheduled) {
        const due = addMonths(input.dateOfJoining, interval);
        return {
            sequenceNo: 1,
            cycleType: 'probation_3m',
            periodFrom: input.dateOfJoining,
            periodTo: due,
            dueDate: due,
        };
    }

    const from = input.lastScheduled.periodTo;
    const due = addMonths(from, interval);
    return {
        sequenceNo: input.lastScheduled.sequenceNo + 1,
        cycleType: 'quarterly',
        periodFrom: from,
        periodTo: due,
        dueDate: due,
    };
}

/**
 * Should this cycle exist yet?
 *
 * Cycles are created a little BEFORE they fall due, so the reviewer has notice
 * rather than discovering an overdue review on the day.
 */
export function shouldCreateCycle(
    cycle: ScheduledCycle,
    today: string,
    leadDays = 14,
): boolean {
    const due = new Date(`${cycle.dueDate}T00:00:00Z`).getTime();
    const now = new Date(`${today}T00:00:00Z`).getTime();
    return now >= due - leadDays * 86_400_000;
}

export function isOverdue(dueDate: string, today: string): boolean {
    return today > dueDate;
}

export type ReviewQuestion = {
    key: string;
    label: string;
    type: 'rating' | 'text' | 'boolean' | 'select';
    /** Relative weight for rating questions. Ignored for the rest. */
    weight?: number;
    max?: number;
};

/**
 * Score a completed form.
 *
 * Only RATING questions score; text and boolean answers are commentary. An
 * unanswered rating is excluded rather than counted as zero — a half-finished
 * form should read as incomplete, not as a bad review.
 */
export function scoreReview(
    questions: ReviewQuestion[],
    answers: Record<string, unknown>,
): {
    totalScore: number;
    maxScore: number;
    normalizedPercent: number | null;
    answered: number;
    ratingCount: number;
} {
    const ratings = questions.filter((q) => q.type === 'rating');
    let total = 0;
    let max = 0;
    let answered = 0;

    for (const q of ratings) {
        const raw = answers[q.key];
        const value = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(value)) continue;
        const weight = q.weight ?? 1;
        const questionMax = q.max ?? 5;
        total += value * weight;
        max += questionMax * weight;
        answered += 1;
    }

    return {
        totalScore: Math.round(total * 100) / 100,
        maxScore: Math.round(max * 100) / 100,
        normalizedPercent:
            max > 0 ? Math.round((total / max) * 10000) / 100 : null,
        answered,
        ratingCount: ratings.length,
    };
}

export type TrainingRequirement = {
    programId: number;
    programName: string;
    minScore: number | null;
};

export type TrainingRecord = {
    programId: number;
    status: string;
    score: number | null;
};

/**
 * Training readiness for a promotion.
 *
 * ⚠️ Advisory ONLY. The client chose a WARNING, not a block (decision #16), so
 * this reports what is missing and never prevents anything. `enforcement` is
 * carried so a future switch to blocking is a config change, not a rewrite.
 */
export function trainingReadiness(
    required: TrainingRequirement[],
    records: TrainingRecord[],
): {
    ready: boolean;
    missing: Array<{ programId: number; programName: string; reason: string }>;
} {
    const missing: Array<{
        programId: number;
        programName: string;
        reason: string;
    }> = [];

    for (const req of required) {
        const record = records.find((r) => r.programId === req.programId);
        if (!record || record.status !== 'completed') {
            missing.push({
                programId: req.programId,
                programName: req.programName,
                reason: record ? `status is ${record.status}` : 'not started',
            });
            continue;
        }
        if (req.minScore != null && (record.score ?? 0) < req.minScore) {
            missing.push({
                programId: req.programId,
                programName: req.programName,
                reason: `scored ${record.score ?? 0}, needs ${req.minScore}`,
            });
        }
    }

    return { ready: missing.length === 0, missing };
}

/** Does this outcome change the employee's assignment or pay? */
export function outcomeEffects(outcome: string): {
    changesDesignation: boolean;
    changesSalary: boolean;
    endsEmployment: boolean;
} {
    return {
        changesDesignation: outcome === 'promoted',
        // A promotion normally carries a raise, but not necessarily — the
        // reviewer supplies the amount, and its absence is not an error.
        changesSalary: outcome === 'promoted' || outcome === 'increment_only',
        endsEmployment: outcome === 'terminate',
    };
}
