import { getStaffTokenTtl } from './jwt-secret.util';

/**
 * A token is the only thing between a leaked laptop and the till: there is no
 * refresh flow and no revocation list, so whatever this returns is exactly how
 * long a compromised — or deactivated — session stays alive.
 */
describe('getStaffTokenTtl', () => {
    const original = process.env.JWT_EXPIRES_IN;
    afterEach(() => {
        if (original === undefined) delete process.env.JWT_EXPIRES_IN;
        else process.env.JWT_EXPIRES_IN = original;
    });

    it('defaults to a day, not the old week', () => {
        delete process.env.JWT_EXPIRES_IN;
        expect(getStaffTokenTtl()).toBe('24h');
    });

    it('treats an empty or blank value as unset rather than as no expiry', () => {
        process.env.JWT_EXPIRES_IN = '';
        expect(getStaffTokenTtl()).toBe('24h');
        process.env.JWT_EXPIRES_IN = '   ';
        expect(getStaffTokenTtl()).toBe('24h');
    });

    it('takes a valid override', () => {
        for (const v of ['30m', '8h', '24h', '7d', '3600s']) {
            process.env.JWT_EXPIRES_IN = v;
            expect(getStaffTokenTtl()).toBe(v);
        }
    });

    it('refuses anything jsonwebtoken would read as "never expires"', () => {
        // '0' and 'never' are the dangerous ones: jsonwebtoken would take a bare
        // number as seconds and garbage as no expiry at all.
        for (const bad of ['never', '0', 'forever', '24 h', '24hours', '-1d', 'abc']) {
            process.env.JWT_EXPIRES_IN = bad;
            expect(() => getStaffTokenTtl()).toThrow(/JWT_EXPIRES_IN/);
        }
    });
});
