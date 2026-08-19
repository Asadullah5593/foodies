import { ForbiddenException } from '@nestjs/common';
import {
    DELIVERY_ONLY_PERMISSION,
    assertOrderTypeAllowed,
    isDeliveryOnly,
} from './order-type-restriction';

const withPerms = (permissions: string[]) => ({ permissions });

describe('isDeliveryOnly', () => {
    it('is true only when the marker permission is held', () => {
        expect(isDeliveryOnly(withPerms([DELIVERY_ONLY_PERMISSION]))).toBe(
            true,
        );
        expect(isDeliveryOnly(withPerms(['orders:create']))).toBe(false);
    });

    it('is false for anonymous callers — kiosk and consumer paths carry no actor', () => {
        // Those channels are not role users; the restriction is a till concept.
        expect(isDeliveryOnly(null)).toBe(false);
        expect(isDeliveryOnly(undefined)).toBe(false);
        expect(isDeliveryOnly({ permissions: null })).toBe(false);
    });
});

describe('assertOrderTypeAllowed', () => {
    const restricted = withPerms(['orders:create', DELIVERY_ONLY_PERMISSION]);
    const unrestricted = withPerms(['orders:create']);

    it('lets a delivery-only user place a delivery order', () => {
        expect(() =>
            assertOrderTypeAllowed(restricted, 'delivery'),
        ).not.toThrow();
    });

    it('refuses dine-in and takeaway for a delivery-only user', () => {
        // The exact failure the permission exists to prevent: a call-centre
        // agent punching a dine-in with nobody at the counter to collect it.
        expect(() => assertOrderTypeAllowed(restricted, 'dine_in')).toThrow(
            ForbiddenException,
        );
        expect(() => assertOrderTypeAllowed(restricted, 'takeaway')).toThrow(
            ForbiddenException,
        );
    });

    it('does not restrict a user without the marker', () => {
        for (const t of ['dine_in', 'takeaway', 'delivery']) {
            expect(() => assertOrderTypeAllowed(unrestricted, t)).not.toThrow();
        }
    });

    it('does not restrict an anonymous caller', () => {
        expect(() => assertOrderTypeAllowed(null, 'dine_in')).not.toThrow();
    });
});
