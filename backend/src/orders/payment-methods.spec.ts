import {
    ORDER_PAYMENT_METHOD_FILTERS,
    isOrderPaymentMethodFilter,
} from './payment-methods';

describe('order payment-method filter whitelist', () => {
    // The values the Orders page offers in its "Payment type" select. Kept here
    // deliberately: a dropdown option the server does not accept is silently
    // dropped, and a dropped filter returns every order instead of none.
    const OPTIONS_OFFERED_BY_THE_UI = [
        'cash',
        'card',
        'online_transfer',
        'cod',
    ];

    it.each(OPTIONS_OFFERED_BY_THE_UI)(
        'accepts %s, which the Orders page offers',
        (method) => {
            expect(isOrderPaymentMethodFilter(method)).toBe(true);
        },
    );

    it('regression: cod is filterable — it used to be dropped, so COD showed every order', () => {
        expect(ORDER_PAYMENT_METHOD_FILTERS).toContain('cod');
    });

    it.each([undefined, null, '', 'CASH', 'bogus', "cash' OR 1=1--"])(
        'rejects %p',
        (value) => {
            expect(isOrderPaymentMethodFilter(value)).toBe(false);
        },
    );
});
