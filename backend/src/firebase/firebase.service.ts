import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
    private readonly logger = new Logger(FirebaseService.name);
    private firebaseApp: admin.app.App | null = null;

    onModuleInit() {
        if (admin.apps.length > 0) {
            this.firebaseApp = admin.apps[0] ?? null;
            return;
        }

        const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
            /\\n/g,
            '\n',
        );

        if (!projectId || !clientEmail || !privateKey) {
            this.logger.warn(
                'Firebase Admin SDK not configured (missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY). Push notifications disabled.',
            );
            return;
        }

        try {
            this.firebaseApp = admin.initializeApp({
                credential: admin.credential.cert({
                    projectId,
                    clientEmail,
                    privateKey,
                }),
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
