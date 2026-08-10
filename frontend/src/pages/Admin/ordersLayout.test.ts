import { describe, it, expect } from 'vitest';
import {
  ORDERS_COLUMNS,
  ORDERS_GRID_GAP_PX,
  ORDERS_GRID_MIN_PX,
  ORDERS_GRID_PADDING_PX,
  ordersCardColumns,
  ordersGridTemplate,
  ordersLayoutForWidth,
} from './ordersLayout';

describe('orders grid geometry', () => {
  it('derives the minimum width from the columns, so it cannot drift', () => {
    // This is the whole point of the module: the old code declared the template
    // (~1600px of tracks) and the switch breakpoint (xl = 1280px) separately,
    // so every laptop rendered a table it had no room for.
    const expected =
      ORDERS_COLUMNS.reduce((s, c) => s + c.minPx, 0) +
      ORDERS_GRID_GAP_PX * (ORDERS_COLUMNS.length - 1) +
      ORDERS_GRID_PADDING_PX;
    expect(ORDERS_GRID_MIN_PX).toBe(expected);
  });

  it('emits one track per column', () => {
    expect(ordersGridTemplate.split(' ')).toHaveLength(ORDERS_COLUMNS.length);
  });

  it('still covers all 14 columns of the list', () => {
    expect(ORDERS_COLUMNS.map((c) => c.key)).toEqual([
      'serial', 'type', 'order', 'customer', 'source', 'items', 'placed',
      'total', 'discount', 'payment', 'kitchen', 'delivery', 'rider', 'actions',
    ]);
  });

  it('fits a 1080p laptop with the sidebar expanded', () => {
    // Measured, not estimated: on a 1920 window with the sidebar expanded the
    // Orders table container comes out at 1498px. An arithmetic guess at this
    // number (viewport − sidebar − padding) reads ~90px too generous, which is
    // exactly how a 1542px grid shipped and demoted every desktop to cards.
    expect(ORDERS_GRID_MIN_PX).toBeLessThanOrEqual(1498);
  });

  it('does not grow past the width the layout was signed off at', () => {
    // A new column must be paid for out of the existing tracks. Widening the
    // sum does not add a scrollbar — ordersLayoutForWidth silently swaps the
    // whole table for the card fallback, which reads as "the design changed".
    expect(ORDERS_GRID_MIN_PX).toBe(1440);
  });
});

describe('ordersLayoutForWidth', () => {
  it('gives a 1920 desktop the table, not the card fallback', () => {
    // The regression this pins: the container measures 1498px there, and a
    // grid minimum above that turns the admin Orders list into stacked cards.
    expect(ordersLayoutForWidth(1498)).toBe('grid');
  });

  it('uses the grid exactly when every column fits', () => {
    expect(ordersLayoutForWidth(ORDERS_GRID_MIN_PX)).toBe('grid');
    expect(ordersLayoutForWidth(ORDERS_GRID_MIN_PX + 400)).toBe('grid');
  });

  it('falls to cards one pixel short rather than scrolling sideways', () => {
    expect(ordersLayoutForWidth(ORDERS_GRID_MIN_PX - 1)).toBe('cards');
  });

  it('uses cards on a tablet', () => {
    expect(ordersLayoutForWidth(1024)).toBe('cards');
    expect(ordersLayoutForWidth(768)).toBe('cards');
  });

  it('uses cards on a phone', () => {
    expect(ordersLayoutForWidth(390)).toBe('cards');
  });

  it('guesses cards before the first measurement', () => {
    // 0 / NaN happen on the first render and without ResizeObserver. Cards work
    // at every width, so they are the safe default; the grid is not.
    expect(ordersLayoutForWidth(0)).toBe('cards');
    expect(ordersLayoutForWidth(NaN)).toBe('cards');
  });
});

describe('ordersCardColumns', () => {
  it('stacks one card per row on a phone', () => {
    expect(ordersCardColumns(390)).toBe(1);
    expect(ordersCardColumns(719)).toBe(1);
  });

  it('pairs cards once there is room for both to stay readable', () => {
    expect(ordersCardColumns(720)).toBe(2);
    expect(ordersCardColumns(1280)).toBe(2);
  });

  it('never goes past two — the action buttons need the room', () => {
    expect(ordersCardColumns(1900)).toBe(2);
  });

  it('stacks before the first measurement', () => {
    expect(ordersCardColumns(0)).toBe(1);
    expect(ordersCardColumns(NaN)).toBe(1);
  });
});
