import {
    Injectable,
    Logger,
    OnModuleInit,
    BadRequestException,
    UnauthorizedException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import * as admin from 'firebase-admin';
import { normalizeFirebasePrivateKey } from './firebase-credentials.util';

@Injectable()
export class FirebaseService implements OnModuleInit {
    private readonly logger = new Logger(FirebaseService.name);
    private firebaseApp: admin.app.App | null = null;

    private loadServiceAccountFromPath(
        keyPath: string,
    ): admin.ServiceAccount | null {
        try {
            const raw = readFileSync(keyPath, 'utf8');
            if (keyPath.endsWith('.json') || raw.trimStart().startsWith('{')) {
                const json = JSON.parse(raw) as {
                    project_id?: string;
                    client_email?: string;
                    private_key?: string;
                };
                const privateKey = normalizeFirebasePrivateKey(
                    json.private_key,
                );
                if (!json.project_id || !json.client_email || !privateKey) {
                    this.logger.error(
                        `Invalid Firebase JSON at ${keyPath} (need project_id, client_email, private_key)`,
                    );
                    return null;
                }
                return {
                    projectId: json.project_id,
                    clientEmail: json.client_email,
                    privateKey,
                };
            }
            const privateKey = normalizeFirebasePrivateKey(raw);
            const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
            const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
            if (!projectId || !clientEmail || !privateKey) {
                this.logger.error(
                    `PEM file at ${keyPath} requires FIREBASE_PROJECT_ID and FIREBASE_CLIENT_EMAIL in .env`,
                );
                return null;
            }
            return { projectId, clientEmail, privateKey };
        } catch (error) {
            this.logger.error(
                `Failed to read FIREBASE_PRIVATE_KEY_PATH (${keyPath})`,
                error instanceof Error ? error.stack : error,
            );
            return null;
        }
    }

    private resolveFromEnvVars(): admin.ServiceAccount | null {
        const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
        const privateKey = normalizeFirebasePrivateKey(
            process.env.FIREBASE_PRIVATE_KEY,
        );
        if (!projectId || !clientEmail || !privateKey) return null;
        return { projectId, clientEmail, privateKey };
    }

    private resolveServiceAccount(): admin.ServiceAccount | null {
        const keyPath = process.env.FIREBASE_PRIVATE_KEY_PATH?.trim();
        if (keyPath) {
            const fromFile = this.loadServiceAccountFromPath(keyPath);
            if (fromFile) return fromFile;
            this.logger.warn(
                `Could not load Firebase credentials from ${keyPath}; falling back to FIREBASE_* env vars.`,
            );
        }
        return this.resolveFromEnvVars();
    }

    onModuleInit() {
        if (admin.apps.length > 0) {
            this.firebaseApp = admin.apps[0] ?? null;
            return;
        }

        const serviceAccount = this.resolveServiceAccount();
        if (!serviceAccount) {
            this.logger.warn(
                'Firebase Admin SDK not configured. Set FIREBASE_PRIVATE_KEY_PATH to service-account JSON, or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY. Push notifications disabled.',
            );
            return;
        }

        try {
            this.firebaseApp = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            this.logger.log('Firebase Admin SDK initialized successfully.');
        } catch (error) {
            this.logger.error(
                'Failed to initialize Firebase Admin SDK',
                error instanceof Error ? error.stack : error,
            );
        }
    }

    get isConfigured(): boolean {
        return this.firebaseApp != null;
    }

    get messaging(): admin.messaging.Messaging | null {
        if (!this.firebaseApp) return null;
        return admin.messaging(this.firebaseApp);
    }

    /**
     * Verify a Firebase ID token that MUST come from Phone (SMS) sign-in and
     * return the verified phone number (E.164, e.g. +923001234567) and Firebase
     * uid. Used by the consumer phone-verification and password-reset flows so
     * Firebase handles SMS dispatch/OTP entry while we only trust a signed,
     * server-verified token — never a client "phone verified" claim.
     *
     * Rejects (401) tokens that are invalid/expired, from a different Firebase
     * project, from any non-phone provider (Google, anonymous, email/password),
     * or that carry no phone_number claim.
     */
    async verifyPhoneIdToken(
        idToken: string,
    ): Promise<{ phoneNumber: string; uid: string }> {
        if (!this.firebaseApp) {
            throw new ServiceUnavailableException(
                'Firebase is not configured on this server',
            );
        }
        const token = typeof idToken === 'string' ? idToken.trim() : '';
        if (!token) {
            throw new BadRequestException('id_token is required');
        }
        let decoded: admin.auth.DecodedIdToken;
        try {
            // checkRevoked=false: OTP tokens are short-lived and single-use here.
            decoded = await admin.auth(this.firebaseApp).verifyIdToken(token);
        } catch (err) {
            this.logger.warn(
                `Firebase ID token verification failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw new UnauthorizedException('Invalid or expired token');
        }
        // Guard against tokens minted by any other sign-in method — only an SMS
        // phone verification proves ownership of the number.
        if (decoded.firebase?.sign_in_provider !== 'phone') {
            throw new UnauthorizedException('Token is not from phone sign-in');
        }
        const phoneNumber =
            typeof decoded.phone_number === 'string'
                ? decoded.phone_number
                : '';
        if (!phoneNumber) {
            throw new UnauthorizedException(
                'Token has no verified phone number',
            );
        }
        return { phoneNumber, uid: decoded.uid };
    }

    get firestore(): admin.firestore.Firestore | null {
        if (!this.firebaseApp) return null;
        return admin.firestore(this.firebaseApp);
    }
}
