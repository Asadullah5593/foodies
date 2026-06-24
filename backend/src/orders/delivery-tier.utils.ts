import type {
    BrandDeliveryTiers,
    DeliveryTierConfig,
    DeliveryTierKey,
} from '../entities/brand.entity';

/** Canonical tier order (cheapest/slowest → fastest). */
export const DELIVERY_TIER_KEYS: readonly DeliveryTierKey[] = [
    'saver',
    'standard',
    'priority',
];

export function isDeliveryTierKey(x: unknown): x is DeliveryTierKey {
    return (
        typeof x === 'string' &&
        (DELIVERY_TIER_KEYS as readonly string[]).includes(x)
    );
}

/** Defaults used to seed/merge a brand's tier config (all disabled until configured). */
export const DELIVERY_TIER_DEFAULTS: BrandDeliveryTiers = {
    saver: {
        enabled: false,
        name: 'Saver',
        bands: [{ maxKm: 5, fee: 0 }],
        etaMinMinutes: 45,
        etaMaxMinutes: 75,
    },
    standard: {
        enabled: false,
        name: 'Standard',
        bands: [{ maxKm: 5, fee: 0 }],
        etaMinMinutes: 30,
        etaMaxMinutes: 50,
    },
    priority: {
        enabled: false,
        name: 'Priority',
        bands: [{ maxKm: 5, fee: 0 }],
        etaMinMinutes: 20,
        etaMaxMinutes: 35,
    },
    saverHoldMinutes: 8,
    maxBatchSize: 1,
};

/** A single delivery option as returned to the consumer/mobile checkout. */
export interface DeliveryOption {
    tier: DeliveryTierKey;
    name: string;
    fee: number | null;
    eta_min_minutes: number;
    eta_max_minutes: number;
    is_available: boolean;
}

/**
 * Pick the band whose maxKm is the smallest value >= distanceKm (bands need not be
 * pre-sorted). Returns null when the distance exceeds every band.
 */
export function resolveBand(
    bands: { maxKm: number; fee: number }[],
    distanceKm: number,
): { maxKm: number; fee: number } | null {
    const sorted = [...(bands ?? [])].sort((a, b) => a.maxKm - b.maxKm);
    for (const band of sorted) {
        if (distanceKm <= band.maxKm) return band;
    }
    return null;
}

/** Resolve one tier's availability + fee for a given distance (null distance = unknown). */
export function resolveTierOption(
    tier: DeliveryTierKey,
    config: DeliveryTierConfig,
    distanceKm: number | null,
): DeliveryOption {
    const band =
        distanceKm == null ? null : resolveBand(config.bands, distanceKm);
    const isAvailable = config.enabled === true && band != null;
    return {
        tier,
        name: config.name,
        fee: isAvailable ? band.fee : null,
        eta_min_minutes: config.etaMinMinutes,
        eta_max_minutes: config.etaMaxMinutes,
        is_available: isAvailable,
    };
}

/** Build the offered (enabled) tiers as delivery_options[] for a brand at a distance. */
export function buildDeliveryOptions(
    tiers: BrandDeliveryTiers,
    distanceKm: number | null,
): DeliveryOption[] {
    return DELIVERY_TIER_KEYS.filter((k) => tiers?.[k]?.enabled === true).map(
        (k) => resolveTierOption(k, tiers[k], distanceKm),
    );
}

/**
 * Resolve the fee + static ETA for a CHOSEN tier at order placement. Returns null when
 * the tier is missing, disabled, or unavailable at the given distance (caller rejects).
 */
export function resolveChosenTierFee(
    tiers: BrandDeliveryTiers,
    tier: DeliveryTierKey,
    distanceKm: number,
): { fee: number; etaMin: number; etaMax: number } | null {
    const config = tiers?.[tier];
    if (!config || config.enabled !== true) return null;
    const band = resolveBand(config.bands, distanceKm);
    if (!band) return null;
    return {
        fee: band.fee,
        etaMin: config.etaMinMinutes,
        etaMax: config.etaMaxMinutes,
    };
}

/** The default tier whose scalar fee represents the order when the client didn't pick one. */
export function defaultTierKey(
    options: DeliveryOption[],
): DeliveryTierKey | null {
    const available = options.filter((o) => o.is_available);
    if (available.length === 0) return null;
    const std = available.find((o) => o.tier === 'standard');
    return (std ?? available[0]).tier;
}

/**
 * Validate a brand tier config (for admin update). Returns a list of human-readable
 * errors; empty = valid. Pure so it can be unit-tested and reused by the service.
 */
export function validateDeliveryTiers(
    tiers: BrandDeliveryTiers,
    enabled: boolean,
): string[] {
    const errors: string[] = [];
    let anyEnabled = false;
    for (const key of DELIVERY_TIER_KEYS) {
        const c = tiers[key];
        if (!c) continue;
        if (c.enabled) anyEnabled = true;
        if (c.enabled && (!c.bands || c.bands.length === 0)) {
            errors.push(`${key}: at least one distance band is required`);
        }
        for (const b of c.bands ?? []) {
            if (!(b.maxKm > 0)) errors.push(`${key}: band maxKm must be > 0`);
            if (!(b.fee >= 0)) errors.push(`${key}: band fee must be >= 0`);
        }
        // Bands must have strictly ascending, unique maxKm.
        const kms = (c.bands ?? []).map((b) => b.maxKm);
        for (let i = 1; i < kms.length; i++) {
            if (kms[i] <= kms[i - 1]) {
                errors.push(`${key}: distance bands must ascend by maxKm`);
                break;
            }
        }
        if (c.etaMinMinutes > c.etaMaxMinutes) {
            errors.push(`${key}: ETA min must be <= max`);
        }
    }
    if (enabled && !anyEnabled) {
        errors.push('At least one tier must be enabled when tiers are on');
    }
    return errors;
}
