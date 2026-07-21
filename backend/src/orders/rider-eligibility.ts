import type { DeliveryTier } from './dispatch.utils';
import { freshnessState, riderPassesTierCap } from './dispatch.utils';

/**
 * Single source of truth for "can this rider take this order right now".
 *
 * Auto-dispatch and every manual assignment path share this predicate so the
 * two can never drift: a rider the round-robin refuses to pick is a rider an
 * admin cannot hand-pick either.
 */

export type RiderIneligibilityReason =
    | 'user_inactive'
    | 'not_checked_in'
    | 'paused'
    | 'checked_in_elsewhere'
    | 'heartbeat_stale'
    | 'location_unknown'
    | 'location_stale'
    | 'outside_premises'
    | 'priority_locked'
    | 'active_order_cap'
    | 'below_min_rating'
    | 'below_min_timely_rate';

/** A heartbeat older than this means the rider's app is no longer reporting in. */
export const RIDER_HEARTBEAT_TTL_SECONDS = 90;
/** A GPS fix older than this is too stale to judge where the rider is. */
export const RIDER_LOCATION_TTL_SECONDS = 120;
/** Radius applied when a branch has not been given an explicit premises size. */
export const DEFAULT_PREMISES_RADIUS_M = 300;

/** Presence + performance snapshot for one rider, as read from the dispatch query. */
export interface RiderEligibilitySnapshot {
    riderUserId: number;
    /** users.status */
    userStatus: string;
    isCheckedIn: boolean | null;
    isPaused: boolean | null;
    /** Branch the rider is currently checked in at (rider_presences.branch_id). */
    presenceBranchId: number | null;
    lastHeartbeatAt: Date | null;
    lastLocationAt: Date | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    activeOrders: number;
    hasPriorityActive: boolean;
    ratingAvg: number | null;
    minRating: number | null;
    timelyRate: number | null;
    minTimelyRate: number | null;
}

/**
 * The branch's premises: a circle around the branch's own coordinates. This is
 * deliberately NOT `branches.delivery_radius_km` — that one describes how far
 * the branch will deliver TO a customer (kilometres), whereas the premises is
 * how close a rider must physically be to the restaurant to count as on-site
 * (metres).
 */
export interface BranchPremises {
    branchId: number;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number;
}

export type PremisesState =
    | 'inside'
    | 'outside'
    /** The branch has no coordinates, so the premises cannot be evaluated. */
    | 'branch_not_geocoded'
    /** The rider has never reported a position. */
    | 'rider_location_unknown';

