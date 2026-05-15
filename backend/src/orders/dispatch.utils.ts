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
