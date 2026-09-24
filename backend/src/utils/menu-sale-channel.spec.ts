import { BadRequestException } from '@nestjs/common';
import { normalizeMenuSaleChannels } from './menu-sale-channel';

describe('normalizeMenuSaleChannels', () => {
    it('keeps a genuine subset, in canonical order', () => {
        expect(normalizeMenuSaleChannels(['app', 'pos'])).toEqual([
            'pos',
            'app',
        ]);
        expect(normalizeMenuSaleChannels(['pos'])).toEqual(['pos']);
    });

    it('collapses "no restriction" to null so it has one representation', () => {
        expect(normalizeMenuSaleChannels(null)).toBeNull();
        expect(normalizeMenuSaleChannels(undefined)).toBeNull();
        expect(normalizeMenuSaleChannels([])).toBeNull();
        expect(
            normalizeMenuSaleChannels(['pos', 'app', 'web', 'kiosk']),
        ).toBeNull();
    });

    it('is case and whitespace insensitive, and dedupes', () => {
        expect(normalizeMenuSaleChannels([' POS ', 'pos', 'App'])).toEqual([
            'pos',
            'app',
        ]);
    });

    it('rejects a non-empty list naming nothing valid, rather than widening reach', () => {
        expect(() => normalizeMenuSaleChannels(['tiktok'])).toThrow(
            BadRequestException,
        );
    });

    it('drops unknown entries when at least one is valid', () => {
        expect(normalizeMenuSaleChannels(['pos', 'tiktok'])).toEqual(['pos']);
    });

    it('rejects a non-array', () => {
        expect(() => normalizeMenuSaleChannels('pos')).toThrow(
            BadRequestException,
        );
    });
});
