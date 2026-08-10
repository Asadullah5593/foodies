/**
 * Column geometry and the layout decision for the admin Orders list.
 *
 * The bug this file exists to prevent: the column template and the breakpoint
 * that switched layouts were declared in two places and drifted apart. The grid
 * needed ~1600px but turned on at Tailwind's `xl` (1280px), so every laptop got
 * a 13-column table with a horizontal scrollbar. Here the template and the
 * minimum width are derived from ONE list, so they cannot disagree again.
 *
 * A viewport breakpoint is the wrong instrument anyway: the sidebar is
 * collapsible and the page has its own padding, so the width actually available
 * to the table is not a function of the viewport. The page measures its own
 * container instead — the same approach MenuGrid uses on the POS.
 */

export type OrdersColumn = {
  key: string;
  /** CSS grid track. */
  css: string;
  /** Narrowest this track can get, for the min-width sum. */
  minPx: number;
};

/**
 * The 14 columns, in render order. Tightened from the original widths so the
 * full table fits a 1080p laptop with the sidebar expanded — every one of these
 * holds a badge, a short label or truncating text, so the trim costs nothing.
 *
 * `discount` was added last, and it is paid for out of the other tracks rather
 * than bolted on: widening the sum is what silently demotes the whole table to
 * the card fallback on any container that used to fit it. ORDERS_GRID_MIN_PX
 * must stay at 1440 — that is the width real screens were measured against.
 */
export const ORDERS_COLUMNS: OrdersColumn[] = [
  { key: 'serial', css: '34px', minPx: 34 },
  { key: 'type', css: '66px', minPx: 66 },
  { key: 'order', css: '122px', minPx: 122 },
  { key: 'customer', css: 'minmax(132px,1.3fr)', minPx: 132 },
  { key: 'source', css: '72px', minPx: 72 },
  { key: 'items', css: '48px', minPx: 48 },
  { key: 'placed', css: '80px', minPx: 80 },
  { key: 'total', css: '92px', minPx: 92 },
  { key: 'discount', css: '96px', minPx: 96 },
  // Left at 98: "Online transfer" is the longest label the cell carries and
  // already sits on the edge of truncating.
  { key: 'payment', css: '98px', minPx: 98 },
  { key: 'kitchen', css: '112px', minPx: 112 },
  { key: 'delivery', css: '82px', minPx: 82 },
  { key: 'rider', css: 'minmax(96px,1fr)', minPx: 96 },
  { key: 'actions', css: '144px', minPx: 144 },
];

/** gap-2.5 between tracks. */
export const ORDERS_GRID_GAP_PX = 10;
/** pl-4 + pr-5 on every row. */
export const ORDERS_GRID_PADDING_PX = 36;

/** Inline template — built at runtime, so it must not be a Tailwind class. */
export const ordersGridTemplate = ORDERS_COLUMNS.map((c) => c.css).join(' ');

/**
 * Narrowest width at which all 14 columns fit without a horizontal scrollbar.
 * Derived, never hand-written.
 */
export const ORDERS_GRID_MIN_PX =
  ORDERS_COLUMNS.reduce((sum, c) => sum + c.minPx, 0) +
  ORDERS_GRID_GAP_PX * (ORDERS_COLUMNS.length - 1) +
  ORDERS_GRID_PADDING_PX;

export type OrdersLayout = 'grid' | 'cards';

/**
 * Which layout the measured container can actually carry.
 *
 * `cards` for anything narrower than the full table — a phone, a tablet, or a
 * laptop with the sidebar expanded. Stacked cards show the same fields without
 * a sideways scroll, which is the one thing a table cannot do gracefully.
 *
 * A zero/unknown width also yields `cards`: before the first measurement the
 * safe guess is the layout that works at every size.
 */
export function ordersLayoutForWidth(width: number): OrdersLayout {
  if (!Number.isFinite(width) || width <= 0) return 'cards';
  return width >= ORDERS_GRID_MIN_PX ? 'grid' : 'cards';
}

/**
 * Card columns for a measured width. Two side by side once there is room for
 * both to stay readable; one on a phone. Never three — the action buttons and
 * status pills need the horizontal room.
 */
export function ordersCardColumns(width: number): 1 | 2 {
  if (!Number.isFinite(width) || width < 720) return 1;
  return 2;
}
