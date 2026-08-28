import {
    OWN_SOURCE_ONLY_PERMISSION,
    OWN_POS_ONLY_PERMISSION,
    OWN_MOBILE_APP_ONLY_PERMISSION,
    OWN_KIOSK_ONLY_PERMISSION,
    restrictedOrderSources,
} from './order-source-restriction';

/**
 * The markers narrow what `orders:view` returns. Holding none — or holding the
 * channel permission WITHOUT a marker — must leave the view unrestricted: the
 * client hands back the all-sources view by simply removing the permission.
 */
describe('restrictedOrderSources', () => {
    const actor = (...permissions: string[]) => ({ permissions });
    const sorted = (v: string[] | null) => (v ? [...v].sort() : v);

    it('does not restrict an account without any marker', () => {
        expect(restrictedOrderSources(actor('orders:view'))).toBeNull();
    });

    it('does not restrict a call-centre agent who lacks a marker', () => {
        expect(
            restrictedOrderSources(
                actor('orders:view', 'orders:place:call-center'),
            ),
        ).toBeNull();
    });

    it('resolves own-source-only to call_centre for a call-centre agent', () => {
        expect(
            restrictedOrderSources(
                actor(OWN_SOURCE_ONLY_PERMISSION, 'orders:place:call-center'),
            ),
        ).toEqual(['call_centre']);
    });

    it('resolves own-source-only to pos for everyone else', () => {
        expect(
            restrictedOrderSources(actor(OWN_SOURCE_ONLY_PERMISSION)),
        ).toEqual(['pos']);
    });

    it('pins each fixed marker to its channel', () => {
        expect(restrictedOrderSources(actor(OWN_POS_ONLY_PERMISSION))).toEqual([
            'pos',
        ]);
        expect(
            restrictedOrderSources(actor(OWN_MOBILE_APP_ONLY_PERMISSION)),
        ).toEqual(['consumer_app']);
        expect(
            restrictedOrderSources(actor(OWN_KIOSK_ONLY_PERMISSION)),
        ).toEqual(['kiosk']);
    });

    it('is additive: several markers widen the view to their union', () => {
        expect(
            sorted(
                restrictedOrderSources(
                    actor(
                        OWN_POS_ONLY_PERMISSION,
                        OWN_KIOSK_ONLY_PERMISSION,
                        OWN_MOBILE_APP_ONLY_PERMISSION,
                    ),
                ),
            ),
        ).toEqual(['consumer_app', 'kiosk', 'pos']);
    });

    it('de-duplicates when own-source-only overlaps a fixed marker', () => {
        expect(
            restrictedOrderSources(
                actor(OWN_SOURCE_ONLY_PERMISSION, OWN_POS_ONLY_PERMISSION),
            ),
        ).toEqual(['pos']);
    });

    it('treats a missing or empty actor as unrestricted', () => {
        expect(restrictedOrderSources(null)).toBeNull();
        expect(restrictedOrderSources(undefined)).toBeNull();
        expect(restrictedOrderSources({ permissions: null })).toBeNull();
        expect(restrictedOrderSources({ permissions: [] })).toBeNull();
    });
});
