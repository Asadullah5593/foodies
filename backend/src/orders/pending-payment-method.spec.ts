import { pendingPaymentMethod } from './settle-on-complete';

/**
 * The tender an order is due to be paid by before any money is recorded. The
 * admin list and detail read it so a consumer-app order says "COD" from the
 * moment it arrives; completion records the same 'cod' tender by this rule.
 */
describe('pendingPaymentMethod', () => {
    it('is cod for an untendered consumer-app order with money owed', () => {
        expect(
            pendingPaymentMethod(
                { source: 'consumer_app', totalAmount: 1680.84 },
                false,
            ),
        ).toBe('cod');
        expect(
            pendingPaymentMethod(
                { source: 'consumer_app', totalAmount: '709.00' },
                false,
            ),
        ).toBe('cod');
    });

    it('is unknown once anything has been tendered', () => {
        expect(
            pendingPaymentMethod(
                { source: 'consumer_app', totalAmount: 1680.84 },
                true,
            ),
        ).toBeNull();
    });

    it('is unknown for sources that tender at placement or through the gateway', () => {
        for (const source of ['pos', 'call_centre', 'kiosk', 'consumer_web']) {
            expect(
                pendingPaymentMethod({ source, totalAmount: 500 }, false),
            ).toBeNull();
        }
        expect(pendingPaymentMethod({ totalAmount: 500 }, false)).toBeNull();
    });

    it('is unknown when nothing is owed', () => {
        expect(
            pendingPaymentMethod(
                { source: 'consumer_app', totalAmount: 0 },
                false,
            ),
        ).toBeNull();
        expect(
            pendingPaymentMethod(
                { source: 'consumer_app', totalAmount: null },
                false,
            ),
        ).toBeNull();
    });
});
