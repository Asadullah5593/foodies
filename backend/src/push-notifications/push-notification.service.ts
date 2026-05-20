import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { Order } from '../entities/order.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { OrderPushType, RiderPushScreen } from './push-notification.types';

const CONSUMER_SOURCES = new Set(['consumer_app', 'consumer_web']);

const STATUS_MESSAGES: Record<
    OrderPushType,
    { title: string; body: (orderId: number) => string }
> = {
    kitchen_accepted: {
        title: 'Chef is on it! 🍳',
        body: (orderId) =>
            `Your order #${orderId} has been accepted and is being prepared.`,
    },
    rider_assigned: {
        title: 'Rider assigned! 🛵',
        body: (orderId) =>
            `A rider is heading to pick up your order #${orderId}.`,
    },
    picked_up: {
        title: 'Rider is on the way! 🛵',
        body: () =>
            'Your hot food from Foodies is picked up and headed to you!',
    },
    delivered: {
        title: 'Delivered! Bon Appétit 🎉',
        body: () =>
            "Enjoy your delicious meal! Don't forget to rate your rider.",
    },
    cancelled: {
        title: 'Order Status Update ⚠️',
        body: (orderId) =>
            `Your order #${orderId} was cancelled. Check details or contact support.`,
    },
};

@Injectable()
export class PushNotificationService {
    private readonly logger = new Logger(PushNotificationService.name);

    constructor(private readonly firebase: FirebaseService) {}

    /**
     * Fire-and-forget consumer push for a saved order (never throws).
     */
    notifyConsumerOrder(order: Order, type: OrderPushType): void {
        void this.sendOrderUpdateSafe(order, type);
    }

    /**
     * Notify assigned rider (users/{riderUserId}/tokens). Default: open order detail.
     */
    notifyRiderNewAssignment(
        order: Order,
        screen: RiderPushScreen = 'rider_order_detail',
    ): void {
        void this.sendRiderAssignmentSafe(order, screen);
    }

    private async sendOrderUpdateSafe(
        order: Order,
        type: OrderPushType,
    ): Promise<void> {
        try {
            await this.sendOrderUpdate(order, type);
        } catch (error) {
            this.logger.error(
                `Push notification failed for order ${order.id} (${type})`,
                error instanceof Error ? error.stack : error,
            );
        }
    }

    private shouldNotify(order: Order): boolean {
        if (order.customerId == null) return false;
        if (!CONSUMER_SOURCES.has(order.source)) return false;
        return true;
    }

    async getUserTokens(userId: number, label = 'user'): Promise<string[]> {
        const firestore = this.firebase.firestore;
        if (!firestore) return [];

        try {
            const snapshot = await firestore
                .collection('users')
                .doc(String(userId))
                .collection('tokens')
                .get();

            if (snapshot.empty) {
                this.logger.warn(
                    `No notification tokens found for ${label}: ${userId}`,
                );
                return [];
            }

            return snapshot.docs.map((doc) => doc.id);
        } catch (error) {
            this.logger.error(
                `Error fetching tokens for ${label} ${userId}`,
                error instanceof Error ? error.stack : error,
            );
            return [];
        }
    }

    async getCustomerTokens(customerId: number): Promise<string[]> {
        return this.getUserTokens(customerId, 'customer');
    }

    async sendOrderUpdate(order: Order, type: OrderPushType): Promise<void> {
        if (!this.shouldNotify(order)) return;

        const messaging = this.firebase.messaging;
        if (!messaging) return;

        const customerId = order.customerId!;
        const tokens = await this.getCustomerTokens(customerId);
        if (tokens.length === 0) return;

        const msgConfig = STATUS_MESSAGES[type];
        if (!msgConfig) {
            this.logger.warn(`Unknown push type: ${type}`);
            return;
        }

        const body = msgConfig.body(order.id);
        const messagePayload: admin.messaging.MulticastMessage = {
            tokens,
            notification: {
                title: msgConfig.title,
                body,
            },
            data: {
                screen: 'order_tracking',
                orderId: String(order.id),
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'foodies_notifications',
                    sound: 'default',
                },
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: msgConfig.title,
                            body,
                        },
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        };

