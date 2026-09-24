import { BadRequestException } from '@nestjs/common';
import { OfferChannel } from '../discounts/offer-preview.util';

/**
 * Sale channels a menu item can be limited to — the surface the order is
 * placed on, as opposed to how the food leaves the shop (that is
 * `available_for_order_types`: delivery / pickup / dine_in).
 *
 * Same vocabulary as `discounts.channels`, deliberately: an item restricted to
 * ['pos','app'] and an offer restricted the same way must agree on what "app"
 * means. Order sources map pos→pos, consumer_app→app, consumer_web→web,
 * kiosk→kiosk; call_centre counts as 'pos', since agents order through the till.
 */
export const MENU_SALE_CHANNELS: readonly OfferChannel[] = [
    'pos',
    'app',
    'web',
    'kiosk',
];

const CHANNEL_SET = new Set<string>(MENU_SALE_CHANNELS);

/**
 * Admin input → the column value.
 *
 * null / undefined / [] / every channel selected  → null (= sold everywhere),
 * so "no restriction" has exactly one representation rather than two that
 * behave alike but compare differently.
 *
 * A non-empty list naming nothing valid is a typo, not a request to sell
 * everywhere, so it throws rather than silently widening the item's reach.
 */
export function normalizeMenuSaleChannels(input: unknown): string[] | null {
    if (input == null) return null;
    if (!Array.isArray(input))
        throw new BadRequestException(
            `available_channels must be an array of: ${MENU_SALE_CHANNELS.join(', ')}`,
        );
    if (input.length === 0) return null;

    const set = new Set<string>();
    for (const x of input) {
        const key = String(x).trim().toLowerCase();
        if (CHANNEL_SET.has(key)) set.add(key);
    }
    if (set.size === 0)
        throw new BadRequestException(
            `available_channels must name at least one of: ${MENU_SALE_CHANNELS.join(', ')}`,
        );
    if (set.size === MENU_SALE_CHANNELS.length) return null;
    return MENU_SALE_CHANNELS.filter((c) => set.has(c));
}
