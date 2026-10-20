import { Injectable, Logger } from '@nestjs/common';
import type * as admin from 'firebase-admin';
import { FirebaseService } from '../firebase/firebase.service';

/** The Android channel the app registers; anything else is not shown. */
export const ANDROID_CHANNEL = 'foodies_notifications';
/** Tag / collapse id shared by promos that replace the previous one. */
const PROMO_COLLAPSE_KEY = 'foodies-promo';
/** FCM accepts at most 500 messages per sendEach call. */
export const FCM_BATCH = 500;

/** Firebase error codes that mean the phone will never receive again. */
const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);

export interface OutgoingPush {
    token: string;
    title: string;
    body: string;
}

export interface PushOptions {
    messageId: number | null;
    imageUrl: string | null;
    expiryHours: number;
    replacePrevious: boolean;
}

export interface PushResult {
    token: string;
    ok: boolean;
    dead: boolean;
    error: string | null;
}

/**
 * Sends promo pushes in the shape the live app already handles. No `screen`
 * in `data`, so tapping one just opens the app (confirmed safe by the mobile
 * developer for every app state). Android needs the app's channel id; the
 * image shows on Android only; there is deliberately no iOS badge for promos.
 */
@Injectable()
export class PushSenderService {
    private readonly logger = new Logger(PushSenderService.name);

    constructor(private readonly firebase: FirebaseService) {}

    get isConfigured(): boolean {
        return this.firebase.messaging != null;
    }

    buildMessage(
        push: OutgoingPush,
        opts: PushOptions,
        now = new Date(),
    ): admin.messaging.Message {
        const ttlMs = opts.expiryHours * 3_600_000;
        const image = opts.imageUrl ? { imageUrl: opts.imageUrl } : {};
        const data: Record<string, string> = { kind: 'promo' };
        if (opts.messageId != null) {
            data.push_message_id = String(opts.messageId);
        }
        return {
            token: push.token,
            notification: { title: push.title, body: push.body, ...image },
            data,
            android: {
                priority: 'normal',
                ttl: ttlMs,
                ...(opts.replacePrevious
                    ? { collapseKey: PROMO_COLLAPSE_KEY }
                    : {}),
                notification: {
                    channelId: ANDROID_CHANNEL,
                    sound: 'default',
                    ...image,
                    ...(opts.replacePrevious
                        ? { tag: PROMO_COLLAPSE_KEY }
                        : {}),
                },
            },
            apns: {
                headers: {
                    'apns-expiration': String(
                        Math.floor((now.getTime() + ttlMs) / 1000),
                    ),
                    ...(opts.replacePrevious
                        ? { 'apns-collapse-id': PROMO_COLLAPSE_KEY }
                        : {}),
                },
                payload: {
                    aps: {
                        alert: { title: push.title, body: push.body },
                        sound: 'default',
                    },
                },
            },
        };
    }

    /**
     * Send one batch (at most FCM_BATCH). Never throws: a Firebase outage
     * comes back as every message failed with the reason.
     */
    async sendBatch(
        pushes: OutgoingPush[],
        opts: PushOptions,
    ): Promise<PushResult[]> {
        if (pushes.length === 0) return [];
        const messaging = this.firebase.messaging;
        if (!messaging) {
            return pushes.map((p) => ({
                token: p.token,
                ok: false,
                dead: false,
                error: 'Firebase is not configured on this server',
            }));
        }
        const now = new Date();
        try {
            const response = await messaging.sendEach(
                pushes.map((p) => this.buildMessage(p, opts, now)),
            );
            return response.responses.map((r, i) => {
                const code = r.error?.code ?? null;
                return {
                    token: pushes[i].token,
                    ok: r.success,
                    dead: code != null && DEAD_TOKEN_CODES.has(code),
                    error: r.success
                        ? null
                        : (code ?? r.error?.message ?? 'unknown error'),
                };
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.error(`FCM sendEach failed: ${message}`);
            return pushes.map((p) => ({
                token: p.token,
                ok: false,
                dead: false,
                error: message,
            }));
        }
    }
}
