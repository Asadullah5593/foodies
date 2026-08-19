import { ForbiddenException } from '@nestjs/common';
import {
    NO_CANCEL_PERMISSION,
    assertStatusChangeAllowed,
    isNoCancel,
} from './order-status-restriction';

const FLOW = ['placed', 'accepted', 'preparing', 'ready', 'completed'];

describe('orders:update-status:no-cancel', () => {
    const restricted = { permissions: [NO_CANCEL_PERMISSION] };
    const normal = { permissions: ['orders:update-status'] };

    it.each(FLOW)('lets a restricted account set %s', (status) => {
        expect(() =>
            assertStatusChangeAllowed(restricted, status),
        ).not.toThrow();
    });

    it('refuses cancelled for a restricted account', () => {
        expect(() =>
            assertStatusChangeAllowed(restricted, 'cancelled'),
        ).toThrow(ForbiddenException);
    });

    it('the restriction wins when BOTH permissions are held', () => {
        const both = {
            permissions: ['orders:update-status', NO_CANCEL_PERMISSION],
        };
        expect(() => assertStatusChangeAllowed(both, 'cancelled')).toThrow(
            ForbiddenException,
        );
        // ...but the rest of the flow still works.
        expect(() => assertStatusChangeAllowed(both, 'ready')).not.toThrow();
    });

    it.each(['CANCELLED', ' cancelled ', 'Cancelled'])(
        'refuses %p — casing and padding must not slip past',
        (status) => {
            expect(() => assertStatusChangeAllowed(restricted, status)).toThrow(
                ForbiddenException,
            );
        },
    );

    it('leaves an unrestricted account alone, cancel included', () => {
        for (const status of [...FLOW, 'cancelled']) {
            expect(() =>
                assertStatusChangeAllowed(normal, status),
            ).not.toThrow();
        }
    });

    it.each([null, undefined, {}, { permissions: null }, { permissions: [] }])(
        'treats %p as unrestricted',
        (actor) => {
            expect(isNoCancel(actor as never)).toBe(false);
            expect(() =>
                assertStatusChangeAllowed(actor as never, 'cancelled'),
            ).not.toThrow();
        },
    );
});
