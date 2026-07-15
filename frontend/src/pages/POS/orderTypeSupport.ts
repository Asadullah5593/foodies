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
