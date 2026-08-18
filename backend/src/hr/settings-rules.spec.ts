import {
    cumulativeLadderDeduction,
    DEFAULT_DEDUCTION_CONFIG,
    deductionConfigFrom,
    DeductionRuleInput,
    ladderDeduction,
    requiredApproval,
    ApprovalRuleInput,
    resolveRule,
} from './settings-rules';
import { cumulativeLateDeduction } from './attendance-rules';

const base = {
    id: 1,
    branchId: null,
    designationId: null,
    priority: 0,
    isActive: true,
};

const deduction = (
    over: Partial<DeductionRuleInput> = {},
): DeductionRuleInput => ({
    ...base,
    trigger: 'absent',
    condition: {},
    effectType: 'deduct_days',
    effectValue: 1,
    ...over,
});

const approval = (
    over: Partial<ApprovalRuleInput> = {},
): ApprovalRuleInput => ({
    ...base,
    subject: 'attendance_waiver',
    condition: {},
    requiredPermission: 'attendance-waiver:approve',
    escalateToPermission: null,
    ...over,
});

const TODAY = '2026-08-17';

describe('rule resolution', () => {
    it('prefers branch + designation over branch over designation over tenant', () => {
        const rules = [
            deduction({ id: 1 }),
            deduction({ id: 2, designationId: 4 }),
            deduction({ id: 3, branchId: 10 }),
            deduction({ id: 4, branchId: 10, designationId: 4 }),
        ];
        const picked = resolveRule(rules, {
            branchId: 10,
            designationId: 4,
            onDate: TODAY,
        });
        expect(picked?.id).toBe(4);
    });

    it('ignores a rule scoped to a different branch entirely', () => {
        const rules = [
            deduction({ id: 1 }),
            deduction({ id: 2, branchId: 11 }),
        ];
        const picked = resolveRule(rules, {
            branchId: 10,
            designationId: null,
            onDate: TODAY,
        });
        // Not "less specific" — inapplicable.
        expect(picked?.id).toBe(1);
    });

    it('honours the effective window', () => {
        const rules = [
            deduction({ id: 1, effectiveTo: '2026-08-01' }),
            deduction({ id: 2, effectiveFrom: '2026-08-10' }),
        ];
        expect(
            resolveRule(rules, {
                branchId: null,
                designationId: null,
                onDate: TODAY,
            })?.id,
        ).toBe(2);
    });

    it('breaks a tie on priority, then on the newest row', () => {
        const rules = [
            deduction({ id: 1, priority: 5 }),
            deduction({ id: 2, priority: 5 }),
            deduction({ id: 3, priority: 1 }),
        ];
        expect(
            resolveRule(rules, {
                branchId: null,
                designationId: null,
                onDate: TODAY,
            })?.id,
        ).toBe(2);
    });

    it('returns null when every rule is inactive', () => {
        const rules = [deduction({ id: 1, isActive: false })];
        expect(
            resolveRule(rules, {
                branchId: null,
                designationId: null,
                onDate: TODAY,
            }),
        ).toBeNull();
    });
});

