import { ForbiddenException } from '@nestjs/common';
import {
    DELIVERY_ONLY_PERMISSION,
    DINE_IN_ONLY_PERMISSION,
    TAKEAWAY_ONLY_PERMISSION,
    allowedOrderTypes,
    assertOrderTypeAllowed,
    isDeliveryOnly,
} from './order-type-restriction';

const withPerms = (permissions: string[]) => ({ permissions });
const sorted = (s: Set<string> | null) => (s ? [...s].sort() : s);

describe('isDeliveryOnly', () => {
    it('is true only when the delivery marker is held', () => {
        expect(isDeliveryOnly(withPerms([DELIVERY_ONLY_PERMISSION]))).toBe(
            true,
        );
        expect(isDeliveryOnly(withPerms(['orders:create']))).toBe(false);
    });

    it('is false for anonymous callers — kiosk and consumer paths carry no actor', () => {
        expect(isDeliveryOnly(null)).toBe(false);
        expect(isDeliveryOnly(undefined)).toBe(false);
        expect(isDeliveryOnly({ permissions: null })).toBe(false);
    });
});

describe('allowedOrderTypes', () => {
    it('is unrestricted (null) without any marker, and for anonymous callers', () => {
        expect(allowedOrderTypes(withPerms(['orders:create']))).toBeNull();
        expect(allowedOrderTypes(null)).toBeNull();
        expect(allowedOrderTypes({ permissions: [] })).toBeNull();
    });

    it('maps each marker to its own type, alone', () => {
        expect(
            sorted(allowedOrderTypes(withPerms([DELIVERY_ONLY_PERMISSION]))),
        ).toEqual(['delivery']);
        expect(
            sorted(allowedOrderTypes(withPerms([DINE_IN_ONLY_PERMISSION]))),
        ).toEqual(['dine_in']);
        // takeaway admits the consumer channels' stored alias too
        expect(
            sorted(allowedOrderTypes(withPerms([TAKEAWAY_ONLY_PERMISSION]))),
        ).toEqual(['pickup', 'takeaway']);
    });

    it('adds up: delivery + takeaway = both, no dine-in', () => {
        expect(
            sorted(
                allowedOrderTypes(
                    withPerms([
                        DELIVERY_ONLY_PERMISSION,
                        TAKEAWAY_ONLY_PERMISSION,
                    ]),
                ),
            ),
        ).toEqual(['delivery', 'pickup', 'takeaway']);
    });
});

describe('assertOrderTypeAllowed', () => {
    const deliveryOnly = withPerms(['orders:create', DELIVERY_ONLY_PERMISSION]);
    const takeawayAndDelivery = withPerms([
        'orders:create',
        DELIVERY_ONLY_PERMISSION,
        TAKEAWAY_ONLY_PERMISSION,
    ]);
    const unrestricted = withPerms(['orders:create']);

    it('lets a delivery-only user place a delivery order', () => {
        expect(() =>
            assertOrderTypeAllowed(deliveryOnly, 'delivery'),
        ).not.toThrow();
    });

    it('refuses dine-in and takeaway for a delivery-only user — unchanged behaviour', () => {
        expect(() => assertOrderTypeAllowed(deliveryOnly, 'dine_in')).toThrow(
            ForbiddenException,
        );
        expect(() => assertOrderTypeAllowed(deliveryOnly, 'takeaway')).toThrow(
            ForbiddenException,
        );
    });

    it('a takeaway + delivery account may place both, but not dine-in', () => {
        expect(() =>
            assertOrderTypeAllowed(takeawayAndDelivery, 'takeaway'),
        ).not.toThrow();
        expect(() =>
            assertOrderTypeAllowed(takeawayAndDelivery, 'delivery'),
        ).not.toThrow();
        expect(() =>
            assertOrderTypeAllowed(takeawayAndDelivery, 'dine_in'),
        ).toThrow(/takeaway and delivery orders only/);
    });

    it('does not restrict a user without a marker', () => {
        for (const t of ['dine_in', 'takeaway', 'delivery']) {
            expect(() => assertOrderTypeAllowed(unrestricted, t)).not.toThrow();
        }
    });

    it('does not restrict an anonymous caller', () => {
        expect(() => assertOrderTypeAllowed(null, 'dine_in')).not.toThrow();
    });
});
