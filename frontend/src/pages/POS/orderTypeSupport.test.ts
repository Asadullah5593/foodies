import { describe, it, expect } from 'vitest';
import { cartLineSupportsOrderType, restrictOrderTypeOptions } from './orderTypeSupport';
import { CartLine } from './components/types';
import { MenuItem } from '../../types';

const item = (id: number, channels?: string[] | null): MenuItem =>
  ({
    id,
    category_id: 1,
    name: `Item ${id}`,
    base_price: 100,
    is_active: true,
    available_for_order_types: channels ?? null,
  }) as MenuItem;

const plain = (channels?: string[] | null): CartLine => ({
  menuItem: item(1, channels),
  quantity: 1,
  addons: [],
  modifiers: [],
});

const deal = (rootId: number, componentChannels: Array<string[] | null>): CartLine => ({
  menuItem: item(rootId, null),
  quantity: 1,
  addons: [],
  modifiers: [],
  dealId: rootId,
  dealName: 'Deal',
  dealPrice: 999,
  components: componentChannels.map((ch, i) => ({
    menuItem: item(100 + i, ch),
    quantity: 1,
    addons: [],
    modifiers: [],
  })),
});

describe('cartLineSupportsOrderType — plain items', () => {
  it('allows an unrestricted item on every channel', () => {
    for (const t of ['dine_in', 'takeaway', 'delivery'] as const) {
      expect(cartLineSupportsOrderType(plain(null), t, [])).toBe(true);
      expect(cartLineSupportsOrderType(plain([]), t, [])).toBe(true);
    }
  });

  it('honours a restriction', () => {
    const dineOnly = plain(['dine_in']);
    expect(cartLineSupportsOrderType(dineOnly, 'dine_in', [])).toBe(true);
    expect(cartLineSupportsOrderType(dineOnly, 'delivery', [])).toBe(false);
  });

  it("treats POS 'takeaway' as the stored 'pickup' channel", () => {
    expect(cartLineSupportsOrderType(plain(['pickup']), 'takeaway', [])).toBe(true);
    expect(cartLineSupportsOrderType(plain(['dine_in']), 'takeaway', [])).toBe(false);
  });
});

describe('cartLineSupportsOrderType — deals', () => {
  const rawMenu = [item(900, ['dine_in', 'pickup', 'delivery'])];

  it('reads the deal root from the menu, not the line placeholder', () => {
    const dineOnlyRoot = [item(900, ['dine_in'])];
    expect(cartLineSupportsOrderType(deal(900, [null]), 'delivery', dineOnlyRoot)).toBe(false);
    expect(cartLineSupportsOrderType(deal(900, [null]), 'dine_in', dineOnlyRoot)).toBe(true);
  });

  it('allows a deal whose every component supports the channel', () => {
    expect(cartLineSupportsOrderType(deal(900, [null, ['delivery']]), 'delivery', rawMenu)).toBe(true);
  });

  // The regression this predicate exists for: the backend asserts EVERY component,
  // so a deal passing on its root alone would be accepted here then 400 at order time.
  it('rejects a deal when any one component cannot be sold on the channel', () => {
    const withDineOnlyComponent = deal(900, [['delivery'], ['dine_in']]);
    expect(cartLineSupportsOrderType(withDineOnlyComponent, 'delivery', rawMenu)).toBe(false);
    expect(cartLineSupportsOrderType(withDineOnlyComponent, 'dine_in', rawMenu)).toBe(false);
  });

  it('allows a deal with no components chosen yet', () => {
    expect(cartLineSupportsOrderType(deal(900, []), 'delivery', rawMenu)).toBe(true);
  });
});

describe('restrictOrderTypeOptions', () => {
  const all = [
    { value: 'dine_in' as const, label: 'Dine In' },
    { value: 'takeaway' as const, label: 'Takeaway' },
    { value: 'delivery' as const, label: 'Delivery' },
  ];

  it('leaves an unrestricted account with every option the branch offers', () => {
    expect(restrictOrderTypeOptions(all, false)).toEqual(all);
  });

  it('narrows a delivery-only account to delivery alone', () => {
    // The nav tabs, checkout selector and menu filter all read this list, so
    // dine-in and takeaway disappear from the whole POS at once.
    expect(restrictOrderTypeOptions(all, true)).toEqual([all[2]]);
  });

  it('yields nothing — not a fallback — where the branch has no delivery', () => {
    // A collection-only branch: the honest answer for a delivery-only account
    // is "cannot order here". Falling back to dine-in would offer the very
    // thing the permission forbids.
    expect(restrictOrderTypeOptions(all.slice(0, 2), true)).toEqual([]);
  });
});