        const response = await messaging.sendEachForMulticast(messagePayload);
        this.logger.log(
            `FCM multicast order ${order.id} (${type}): ${response.successCount} succeeded, ${response.failureCount} failed.`,
        );

        if (response.failureCount > 0) {
            const tokensToRemove: string[] = [];
            response.responses.forEach((res, index) => {
                if (!res.success && res.error) {
                    const errorCode = res.error.code;
                    if (
                        errorCode ===
                            'messaging/registration-token-not-registered' ||
                        errorCode === 'messaging/invalid-registration-token'
                    ) {
                        tokensToRemove.push(tokens[index]);
                    }
                }
            });
            if (tokensToRemove.length > 0) {
                await this.removeStaleTokens(customerId, tokensToRemove);
            }
        }
    }

    private async sendRiderAssignmentSafe(
        order: Order,
        screen: RiderPushScreen,
    ): Promise<void> {
        try {
            await this.sendRiderAssignment(order, screen);
        } catch (error) {
            this.logger.error(
                `Rider push failed for order ${order.id} (rider ${order.riderId})`,
                error instanceof Error ? error.stack : error,
            );
        }
    }

    private shouldNotifyRider(order: Order): boolean {
        return (
            order.orderType === 'delivery' &&
            order.riderId != null &&
            order.riderId > 0
        );
    }

    async sendRiderAssignment(
        order: Order,
        screen: RiderPushScreen = 'rider_order_detail',
    ): Promise<void> {
        if (!this.shouldNotifyRider(order)) return;

        const messaging = this.firebase.messaging;
        if (!messaging) return;

        const riderUserId = order.riderId!;
        const tokens = await this.getUserTokens(riderUserId, 'rider');
        if (tokens.length === 0) return;

        const title = 'New Order Assigned 🏍️';
        const body =
            screen === 'rider_order_detail'
                ? `You have been assigned order #${order.id}. Tap to view details.`
                : 'You have been assigned a new order.';

        const data: Record<string, string> = { screen };
        if (screen === 'rider_order_detail') {
            data.orderId = String(order.id);
        }

        const messagePayload: admin.messaging.MulticastMessage = {
            tokens,
            notification: { title, body },
            data,
            android: {
                priority: 'high',
                notification: {
                    channelId: 'foodies_notifications',
                    sound: 'default',
                },
            },
            apns: {
                payload: {
                    aps: {
                        alert: { title, body },
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        };

        const response = await messaging.sendEachForMulticast(messagePayload);
        this.logger.log(
            `FCM multicast rider assignment order ${order.id} → user ${riderUserId}: ${response.successCount} succeeded, ${response.failureCount} failed.`,
        );

        if (response.failureCount > 0) {
            const tokensToRemove: string[] = [];
            response.responses.forEach((res, index) => {
                if (!res.success && res.error) {
                    const errorCode = res.error.code;
                    if (
                        errorCode ===
                            'messaging/registration-token-not-registered' ||
                        errorCode === 'messaging/invalid-registration-token'
                    ) {
                        tokensToRemove.push(tokens[index]);
                    }
                }
            });
            if (tokensToRemove.length > 0) {
                await this.removeStaleTokens(riderUserId, tokensToRemove);
            }
        }
    }

    private async removeStaleTokens(
        userId: number,
        tokens: string[],
    ): Promise<void> {
        const firestore = this.firebase.firestore;
        if (!firestore) return;

        const batch = firestore.batch();
        for (const token of tokens) {
            const tokenRef = firestore
                .collection('users')
                .doc(String(userId))
                .collection('tokens')
                .doc(token);
            batch.delete(tokenRef);
        }
        await batch.commit();
        this.logger.log(
            `Cleaned up ${tokens.length} stale tokens for user ${userId}`,
        );
    }
}
