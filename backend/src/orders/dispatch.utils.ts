export function selectNextRoundRobin(
    eligibleRiderIds: number[],
    lastAssignedRiderUserId: number | null,
): number | null {
    if (eligibleRiderIds.length === 0) return null;
    const sorted = [...eligibleRiderIds].sort((a, b) => a - b);
    if (lastAssignedRiderUserId == null) return sorted[0];
    const idx = sorted.indexOf(lastAssignedRiderUserId);
    if (idx < 0) return sorted[0];
    return sorted[(idx + 1) % sorted.length];
}

export function freshnessState(
    timestamp: Date | null | undefined,
    ttlSeconds: number,
    nowMs: number = Date.now(),
): boolean {
    if (!timestamp) return false;
    return nowMs - timestamp.getTime() <= ttlSeconds * 1000;
}

export type DeliveryTier = 'saver' | 'standard' | 'priority';

export interface RiderActiveState {
    activeOrders: number;
    hasPriorityActive: boolean;
}

export interface EligibleRider {
    riderId: number;
    activeOrders: number;
}

/**
 * Capacity rule for tier-aware dispatch:
 * - priority: the rider must be completely idle (no active orders).
 * - standard/saver: the rider must not be priority-locked and stay under the batch cap.
 */
export function riderPassesTierCap(
    state: RiderActiveState,
    tier: DeliveryTier,
    maxBatchSize: number,
): boolean {
    const cap = Math.max(1, Math.floor(maxBatchSize || 1));
    if (tier === 'priority') return state.activeOrders === 0;
    if (state.hasPriorityActive) return false;
    return state.activeOrders < cap;
}

/**
 * Select a rider for a (possibly batchable) order. Priority goes to a fresh rider via
 * round-robin (eligibility already restricted to idle riders). Standard/saver prefer a rider
 * already carrying an order (to batch onto them), round-robin within that group, else
 * round-robin over idle riders.
 */
export function selectRiderForBatchableOrder(
    eligible: EligibleRider[],
    lastAssignedRiderUserId: number | null,
    tier: DeliveryTier,
): number | null {
    if (eligible.length === 0) return null;
    if (tier === 'priority') {
        return selectNextRoundRobin(
            eligible.map((e) => e.riderId),
            lastAssignedRiderUserId,
        );
    }
    const busy = eligible
        .filter((e) => e.activeOrders >= 1)
        .map((e) => e.riderId);
    if (busy.length > 0) {
        return selectNextRoundRobin(busy, lastAssignedRiderUserId);
    }
    return selectNextRoundRobin(
        eligible.map((e) => e.riderId),
        lastAssignedRiderUserId,
    );
}
