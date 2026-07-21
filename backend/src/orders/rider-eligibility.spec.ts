import {
    checkPremises,
    evaluateRiderEligibility,
    normalizePremisesRadius,
    DEFAULT_PREMISES_RADIUS_M,
    type BranchPremises,
    type EligibilityContext,
    type RiderEligibilitySnapshot,
} from './rider-eligibility';

const NOW = new Date('2026-07-21T12:00:00Z').getTime();
const secondsAgo = (s: number) => new Date(NOW - s * 1000);

// Emporium branch coordinates from the seed data.
const BRANCH_LAT = 31.470981;
const BRANCH_LNG = 74.273157;

const premises: BranchPremises = {
    branchId: 10,
    latitude: BRANCH_LAT,
    longitude: BRANCH_LNG,
    radiusMeters: 300,
};

/** A rider who passes every check; individual tests break one thing at a time. */
function availableRider(
    overrides: Partial<RiderEligibilitySnapshot> = {},
): RiderEligibilitySnapshot {
    return {
        riderUserId: 24,
        userStatus: 'active',
        isCheckedIn: true,
        isPaused: false,
        presenceBranchId: 10,
        lastHeartbeatAt: secondsAgo(10),
        lastLocationAt: secondsAgo(10),
        lastLatitude: BRANCH_LAT,
        lastLongitude: BRANCH_LNG,
        activeOrders: 0,
        hasPriorityActive: false,
        ratingAvg: 4.8,
        minRating: null,
        timelyRate: 95,
        minTimelyRate: null,
        ...overrides,
    };
}

function context(
    overrides: Partial<EligibilityContext> = {},
): EligibilityContext {
    return {
        branchId: 10,
        premises,
        tier: 'standard',
        maxBatchSize: 1,
        nowMs: NOW,
        ...overrides,
    };
}

describe('checkPremises', () => {
    it('places a rider standing at the branch inside', () => {
        const result = checkPremises(premises, BRANCH_LAT, BRANCH_LNG);
        expect(result.state).toBe('inside');
        expect(result.distanceMeters).toBeCloseTo(0, 5);
    });

    it('places a rider just inside the radius inside', () => {
        // ~0.0018 degrees of latitude ≈ 200m.
        const result = checkPremises(premises, BRANCH_LAT + 0.0018, BRANCH_LNG);
        expect(result.state).toBe('inside');
        expect(result.distanceMeters).toBeLessThan(300);
    });

    it('places a rider a kilometre away outside', () => {
        const result = checkPremises(premises, BRANCH_LAT + 0.009, BRANCH_LNG);
        expect(result.state).toBe('outside');
        expect(result.distanceMeters).toBeGreaterThan(900);
    });

    it('reports branch_not_geocoded when the branch has no coordinates', () => {
        const result = checkPremises(
            { ...premises, latitude: null, longitude: null },
            BRANCH_LAT,
            BRANCH_LNG,
        );
        expect(result.state).toBe('branch_not_geocoded');
        expect(result.distanceMeters).toBeNull();
    });

    it('reports rider_location_unknown when the rider has never reported', () => {
        expect(checkPremises(premises, null, null).state).toBe(
            'rider_location_unknown',
        );
    });

    it('falls back to the default radius for junk values', () => {
        expect(normalizePremisesRadius(0)).toBe(DEFAULT_PREMISES_RADIUS_M);
        expect(normalizePremisesRadius(-50)).toBe(DEFAULT_PREMISES_RADIUS_M);
        expect(normalizePremisesRadius(null)).toBe(DEFAULT_PREMISES_RADIUS_M);
        expect(normalizePremisesRadius(750)).toBe(750);
    });
});

