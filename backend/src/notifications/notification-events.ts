/**
 * Central catalog of notification event types — the single source of truth for the
 * notifications subsystem. Adding a new alert type is a matter of adding one entry
 * here and calling `NotificationsService.dispatch({ type, ... })` from its producer:
 * the admin config UI, role-targeting defaults, client surface routing and actions
 * are all derived from this registry.
 *
 * Mirrors the shape of `roles/permissions.dto.ts` (a `const` object keyed by the
 * stable event-type string).
 */

export type NotificationCategory = 'order' | 'inventory';

/** Where the client renders this notification. */
export type NotificationSurface = 'pos_stack' | 'admin_bell';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

/**
 * - `shared`  — one user's terminal action (Accept/Reject) resolves it for everyone (order alerts).
 * - `system`  — opened/auto-resolved by the system as a condition appears/clears (inventory alerts).
 * - `per_user`— each recipient dismisses their own copy.
 */
export type NotificationResolutionMode = 'shared' | 'system' | 'per_user';

export interface NotificationActionDef {
    /** Stable key recorded as `resolvedAction`. */
    key: string;
    label: string;
    /** Client maps this to behaviour (e.g. call kitchen status endpoint). */
    kind:
        | 'order.accept'
        | 'order.reject'
        | 'order.view'
        | 'inventory.view'
        | 'ack';
    style?: 'primary' | 'danger' | 'default';
    /** Whether invoking this action resolves the notification (terminal). */
    resolves: boolean;
}

export interface NotificationEventDef {
    type: string;
    label: string;
    description: string;
    category: NotificationCategory;
    surface: NotificationSurface;
    severity: NotificationSeverity;
    resolutionMode: NotificationResolutionMode;
    /** Default sound on/off (admin can override per scope). */
    sound: boolean;
    /** Repeat the chime every few seconds until acknowledged (unattended till). */
    repeatSound: boolean;
    /** Default target roles (by slug) used until an admin configures explicit roles. */
    defaultRoleSlugs: string[];
    actions: NotificationActionDef[];
}

export const NOTIFICATION_EVENTS = {
    'order.placed.online': {
        type: 'order.placed.online',
        label: 'Online order placed',
        description:
            'An app, web or kiosk order was placed and needs the till to accept it.',
        category: 'order',
        surface: 'pos_stack',
        severity: 'warning',
        resolutionMode: 'shared',
        sound: true,
        repeatSound: true,
        defaultRoleSlugs: ['cashier', 'branch_manager'],
        actions: [
            {
                key: 'accept',
                label: 'Accept',
                kind: 'order.accept',
                style: 'primary',
                resolves: true,
            },
            {
                key: 'reject',
                label: 'Reject',
                kind: 'order.reject',
                style: 'danger',
                resolves: true,
            },
            {
                key: 'view',
                label: 'View',
                kind: 'order.view',
                style: 'default',
                resolves: false,
            },
        ],
    },
    'inventory.low_stock': {
        type: 'inventory.low_stock',
        label: 'Low stock',
        description:
            'An item dropped to or below its reorder point at a branch.',
        category: 'inventory',
        surface: 'admin_bell',
        severity: 'warning',
        resolutionMode: 'system',
        sound: false,
        repeatSound: false,
        defaultRoleSlugs: ['branch_manager'],
        actions: [
            {
                key: 'view',
                label: 'View item',
                kind: 'inventory.view',
                style: 'default',
                resolves: false,
            },
        ],
    },
    'inventory.near_expiry': {
        type: 'inventory.near_expiry',
        label: 'Near expiry',
        description:
            'A stock batch is within its near-expiry window at a branch.',
        category: 'inventory',
        surface: 'admin_bell',
        severity: 'warning',
        resolutionMode: 'system',
        sound: false,
        repeatSound: false,
        defaultRoleSlugs: ['branch_manager'],
        actions: [
            {
                key: 'view',
                label: 'View batch',
                kind: 'inventory.view',
                style: 'default',
                resolves: false,
            },
        ],
    },
} satisfies Record<string, NotificationEventDef>;

export type NotificationEventType = keyof typeof NOTIFICATION_EVENTS;

export const NOTIFICATION_EVENT_LIST: NotificationEventDef[] =
    Object.values(NOTIFICATION_EVENTS);

export function getNotificationEvent(
    type: string,
): NotificationEventDef | undefined {
    return (NOTIFICATION_EVENTS as Record<string, NotificationEventDef>)[type];
}
