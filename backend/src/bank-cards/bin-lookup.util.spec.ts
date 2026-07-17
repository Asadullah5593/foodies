import { BankCard } from '../entities/bank-card.entity';
import {
    normalizeBin,
    matchedBinPrefix,
    matchCardsByBin,
} from './bin-lookup.util';

const card = (id: number, binPrefixes: string[] | null): BankCard =>
    ({ id, name: `Card ${id}`, binPrefixes }) as BankCard;

describe('normalizeBin', () => {
    it('keeps digits only and caps at 8', () => {
        expect(normalizeBin(' 4556-7012-34 ')).toBe('45567012');
        expect(normalizeBin('455670')).toBe('455670');
        expect(normalizeBin(null)).toBe('');
        expect(normalizeBin('abc')).toBe('');
    });
});

describe('matchedBinPrefix', () => {
    it('matches when the entry starts with a stored prefix', () => {
        expect(matchedBinPrefix('45567012', ['455670'])).toBe('455670');
    });

    it('matches when a stored prefix starts with the (shorter) entry', () => {
        expect(matchedBinPrefix('4556', ['45567012'])).toBe('45567012');
    });

    it('returns null when nothing matches', () => {
        expect(matchedBinPrefix('999999', ['455670', '52841'])).toBeNull();
        expect(matchedBinPrefix('455670', null)).toBeNull();
        expect(matchedBinPrefix('455670', [])).toBeNull();
    });

    it('normalizes stored prefixes before comparing', () => {
        expect(matchedBinPrefix('455670', ['4556-70'])).toBe('455670');
    });

    it('never matches on an empty entry', () => {
        expect(matchedBinPrefix('', ['455670'])).toBeNull();
    });
});

describe('matchCardsByBin', () => {
    it('returns every matching card with its matched prefix', () => {
        const cards = [
            card(1, ['455670']),
            card(2, ['528410', '455670']),
            card(3, ['601100']),
            card(4, null),
        ];
        const hits = matchCardsByBin('45567012', cards);
        expect(hits.map((h) => h.card.id)).toEqual([1, 2]);
        expect(hits[0].matchedPrefix).toBe('455670');
    });

    it('returns empty when no card carries the BIN', () => {
        expect(matchCardsByBin('411111', [card(1, ['455670'])])).toEqual([]);
    });
});
