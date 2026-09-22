import {
    normalizeOfferOrderTypes,
    orderTypeToOfferOrderType,
} from './offer-validity.util';
import { offerAllowedOnOrderType } from './offer-preview.util';

describe('orderTypeToOfferOrderType', () => {
    it('folds POS takeaway onto pickup, the same as consumer web', () => {
        expect(orderTypeToOfferOrderType('takeaway')).toBe('pickup');
        expect(orderTypeToOfferOrderType('pickup')).toBe('pickup');
    });

    it('is case and whitespace insensitive', () => {
        expect(orderTypeToOfferOrderType('  DELIVERY ')).toBe('delivery');
        expect(orderTypeToOfferOrderType('Dine_In')).toBe('dine_in');
    });

    it('returns null for anything it does not recognise', () => {
        expect(orderTypeToOfferOrderType('drive_thru')).toBeNull();
        expect(orderTypeToOfferOrderType('')).toBeNull();
        expect(orderTypeToOfferOrderType(null)).toBeNull();
        expect(orderTypeToOfferOrderType(undefined)).toBeNull();
    });
});

describe('normalizeOfferOrderTypes', () => {
    it('stores a genuine subset', () => {
        expect(normalizeOfferOrderTypes(['delivery'])).toEqual(['delivery']);
        expect(normalizeOfferOrderTypes(['dine_in', 'delivery'])).toEqual([
            'delivery',
            'dine_in',
        ]);
    });

    it('collapses "all three" to null so no restriction has one representation', () => {
        expect(
            normalizeOfferOrderTypes(['delivery', 'pickup', 'dine_in']),
        ).toBeNull();
    });

    it('collapses empty, non-array and all-invalid input to null', () => {
        expect(normalizeOfferOrderTypes([])).toBeNull();
        expect(normalizeOfferOrderTypes(null)).toBeNull();
        expect(normalizeOfferOrderTypes('delivery')).toBeNull();
        expect(normalizeOfferOrderTypes(['drive_thru'])).toBeNull();
    });

    it('dedupes takeaway and pickup into a single entry', () => {
        expect(normalizeOfferOrderTypes(['takeaway', 'pickup'])).toEqual([
            'pickup',
        ]);
    });

    it('drops unknown entries but keeps the valid ones', () => {
        expect(normalizeOfferOrderTypes(['delivery', 'drive_thru'])).toEqual([
            'delivery',
        ]);
    });
});

describe('offerAllowedOnOrderType', () => {
    it('lets an unrestricted offer through on any order type', () => {
        expect(offerAllowedOnOrderType(null, 'delivery')).toBe(true);
        expect(offerAllowedOnOrderType([], 'dine_in')).toBe(true);
        expect(offerAllowedOnOrderType(undefined, null)).toBe(true);
    });

    it('allows only the listed order types', () => {
        expect(offerAllowedOnOrderType(['delivery'], 'delivery')).toBe(true);
        expect(offerAllowedOnOrderType(['delivery'], 'pickup')).toBe(false);
        expect(offerAllowedOnOrderType(['delivery'], 'dine_in')).toBe(false);
    });

    it('refuses a restricted offer when the order type is unknown, so a preview never over-promises', () => {
        expect(offerAllowedOnOrderType(['delivery'], null)).toBe(false);
    });
});
