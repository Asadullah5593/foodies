/**
 * Permissions that NARROW what an account may do rather than granting access.
 *
 * They break the usual rule that more permissions means more power, which makes
 * them dangerous to hand out in bulk: the seed grants the Owner and Super Admin
 * roles every row in `permissions`, and sweeping a restriction into that grant
 * would restrict the very accounts meant to be unrestricted — an owner who
 * cannot cancel an order, or whose POS orders are all tagged as call-centre.
 *
 * So `seed.ts` excludes these from its grant-all. They are assigned by hand,
 * from the Roles screen, to exactly the accounts that should carry them.
 */
export const RESTRICTION_PERMISSIONS: string[] = [
    // Tags this user's POS orders as source=call_centre.
    'orders:place:call-center',
    // May punch delivery orders only; dine-in and takeaway are refused.
    'orders:create:delivery-only',
    // May work the status flow but never cancel.
    'orders:update-status:no-cancel',
    // Hides the Orders page "Page value" money total.
    'orders:view:no-totals',
];

/** SQL fragment: `name NOT IN ('a', 'b', …)`. Values are literal constants. */
export function restrictionExclusionSql(column = 'name'): string {
    const list = RESTRICTION_PERMISSIONS.map((p) => `'${p}'`).join(', ');
    return `${column} NOT IN (${list})`;
}
