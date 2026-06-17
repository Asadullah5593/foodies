export function proratedAmount(
    baseAmount: number,
    actualMinutes: number,
    expectedMinutes: number,
): number {
    if (baseAmount <= 0) return 0;
    if (expectedMinutes <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, actualMinutes / expectedMinutes));
    return baseAmount * ratio;
}

export function componentAmount(
    calcBasis: string,
    value: number,
    facts: {
        completedRides: number;
        timelyDeliveries: number;
        avgRating: number | null;
        minRating?: number;
    },
): number {
    if (!Number.isFinite(value)) return 0;
    if (calcBasis === 'flat') return value;
    if (calcBasis === 'per_ride') return value * facts.completedRides;
    if (calcBasis === 'timely_delivery') return value * facts.timelyDeliveries;
    if (calcBasis === 'rating_threshold_bonus') {
        const min = facts.minRating ?? 0;
        if (facts.avgRating != null && facts.avgRating >= min) return value;
        return 0;
    }
    return 0;
}