describe('deduction config', () => {
    const scope = { branchId: 10, designationId: 4, onDate: TODAY };

    it('falls back to the shipped behaviour when there are no rules', () => {
        expect(deductionConfigFrom([], scope)).toEqual(
            DEFAULT_DEDUCTION_CONFIG,
        );
    });

    it('reproduces the hard-coded ladder exactly', () => {
        // The whole point of the migration's seeded rows: identical arithmetic.
        for (let lates = 0; lates <= 10; lates += 1) {
            expect(
                cumulativeLadderDeduction(
                    DEFAULT_DEDUCTION_CONFIG.lateLadder,
                    lates,
                ),
            ).toBe(cumulativeLateDeduction(lates));
        }
    });

    it('walks the ladder and restarts', () => {
        const ladder = [0, 0.5, 0.5];
        expect(ladderDeduction(ladder, 1)).toBe(0);
        expect(ladderDeduction(ladder, 2)).toBe(0.5);
        expect(ladderDeduction(ladder, 3)).toBe(0.5);
        expect(ladderDeduction(ladder, 4)).toBe(0);
        expect(cumulativeLadderDeduction(ladder, 6)).toBe(2);
    });

    it('takes a configured ladder over the default', () => {
        const config = deductionConfigFrom(
            [
                deduction({
                    trigger: 'late',
                    condition: { ladder: [0, 0, 1] },
                    effectValue: 0,
                }),
            ],
            scope,
        );
        expect(config.lateLadder).toEqual([0, 0, 1]);
        expect(cumulativeLadderDeduction(config.lateLadder, 3)).toBe(1);
    });

    it('accepts a ladder that deducts nothing', () => {
        const config = deductionConfigFrom(
            [deduction({ trigger: 'late', condition: { ladder: [0] } })],
            scope,
        );
        expect(cumulativeLadderDeduction(config.lateLadder, 9)).toBe(0);
    });

    it('keeps the default when a rule is malformed rather than zeroing it', () => {
        const config = deductionConfigFrom(
            [
                deduction({
                    trigger: 'late',
                    condition: { ladder: 'nonsense' },
                }),
                deduction({ trigger: 'absent', effectValue: NaN }),
            ],
            scope,
        );
        // A typo must never quietly stop deducting for absence.
        expect(config.lateLadder).toEqual([0, 0.5, 0.5]);
        expect(config.absentDays).toBe(1);
    });

    it('ignores an effect type it cannot express as days', () => {
        const config = deductionConfigFrom(
            [
                deduction({
                    trigger: 'absent',
                    effectType: 'deduct_amount',
                    effectValue: 500,
                }),
            ],
            scope,
        );
        expect(config.absentDays).toBe(DEFAULT_DEDUCTION_CONFIG.absentDays);
    });

    it('lets a branch rule override the tenant default', () => {
        const config = deductionConfigFrom(
            [
                deduction({ id: 1, trigger: 'absent', effectValue: 1 }),
                deduction({
                    id: 2,
                    trigger: 'absent',
                    branchId: 10,
                    effectValue: 1.5,
                }),
            ],
            scope,
        );
        expect(config.absentDays).toBe(1.5);
    });

    it('leaves the opt-in triggers at zero unless configured', () => {
        const config = deductionConfigFrom([], scope);
        expect(config.earlyLeaveDays).toBe(0);
        expect(config.missedPunchDays).toBe(0);
    });
});

describe('approval rules', () => {
    const scope = { branchId: 10, onDate: TODAY };

    it('requires nothing extra when the table is empty', () => {
        expect(
            requiredApproval([], 'attendance_waiver', scope, {
                amount: 50_000,
            }),
        ).toBeNull();
    });

    it('applies only above the configured threshold', () => {
        const rules = [
            approval({
                condition: { amountGt: 2000 },
                requiredPermission: 'all-branches:access',
            }),
        ];
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {
                amount: 1500,
            }),
        ).toBeNull();
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {
                amount: 2500,
            })?.requiredPermission,
        ).toBe('all-branches:access');
    });

    it('treats the threshold as strictly greater than', () => {
        const rules = [approval({ condition: { amountGt: 2000 } })];
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {
                amount: 2000,
            }),
        ).toBeNull();
    });

    it('needs every threshold in the condition to hold', () => {
        const rules = [approval({ condition: { amountGt: 2000, daysGt: 3 } })];
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {
                amount: 5000,
                days: 2,
            }),
        ).toBeNull();
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {
                amount: 5000,
                days: 4,
            }),
        ).not.toBeNull();
    });

    it('does not leak across subjects', () => {
        const rules = [approval({ subject: 'leave_request' })];
        expect(
            requiredApproval(rules, 'payroll_run', scope, { amount: 1 }),
        ).toBeNull();
    });

    it('prefers a branch rule over the tenant one', () => {
        const rules = [
            approval({ id: 1, requiredPermission: 'tenant-level' }),
            approval({
                id: 2,
                branchId: 10,
                requiredPermission: 'branch-level',
            }),
        ];
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {})
                ?.requiredPermission,
        ).toBe('branch-level');
    });

    it('ignores a missing context value rather than matching on it', () => {
        const rules = [approval({ condition: { minutesGt: 60 } })];
        // No overtime minutes supplied: the rule is about something else.
        expect(
            requiredApproval(rules, 'attendance_waiver', scope, {}),
        ).toBeNull();
    });
});
