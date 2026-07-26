import { ForbiddenException } from '@nestjs/common';
import { assertShiftCloseAllowed } from './shifts.service';

describe('assertShiftCloseAllowed (opener-only close + shifts:override)', () => {
    it('lets the opener close their own shift', () => {
        expect(() => assertShiftCloseAllowed(7, 7, false)).not.toThrow();
    });

    it('rejects a different user without the override', () => {
        expect(() => assertShiftCloseAllowed(7, 8, false)).toThrow(
            ForbiddenException,
        );
    });

    it('lets an override holder close a shift opened by someone else', () => {
        expect(() => assertShiftCloseAllowed(7, 8, true)).not.toThrow();
    });

    it('override also covers closing your own shift', () => {
        expect(() => assertShiftCloseAllowed(7, 7, true)).not.toThrow();
    });

    it('rejects an unknown closer identity without the override', () => {
        expect(() => assertShiftCloseAllowed(7, null, false)).toThrow(
            ForbiddenException,
        );
        expect(() => assertShiftCloseAllowed(7, undefined, false)).toThrow(
            ForbiddenException,
        );
    });
});