export interface PremisesCheck {
    state: PremisesState;
    /** Distance from the branch centre in metres; null when it can't be computed. */
    distanceMeters: number | null;
    radiusMeters: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
): number {
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Where the rider sits relative to the branch premises.
 *
 * A branch with no coordinates yields `branch_not_geocoded` and is treated as a
 * pass by callers: the premises is unconfigured, and refusing every assignment
 * for such a branch would take it offline entirely. Set the branch's lat/lng to
 * turn the rule on.
 */
export function checkPremises(
    premises: BranchPremises,
    riderLatitude: number | null,
    riderLongitude: number | null,
): PremisesCheck {
    const radiusMeters = normalizePremisesRadius(premises.radiusMeters);
    if (premises.latitude == null || premises.longitude == null) {
        return {
            state: 'branch_not_geocoded',
            distanceMeters: null,
            radiusMeters,
        };
    }
    if (riderLatitude == null || riderLongitude == null) {
        return {
            state: 'rider_location_unknown',
            distanceMeters: null,
            radiusMeters,
        };
    }
    const distanceMeters =
        haversineKm(
            Number(premises.latitude),
            Number(premises.longitude),
            riderLatitude,
            riderLongitude,
        ) * 1000;
    return {
        state: distanceMeters <= radiusMeters ? 'inside' : 'outside',
        distanceMeters,
        radiusMeters,
    };
}

export function normalizePremisesRadius(radius: unknown): number {
    const parsed = Number(radius);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return DEFAULT_PREMISES_RADIUS_M;
    return parsed;
}

export interface EligibilityContext {
    /** Branch the order belongs to. */
    branchId: number;
    premises: BranchPremises;
    tier: DeliveryTier;
    maxBatchSize: number;
    nowMs?: number;
    /**
     * Rating / timeliness floors from rider_profiles. Auto-dispatch applies them
     * to pick the best rider; manual assignment does not, because an admin
     * cannot fix a rider's historical rating in the moment and a hard block
     * there would leave an order undeliverable.
     */
    includeQualityThresholds?: boolean;
    /**
     * Order being (re)assigned. Its own active-order row is excluded from the
     * capacity count so re-assigning an order to the same rider is not blocked
     * by that order itself.
     */
    excludeOrderId?: number | null;
}

/**
 * Every reason this rider cannot take the order. Empty array = eligible.
 * Reasons are returned in a stable order so ledger entries diff cleanly.
 */
export function evaluateRiderEligibility(
    snapshot: RiderEligibilitySnapshot,
    context: EligibilityContext,
): RiderIneligibilityReason[] {
    const nowMs = context.nowMs ?? Date.now();
    const reasons: RiderIneligibilityReason[] = [];

    if (snapshot.userStatus !== 'active') reasons.push('user_inactive');
    if (!snapshot.isCheckedIn) reasons.push('not_checked_in');
    if (snapshot.isPaused) reasons.push('paused');
    if (
        snapshot.presenceBranchId != null &&
        Number(snapshot.presenceBranchId) !== context.branchId
    ) {
        reasons.push('checked_in_elsewhere');
    }
    if (
        !freshnessState(
            snapshot.lastHeartbeatAt,
            RIDER_HEARTBEAT_TTL_SECONDS,
            nowMs,
        )
    ) {
        reasons.push('heartbeat_stale');
    }
    if (snapshot.lastLocationAt == null) {
        reasons.push('location_unknown');
    } else if (
        !freshnessState(
            snapshot.lastLocationAt,
            RIDER_LOCATION_TTL_SECONDS,
            nowMs,
        )
    ) {
        reasons.push('location_stale');
    }

    // Premises. `branch_not_geocoded` and `rider_location_unknown` are not
    // reported here: the former means the rule is unconfigured, and the latter
    // is already covered by location_unknown/location_stale above.
    if (
        checkPremises(
            context.premises,
            snapshot.lastLatitude,
            snapshot.lastLongitude,
        ).state === 'outside'
    ) {
        reasons.push('outside_premises');
    }

    if (
        !riderPassesTierCap(
            {
                activeOrders: snapshot.activeOrders,
                hasPriorityActive: snapshot.hasPriorityActive,
            },
            context.tier,
            context.maxBatchSize,
        )
    ) {
        reasons.push(
            snapshot.hasPriorityActive && context.tier !== 'priority'
                ? 'priority_locked'
                : 'active_order_cap',
        );
    }

    if (context.includeQualityThresholds) {
        if (
            snapshot.minRating != null &&
            snapshot.ratingAvg != null &&
            snapshot.ratingAvg < snapshot.minRating
        ) {
            reasons.push('below_min_rating');
        }
        if (
            snapshot.minTimelyRate != null &&
            snapshot.timelyRate != null &&
            snapshot.timelyRate < snapshot.minTimelyRate
        ) {
            reasons.push('below_min_timely_rate');
        }
    }

    return reasons;
}

/** Admin-facing copy for a blocked manual assignment. */
export function describeIneligibility(
    reason: RiderIneligibilityReason,
    context?: {
        maxBatchSize?: number;
        radiusMeters?: number;
        distanceMeters?: number;
    },
): string {
    switch (reason) {
        case 'user_inactive':
            return 'This rider’s account is not active.';
        case 'not_checked_in':
            return 'This rider is not checked in for a shift.';
        case 'paused':
            return 'This rider is on a break.';
        case 'checked_in_elsewhere':
            return 'This rider is checked in at a different branch.';
        case 'heartbeat_stale':
            return 'This rider’s app has stopped reporting in (stale heartbeat).';
        case 'location_unknown':
            return 'This rider has not reported a location yet.';
        case 'location_stale':
            return 'This rider’s location is too old to confirm where they are.';
        case 'outside_premises': {
            const distance =
                context?.distanceMeters != null
                    ? ` (about ${Math.round(context.distanceMeters)}m away)`
                    : '';
            const radius =
                context?.radiusMeters != null
                    ? `${Math.round(context.radiusMeters)}m`
                    : 'the branch premises';
            return `This rider is outside the branch premises${distance}; they must be within ${radius} of the branch.`;
        }
        case 'priority_locked':
            return 'This rider is locked to a priority delivery and cannot take another order.';
        case 'active_order_cap': {
            const cap = context?.maxBatchSize ?? 1;
            return `This rider is at capacity (max ${cap} active ${cap === 1 ? 'order' : 'orders'}).`;
        }
        case 'below_min_rating':
            return 'This rider is below the minimum rating for dispatch.';
        case 'below_min_timely_rate':
            return 'This rider is below the minimum on-time rate for dispatch.';
        default:
            return 'This rider is not available for this order.';
    }
}
