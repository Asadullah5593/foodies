/**
 * MARKER permissions in the `orders:create:delivery-only` family: holding one
 * grants nothing, it NARROWS what `orders:view` returns to the channels the
 * role is allowed to read.
 *
 *  - `own-source-only`      → the account's OWN channel, resolved the way order
 *                             tagging is: `call_centre` when the account also
 *                             holds `orders:place:call-center`, else `pos`.
 *  - `own-pos-only`         → POS orders
 *  - `own-mobile-app-only`  → mobile-app orders
 *  - `own-kiosk-only`       → kiosk orders
 *
 * Holding several is additive — pos + kiosk sees both — so a role can be shaped
 * to any subset of channels. Holding none leaves the view unrestricted, which
 * is what makes this reversible: remove the permission and the role gets the
 * full all-sources view back. Granted to no role by the migration.
 */
export const OWN_SOURCE_ONLY_PERMISSION = 'orders:view:own-source-only';
export const OWN_POS_ONLY_PERMISSION = 'orders:view:own-pos-only';
export const OWN_MOBILE_APP_ONLY_PERMISSION = 'orders:view:own-mobile-app-only';
export const OWN_KIOSK_ONLY_PERMISSION = 'orders:view:own-kiosk-only';

/** Same constant the POS controller tags order sources with. */
const CALL_CENTRE_PLACE_PERMISSION = 'orders:place:call-center';

/** Fixed channel per marker; `own-source-only` is resolved from the actor. */
const FIXED_SOURCE_MARKERS: ReadonlyArray<readonly [string, string]> = [
    [OWN_POS_ONLY_PERMISSION, 'pos'],
    [OWN_MOBILE_APP_ONLY_PERMISSION, 'consumer_app'],
    [OWN_KIOSK_ONLY_PERMISSION, 'kiosk'],
];

/**
 * The order sources this actor may read, or null when unrestricted. Callers
 * apply it as a hard filter on list queries and a not-found guard on detail
 * reads (not-found, not forbidden — the restriction must not confirm that an
 * order outside the allowed channels exists).
 */
export function restrictedOrderSources(
    actor: { permissions?: string[] | null } | null | undefined,
): string[] | null {
    const perms = actor?.permissions ?? null;
    if (!perms?.length) return null;
    const sources = new Set<string>();
    if (perms.includes(OWN_SOURCE_ONLY_PERMISSION)) {
        sources.add(
            perms.includes(CALL_CENTRE_PLACE_PERMISSION)
                ? 'call_centre'
                : 'pos',
        );
    }
    for (const [permission, source] of FIXED_SOURCE_MARKERS) {
        if (perms.includes(permission)) sources.add(source);
    }
    return sources.size ? [...sources] : null;
}
