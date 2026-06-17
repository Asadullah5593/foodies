import { BadRequestException } from '@nestjs/common';
import { assertStars, normalizeOptionalComment } from './ratings.service';

describe('ratings validation helpers', () => {
    it('accepts star range 1..5 and rejects outside values', () => {
        expect(assertStars(1)).toBe(1);
        expect(assertStars(5)).toBe(5);
        expect(() => assertStars(0)).toThrow(BadRequestException);
        expect(() => assertStars(6)).toThrow(BadRequestException);
        expect(() => assertStars(4.5)).toThrow(BadRequestException);
    });

    it('normalizes optional comment and enforces max length', () => {
        expect(normalizeOptionalComment(undefined)).toBeNull();
        expect(normalizeOptionalComment('   ')).toBeNull();
        expect(normalizeOptionalComment(' Great service ')).toBe(
            'Great service',
        );
        expect(() => normalizeOptionalComment(123)).toThrow(
            BadRequestException,
        );
        expect(() => normalizeOptionalComment('a'.repeat(501))).toThrow(
            BadRequestException,
        );
    });
});
