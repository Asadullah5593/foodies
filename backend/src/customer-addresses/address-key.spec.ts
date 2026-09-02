import { normalizeAddressKey } from './address-key';

/**
 * These cases exist to be run against Postgres too — the SQL in migration 127
 * must return the same string for every one of them. If it does not, the
 * backfilled rows and the rows the app writes later stop matching, and each
 * backfilled address quietly becomes two.
 */
export const ADDRESS_KEY_CASES: Array<[string, string]> = [
    ['House #5, Street 2, DHA Phase 5', 'house 5 street 2 dha phase 5'],
    ['house 5 street-2 dha phase 5', 'house 5 street 2 dha phase 5'],
    [
        '  HOUSE   5 ,, street 2 , DHA   phase 5  ',
        'house 5 street 2 dha phase 5',
    ],
    ['Flat 12/B, Block-C', 'flat 12 b block c'],
    ['12 Main Boulevard.', '12 main boulevard'],
    ['...', ''],
    ['', ''],
];

describe('normalizeAddressKey', () => {
    it.each(ADDRESS_KEY_CASES)('normalises %j', (input, expected) => {
        expect(normalizeAddressKey(input)).toBe(expected);
    });

    it('collapses every kind of separator to one space', () => {
        expect(normalizeAddressKey('a,b;c/d-e_f  g')).toBe('a b c d e f g');
    });

    it('trims the space punctuation leaves at either end', () => {
        // The regex turns leading/trailing punctuation into a space; without
        // the second trim the key would differ from the SQL's btrim.
        expect(normalizeAddressKey(',House 5,')).toBe('house 5');
        expect(normalizeAddressKey('#5 St 2 ...')).toBe('5 st 2');
    });

    it('survives null and undefined rather than throwing mid-order', () => {
        expect(normalizeAddressKey(null)).toBe('');
        expect(normalizeAddressKey(undefined)).toBe('');
    });

    it('never exceeds the column width', () => {
        expect(normalizeAddressKey('x'.repeat(400))).toHaveLength(255);
    });

    it('treats two different doorsteps as different', () => {
        expect(normalizeAddressKey('House 5, Street 2')).not.toBe(
            normalizeAddressKey('House 6, Street 2'),
        );
    });
});
