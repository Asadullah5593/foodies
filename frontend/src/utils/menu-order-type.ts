/** Aligns with backend `backend/src/utils/menu-order-type.ts` for POS client-side filtering. */

const MENU_ORDER_CHANNELS = ['delivery', 'pickup', 'dine_in'] as const;
type MenuOrderChannel = (typeof MENU_ORDER_CHANNELS)[number];

const CHANNEL_SET = new Set<string>(MENU_ORDER_CHANNELS);

const DEFAULT_CHANNELS: MenuOrderChannel[] = ['delivery', 'pickup', 'dine_in'];

export function normalizeOrderTypeForMenu(orderType: string): string {
  const t = orderType.trim().toLowerCase();
  if (t === 'takeaway') return 'pickup';
  return t;
}

function effectiveMenuOrderChannels(
  available: string[] | null | undefined,
): MenuOrderChannel[] {
  if (!available?.length) return [...DEFAULT_CHANNELS];
  const out = new Set<MenuOrderChannel>();
  for (const c of available) {
    const key = String(c).trim().toLowerCase();
    if (key === 'takeaway') out.add('pickup');
    else if (CHANNEL_SET.has(key)) out.add(key as MenuOrderChannel);
  }
  if (out.size === 0) return [...DEFAULT_CHANNELS];
  return [...out];
}

/** Whether a menu item (by `available_for_order_types`) can be sold for this POS order type. */
export function isMenuItemAvailableForOrderType(
  available: string[] | null | undefined,
  orderType: string,
): boolean {
  const channel = normalizeOrderTypeForMenu(orderType);
  const channels = effectiveMenuOrderChannels(available);
  return channels.includes(channel as MenuOrderChannel);
}
