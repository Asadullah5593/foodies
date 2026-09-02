/**
 * The form two spellings of one doorstep have in common.
 *
 * "House #5, Street 2" and "house 5 street-2" are the same place; without this
 * they stack up as separate entries and the picker gets longer every time
 * somebody types the address slightly differently.
 *
 * MUST produce byte-identical output to the SQL in migration
 * 1760000000127-CustomerAddresses:
 *
 *   left(btrim(regexp_replace(lower(btrim(addr)), '[^a-z0-9]+', ' ', 'g')), 255)
 *
 * If the two drift, the rows the backfill wrote stop matching what the app
 * writes afterwards, and every backfilled address silently doubles the first
 * time it is reused. `address-key.spec.ts` pins the cases that differ between
 * the two implementations if you get it wrong.
 */
export function normalizeAddressKey(
    address: string | null | undefined,
): string {
    return (
        String(address ?? '')
            .trim()
            .toLowerCase()
            // Postgres [^a-z0-9] is byte-wise on this data; anything not a plain
            // latin letter or digit — punctuation, whitespace, Urdu characters,
            // emoji — collapses to one space, exactly as the SQL does.
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .slice(0, 255)
    );
}
