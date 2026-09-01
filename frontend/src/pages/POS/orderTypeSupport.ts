import { MenuItem } from '../../types';
import { isMenuItemAvailableForOrderType } from '../../utils/menu-order-type';
import { CartLine, OrderTypeOption } from './components/types';

/**
 * Whether a cart line can be sold on `type`.
 *
 * A deal is only sellable on a channel when its ROOT and every chosen COMPONENT
 * are — the backend asserts both (assertMenuItemAvailableForOrderType over the
 * deal root and each component), so a deal that passes on its root while holding
 * a restricted component would be accepted in the cart and then rejected at
 * quote/order time with a raw 400.
 *
 * Channel rules (aliases, fail-open on null/empty) live in
 * utils/menu-order-type.ts — never hand-roll a channel comparison.
 */
export function cartLineSupportsOrderType(
  line: CartLine,
  type: OrderTypeOption,
  rawMenu: MenuItem[],
): boolean {
  // A deal line's own menuItem is a synthetic stand-in, so the real channels are
  // on the deal root in the menu; fall back to the line's copy if it is absent.
  const channels =
    line.dealId != null
      ? rawMenu.find((m) => m.id === line.dealId)?.available_for_order_types ??
        line.menuItem.available_for_order_types ??
        null
      : line.menuItem.available_for_order_types ?? null;
  if (!isMenuItemAvailableForOrderType(channels, type)) return false;
  return (line.components ?? []).every((c) =>
    isMenuItemAvailableForOrderType(c.menuItem.available_for_order_types ?? null, type),
  );
}

/**
 * Order-type MARKER permissions. Each admits one type; held together they add
 * up (delivery + takeaway = "no dine-in"); held by nobody, the branch's own
 * options stand. The server enforces the same rule on quote and order
 * (assertOrderTypeAllowed) — this only keeps the POS from offering a type it
 * would refuse.
 */
export const DELIVERY_ONLY_PERMISSION = 'orders:create:delivery-only';
export const TAKEAWAY_ONLY_PERMISSION = 'orders:create:takeaway-only';
export const DINE_IN_ONLY_PERMISSION = 'orders:create:dine-in-only';

/** The types admitted by the markers held, or null when none is held. */
export function allowedOrderTypes(held: {
  deliveryOnly: boolean;
  takeawayOnly: boolean;
  dineInOnly: boolean;
}): Set<OrderTypeOption> | null {
  const allowed = new Set<OrderTypeOption>();
  if (held.deliveryOnly) allowed.add('delivery');
  if (held.takeawayOnly) allowed.add('takeaway');
  if (held.dineInOnly) allowed.add('dine_in');
  return allowed.size ? allowed : null;
}

/**
 * Narrow the branch's order-type options to what the account may place.
 *
 * `orderTypeOptions` is the POS's single source of truth — the nav tabs, the
 * checkout selector, `effectiveOrderType` and the menu filter all derive from
 * it — so restricting here restricts everything, and the cashier is never
 * offered a type the server (assertOrderTypeAllowed) would refuse.
 *
 * Deliberately returns [] rather than any fallback when the branch offers
 * none of the allowed types: an empty list means "cannot order here", which
 * is the truth for a delivery-only account at a collection-only branch.
 * Falling back to dine-in — as the unrestricted path does — would offer the
 * very thing the permission forbids.
 */
export function restrictOrderTypeOptions<T extends { value: OrderTypeOption }>(
  options: T[],
  allowed: Set<OrderTypeOption> | null,
): T[] {
  if (!allowed) return options;
  return options.filter((o) => allowed.has(o.value));
}
