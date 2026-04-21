import { BadRequestException } from '@nestjs/common';

/** Canonical channels stored on menu items and used for availability checks. */
export const MENU_ORDER_TYPE_CHANNELS = [
    'delivery',
    'pickup',
    'dine_in',
] as const;

export type MenuOrderTypeChannel = (typeof MENU_ORDER_TYPE_CHANNELS)[number];

/** Default when DB column is null/empty: item is available on all channels. */
export const DEFAULT_MENU_ORDER_TYPES: MenuOrderTypeChannel[] = [
    'delivery',
    'pickup',
    'dine_in',
];

const CHANNEL_SET = new Set<string>(MENU_ORDER_TYPE_CHANNELS);

/**
 * Maps request `order_type` to a canonical channel for menu checks.
 * POS uses `takeaway`; consumer web uses `pickup` — both map to `pickup`.
 */
export function normalizeOrderTypeForMenu(orderType: string): string {
    const t = orderType.trim().toLowerCase();
    if (t === 'takeaway') return 'pickup';
    return t;
}

function coerceMenuOrderChannels(
    channels: string[] | null | undefined,
    strict: boolean,
): MenuOrderTypeChannel[] {
    if (!channels?.length) {
        if (strict) {
            throw new BadRequestException(
                `available_for_order_types must include at least one of: ${MENU_ORDER_TYPE_CHANNELS.join(', ')}`,
            );
        }
        return [...DEFAULT_MENU_ORDER_TYPES];
    }
    const out = new Set<MenuOrderTypeChannel>();
    for (const c of channels) {
        const key = String(c).trim().toLowerCase();
        if (key === 'takeaway') {
            out.add('pickup');
        } else if (CHANNEL_SET.has(key)) {
            out.add(key as MenuOrderTypeChannel);
        }
    }
    if (out.size === 0) {
        if (strict) {
            throw new BadRequestException(
                `available_for_order_types must include at least one of: ${MENU_ORDER_TYPE_CHANNELS.join(', ')}`,
            );
        }
        return [...DEFAULT_MENU_ORDER_TYPES];
    }
    return [...out];
}

/** Validates admin create/update body; throws if nothing valid remains. */
export function parseMenuOrderChannelsInput(
    channels: string[] | null | undefined,
): MenuOrderTypeChannel[] {
    return coerceMenuOrderChannels(channels, true);
}

/** Effective channels for a persisted menu item (null/empty = all). */
export function effectiveMenuOrderChannels(
    available: string[] | null | undefined,
): MenuOrderTypeChannel[] {
    return coerceMenuOrderChannels(available, false);
}

export function isMenuItemAvailableForOrderType(
    available: string[] | null | undefined,
    orderType: string,
): boolean {
    const channel = normalizeOrderTypeForMenu(orderType);
    const channels = effectiveMenuOrderChannels(available);
    return channels.includes(channel as MenuOrderTypeChannel);
}

export function assertMenuItemAvailableForOrderType(
    item: { name?: string; availableForOrderTypes?: string[] | null },
    orderType: string,
): void {
    const channel = normalizeOrderTypeForMenu(orderType);
    const channels = effectiveMenuOrderChannels(item.availableForOrderTypes);
    if (!channels.includes(channel as MenuOrderTypeChannel)) {
        throw new BadRequestException(
            `Menu item "${item.name ?? 'Unknown'}" is not available for order type "${orderType}" (channel: ${channel}). This item is limited to: ${channels.join(', ')}`,
        );
    }
}
