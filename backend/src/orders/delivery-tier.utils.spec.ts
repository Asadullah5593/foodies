import {
    resolveBand,
    resolveTierOption,
    buildDeliveryOptions,
    resolveChosenTierFee,
    defaultTierKey,
    validateDeliveryTiers,
    isDeliveryTierKey,
    DELIVERY_TIER_DEFAULTS,
} from './delivery-tier.utils';
import type { BrandDeliveryTiers } from '../entities/brand.entity';

const tiers = (): BrandDeliveryTiers => ({
    saver: {
        enabled: true,
        name: 'Saver',
        bands: [
            { maxKm: 5, fee: 90 },
            { maxKm: 10, fee: 130 },
        ],
        etaMinMinutes: 45,
        etaMaxMinutes: 75,
    },
    standard: {
        enabled: true,
        name: 'Standard',
        bands: [
            { maxKm: 5, fee: 150 },
            { maxKm: 10, fee: 200 },
        ],
        etaMinMinutes: 30,
        etaMaxMinutes: 50,
    },
    priority: {
        enabled: false,
        name: 'Priority',
        bands: [{ maxKm: 5, fee: 250 }],
        etaMinMinutes: 20,
        etaMaxMinutes: 35,
    },
    saverHoldMinutes: 8,
    maxBatchSize: 1,
});

describe('delivery-tier.utils', () => {
    describe('resolveBand', () => {
        const bands = [
            { maxKm: 5, fee: 100 },
            { maxKm: 10, fee: 150 },
        ];
        it('picks the first band for a near distance', () => {
            expect(resolveBand(bands, 3)?.fee).toBe(100);
        });
        it('is inclusive on the band boundary', () => {
            expect(resolveBand(bands, 5)?.fee).toBe(100);
        });
        it('falls to the next band between boundaries', () => {
            expect(resolveBand(bands, 7)?.fee).toBe(150);
        });
        it('returns null beyond all bands', () => {
            expect(resolveBand(bands, 12)).toBeNull();
        });
        it('sorts unsorted bands before scanning', () => {
            const unsorted = [
                { maxKm: 10, fee: 150 },
                { maxKm: 5, fee: 100 },
            ];
            expect(resolveBand(unsorted, 4)?.fee).toBe(100);
        });
    });

    describe('resolveTierOption', () => {
        it('available within a band', () => {
            const o = resolveTierOption('standard', tiers().standard, 7);
            expect(o).toMatchObject({
                tier: 'standard',
                fee: 200,
                is_available: true,
            });
        });
        it('unavailable when distance beyond bands', () => {
            const o = resolveTierOption('standard', tiers().standard, 20);
            expect(o.is_available).toBe(false);
            expect(o.fee).toBeNull();
        });
        it('unavailable when tier disabled', () => {
            const o = resolveTierOption('priority', tiers().priority, 3);
            expect(o.is_available).toBe(false);
            expect(o.fee).toBeNull();
        });
        it('unavailable when distance unknown', () => {
            const o = resolveTierOption('standard', tiers().standard, null);
            expect(o.is_available).toBe(false);
        });
    });

    describe('buildDeliveryOptions', () => {
        it('returns only enabled tiers, with availability per distance', () => {
            const opts = buildDeliveryOptions(tiers(), 3);
            expect(opts.map((o) => o.tier)).toEqual(['saver', 'standard']);
            expect(opts.every((o) => o.is_available)).toBe(true);
        });
        it('enabled tier beyond its bands is shown but unavailable', () => {
            const t = tiers();
            t.standard.bands = [{ maxKm: 5, fee: 150 }];
            const opts = buildDeliveryOptions(t, 8);
            const std = opts.find((o) => o.tier === 'standard');
            expect(std?.is_available).toBe(false);
        });
    });

    describe('resolveChosenTierFee', () => {
        it('returns fee + eta for an available chosen tier', () => {
            expect(resolveChosenTierFee(tiers(), 'saver', 4)).toEqual({
                fee: 90,
                etaMin: 45,
                etaMax: 75,
            });
        });
        it('returns null for a disabled tier', () => {
            expect(resolveChosenTierFee(tiers(), 'priority', 3)).toBeNull();
        });
        it('returns null when out of all bands', () => {
            expect(resolveChosenTierFee(tiers(), 'standard', 50)).toBeNull();
        });
    });

    describe('defaultTierKey', () => {
        it('prefers standard when available', () => {
            expect(defaultTierKey(buildDeliveryOptions(tiers(), 3))).toBe(
                'standard',
            );
        });
        it('falls back to first available when no standard', () => {
            const t = tiers();
            t.standard.enabled = false;
            expect(defaultTierKey(buildDeliveryOptions(t, 3))).toBe('saver');
        });
        it('null when nothing available', () => {
            expect(
                defaultTierKey(buildDeliveryOptions(tiers(), 99)),
            ).toBeNull();
        });
    });

    describe('isDeliveryTierKey', () => {
        it('accepts valid keys, rejects junk', () => {
            expect(isDeliveryTierKey('priority')).toBe(true);
            expect(isDeliveryTierKey('express')).toBe(false);
            expect(isDeliveryTierKey(3)).toBe(false);
        });
    });

    describe('validateDeliveryTiers', () => {
        it('passes a well-formed config', () => {
            expect(validateDeliveryTiers(tiers(), true)).toEqual([]);
        });
        it('flags non-ascending bands', () => {
            const t = tiers();
            t.saver.bands = [
                { maxKm: 10, fee: 1 },
                { maxKm: 5, fee: 2 },
            ];
            expect(validateDeliveryTiers(t, true).join()).toMatch(/ascend/);
        });
        it('flags eta min>max and negative fee', () => {
            const t = tiers();
            t.standard.etaMinMinutes = 60;
            t.standard.etaMaxMinutes = 30;
            t.saver.bands = [{ maxKm: 5, fee: -1 }];
            const errs = validateDeliveryTiers(t, true).join();
            expect(errs).toMatch(/ETA min/);
            expect(errs).toMatch(/fee must be/);
        });
        it('requires at least one enabled tier when enabled', () => {
            const t = tiers();
            t.saver.enabled = false;
            t.standard.enabled = false;
            expect(validateDeliveryTiers(t, true).join()).toMatch(
                /At least one tier/,
            );
        });
        it('defaults are internally valid (when toggled on with a tier enabled)', () => {
            const d = { ...DELIVERY_TIER_DEFAULTS };
            d.standard = { ...d.standard, enabled: true };
            expect(validateDeliveryTiers(d, true)).toEqual([]);
        });
    });
});
