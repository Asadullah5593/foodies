import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

    get firestore(): admin.firestore.Firestore | null {
        if (!this.firebaseApp) return null;
        return admin.firestore(this.firebaseApp);
    }
}