describe('evaluateRiderEligibility', () => {
    it('accepts a checked-in rider standing at the branch', () => {
        expect(evaluateRiderEligibility(availableRider(), context())).toEqual(
            [],
        );
    });

    it('rejects a rider outside the premises', () => {
        const reasons = evaluateRiderEligibility(
            availableRider({ lastLatitude: BRANCH_LAT + 0.05 }),
            context(),
        );
        expect(reasons).toContain('outside_premises');
    });

    it('does not enforce the premises when the branch has no coordinates', () => {
        const reasons = evaluateRiderEligibility(
            availableRider({ lastLatitude: BRANCH_LAT + 0.05 }),
            context({
                premises: { ...premises, latitude: null, longitude: null },
            }),
        );
        expect(reasons).not.toContain('outside_premises');
        expect(reasons).toEqual([]);
    });

    it('rejects a rider who has never reported a location', () => {
        const reasons = evaluateRiderEligibility(
            availableRider({
                lastLocationAt: null,
                lastLatitude: null,
                lastLongitude: null,
            }),
            context(),
        );
        expect(reasons).toContain('location_unknown');
        // The premises verdict is unknowable, so it is not double-reported.
        expect(reasons).not.toContain('outside_premises');
    });

    it('rejects a stale GPS fix', () => {
        expect(
            evaluateRiderEligibility(
                availableRider({ lastLocationAt: secondsAgo(600) }),
                context(),
            ),
        ).toContain('location_stale');
    });

    it('rejects a stale heartbeat', () => {
        expect(
            evaluateRiderEligibility(
                availableRider({ lastHeartbeatAt: secondsAgo(600) }),
                context(),
            ),
        ).toContain('heartbeat_stale');
    });

    it.each([
        ['not checked in', { isCheckedIn: false }, 'not_checked_in'],
        ['on a break', { isPaused: true }, 'paused'],
        [
            'checked in elsewhere',
            { presenceBranchId: 12 },
            'checked_in_elsewhere',
        ],
        ['inactive account', { userStatus: 'disabled' }, 'user_inactive'],
    ])('rejects a rider %s', (_label, overrides, expected) => {
        expect(
            evaluateRiderEligibility(availableRider(overrides), context()),
        ).toContain(expected);
    });

    it('rejects a rider already at the batch cap', () => {
        expect(
            evaluateRiderEligibility(
                availableRider({ activeOrders: 1 }),
                context({ maxBatchSize: 1 }),
            ),
        ).toContain('active_order_cap');
    });

    it('rejects a priority-locked rider for a standard order', () => {
        expect(
            evaluateRiderEligibility(
                availableRider({ activeOrders: 1, hasPriorityActive: true }),
                context({ tier: 'standard', maxBatchSize: 3 }),
            ),
        ).toContain('priority_locked');
    });

    it('requires an idle rider for a priority order', () => {
        expect(
            evaluateRiderEligibility(
                availableRider({ activeOrders: 1 }),
                context({ tier: 'priority', maxBatchSize: 3 }),
            ),
        ).toContain('active_order_cap');
    });

    describe('quality thresholds', () => {
        const belowBar = availableRider({
            ratingAvg: 2.0,
            minRating: 4.0,
            timelyRate: 40,
            minTimelyRate: 80,
        });

        it('applies them for auto-dispatch', () => {
            const reasons = evaluateRiderEligibility(
                belowBar,
                context({ includeQualityThresholds: true }),
            );
            expect(reasons).toContain('below_min_rating');
            expect(reasons).toContain('below_min_timely_rate');
        });

        it('skips them for manual assignment', () => {
            const reasons = evaluateRiderEligibility(
                belowBar,
                context({ includeQualityThresholds: false }),
            );
            expect(reasons).toEqual([]);
        });
    });

    it('reports every failing check at once', () => {
        const reasons = evaluateRiderEligibility(
            availableRider({
                isCheckedIn: false,
                lastLatitude: BRANCH_LAT + 0.05,
            }),
            context(),
        );
        expect(reasons).toEqual(['not_checked_in', 'outside_premises']);
    });
});
