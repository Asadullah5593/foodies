import { normalizeFirebasePrivateKey } from './firebase-credentials.util';

describe('normalizeFirebasePrivateKey', () => {
    it('converts literal \\n to newlines', () => {
        const raw =
            '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';
        expect(normalizeFirebasePrivateKey(raw)).toBe(
            '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
        );
    });

    it('strips wrapping double quotes', () => {
        const raw =
            '"-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----"';
        expect(normalizeFirebasePrivateKey(raw)).toContain('BEGIN PRIVATE KEY');
    });
});
