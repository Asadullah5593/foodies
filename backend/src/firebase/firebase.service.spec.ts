import {
    BadRequestException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseService } from './firebase.service';

jest.mock('firebase-admin', () => ({
    auth: jest.fn(),
}));

/**
 * Unit tests for the phone-token verification gate. This is the security
 * boundary for the Firebase Phone Auth flows (verify-phone, reset-password):
 * only a valid token from a `phone` sign-in with a phone_number claim may pass.
 */
describe('FirebaseService.verifyPhoneIdToken', () => {
    let service: FirebaseService;
    const verifyIdToken = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (admin.auth as unknown as jest.Mock).mockReturnValue({ verifyIdToken });
        service = new FirebaseService();
        // Simulate a configured Firebase app without running onModuleInit.
        (service as unknown as { firebaseApp: unknown }).firebaseApp = {};
    });

    it('returns the phone number and uid for a valid phone-provider token', async () => {
        verifyIdToken.mockResolvedValue({
            uid: 'abc123',
            phone_number: '+923001234567',
            firebase: { sign_in_provider: 'phone' },
        });

        await expect(service.verifyPhoneIdToken('good-token')).resolves.toEqual(
            {
                phoneNumber: '+923001234567',
                uid: 'abc123',
            },
        );
    });

    it('rejects when Firebase is not configured', async () => {
        (service as unknown as { firebaseApp: unknown }).firebaseApp = null;
        await expect(service.verifyPhoneIdToken('x')).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('rejects an empty token before calling Firebase', async () => {
        await expect(service.verifyPhoneIdToken('  ')).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(verifyIdToken).not.toHaveBeenCalled();
    });

    it('rejects an invalid/expired token', async () => {
        verifyIdToken.mockRejectedValue(new Error('token expired'));
        await expect(
            service.verifyPhoneIdToken('bad-token'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token from a non-phone sign-in provider', async () => {
        verifyIdToken.mockResolvedValue({
            uid: 'abc123',
            phone_number: '+923001234567',
            firebase: { sign_in_provider: 'google.com' },
        });
        await expect(
            service.verifyPhoneIdToken('google-token'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a phone-provider token with no phone_number claim', async () => {
        verifyIdToken.mockResolvedValue({
            uid: 'abc123',
            firebase: { sign_in_provider: 'phone' },
        });
        await expect(
            service.verifyPhoneIdToken('no-phone-token'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });
});
