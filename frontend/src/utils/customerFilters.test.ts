import { describe, it, expect } from 'vitest';
import {
  type CustomerFilters,
  type CustomerRow,
  EMPTY_FILTERS,
  LAST_ORDER_OPTIONS,
  ORDERS_OPTIONS,
  POINTS_OPTIONS,
  SEGMENTS,
  activeFilterCount,
  appPoints,
  customerStatus,
  defaultSortDir,
  filterCustomers,
  filtersFromParams,
  matchesSegment,
  moreFilterCount,
  optionsFrom,
  pointsForFilter,
  posPoints,
  segmentCounts,
  sortCustomers,
} from './customerFilters';

/**
 * The Customers table narrows in the browser. These pin what each filter
 * means, in the terms the client agreed: "orders" are COMPLETED orders, spend
 * is completed orders only, "last order" is the most recent completed one, and
 * POS points and app points are different money.
 */
const NOW = new Date('2026-10-01T12:00:00');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const mk = (over: Partial<CustomerRow> & { id: number }): CustomerRow => ({
  name: `C${over.id}`,
  phone: `0300000000${over.id}`,
  source: 'pos',
  createdAt: '2026-06-01T10:00:00',
  loyaltyWallets: [],
  brands: [],
  branches: [],
  orderStats: { completed_count: 0, cancelled_count: 0, spent: 0, last_order_at: null },
  ...over,
});

const FIREAWAY = { id: 21, name: 'Fireaway' };
const PEPERI = { id: 23, name: 'Peperi Co' };
const PINE = { id: 10, name: 'Pine Avenue' };
const DHA = { id: 12, name: 'DHA' };

const abdullah = mk({
  id: 1, name: 'Abdullah Arshad', phone: '03240201350', email: 'abd@mail.com', source: 'consumer_app',
  createdAt: '2026-06-12T09:00:00',
  loyaltyWallets: [
    { wallet_type: 'pos', brand_id: 21, brand_name: 'Fireaway', balance: 4369 },
    { wallet_type: 'pos', brand_id: 23, brand_name: 'Peperi Co', balance: 949 },
  ],
  brands: [FIREAWAY, PEPERI], branches: [PINE, DHA],
  orderStats: { completed_count: 14, cancelled_count: 2, spent: 31240, last_order_at: daysAgo(3) },
});
const ammar = mk({
  id: 2, name: 'ammar', phone: '03160482460', source: 'consumer_app', createdAt: '2026-01-19T09:00:00',
  loyaltyWallets: [
    { wallet_type: 'pos', brand_id: 21, brand_name: 'Fireaway', balance: 300 },
    { wallet_type: 'app', brand_id: null, brand_name: null, balance: 800 },
  ],
  brands: [FIREAWAY], branches: [PINE],
  orderStats: { completed_count: 1, cancelled_count: 0, spent: 2100, last_order_at: daysAgo(45) },
});
const zainab = mk({
  id: 3, name: 'Zainab', phone: '03001112223', source: 'pos', createdAt: '2026-09-25T09:00:00',
  loyaltyWallets: [{ wallet_type: 'app', brand_id: null, brand_name: null, balance: 50 }],
  brands: [PEPERI], branches: [DHA],
  orderStats: { completed_count: 2, cancelled_count: 5, spent: 900, last_order_at: daysAgo(120) },
});
const arbaz = mk({ id: 4, name: 'Arbaz', phone: '03124551339', source: 'consumer_app', createdAt: '2026-09-22T09:00:00' });
const nameless = mk({ id: 5, name: null, phone: '03009998887' });
const ALL = [abdullah, ammar, zainab, arbaz, nameless];

const ids = (f: Partial<CustomerFilters>) =>
  filterCustomers(ALL, { ...EMPTY_FILTERS, ...f }, NOW).map((c) => c.id);

describe('filterCustomers', () => {
  it('returns everyone when nothing is set', () => {
    expect(ids({})).toEqual([1, 2, 3, 4, 5]);
  });

  it('searches name, phone and email, ignoring case', () => {
    expect(ids({ q: 'ABDULLAH' })).toEqual([1]);
    expect(ids({ q: '0316048' })).toEqual([2]);
    expect(ids({ q: 'abd@mail' })).toEqual([1]);
    expect(ids({ q: 'nobody' })).toEqual([]);
  });

  it('filters by where they registered', () => {
    expect(ids({ source: 'consumer_app' })).toEqual([1, 2, 4]);
    expect(ids({ source: 'pos' })).toEqual([3, 5]);
  });

  it('filters by brand and by branch', () => {
    expect(ids({ brand: '21' })).toEqual([1, 2]);
    expect(ids({ brand: '23' })).toEqual([1, 3]);
    expect(ids({ branch: '12' })).toEqual([1, 3]);
    expect(ids({ brand: '21', branch: '12' })).toEqual([1]);
  });

  describe('points — POS and app are different money', () => {
    it('has points of either kind', () => expect(ids({ points: 'any' })).toEqual([1, 2, 3]));
    it('has POS points', () => expect(ids({ points: 'pos' })).toEqual([1, 2]));
    it('has app points', () => expect(ids({ points: 'app' })).toEqual([2, 3]));
    it('has both', () => expect(ids({ points: 'both' })).toEqual([2]));
    it('has none', () => expect(ids({ points: 'none' })).toEqual([4, 5]));

    it('an app-registered customer with only POS points is NOT an app-points customer', () => {
      expect(abdullah.source).toBe('consumer_app');
      expect(ids({ points: 'app' })).not.toContain(1);
      expect(ids({ points: 'pos' })).toContain(1);
    });

    it('"has POS points" with a brand means POS points at THAT brand', () => {
      // ammar holds Fireaway POS points only.
      expect(ids({ points: 'pos', brand: '23' })).toEqual([1]);
    });

    it('minimum points compares the kind picked', () => {
      expect(ids({ minPoints: '1000' })).toEqual([1, 2]); // any kind: 5318, 1100
      expect(ids({ points: 'pos', minPoints: '1000' })).toEqual([1]); // ammar's POS is 300
      expect(ids({ points: 'app', minPoints: '500' })).toEqual([2]);
    });

    it('minimum POS points with a brand looks at that brand’s wallet only', () => {
      // Abdullah: Fireaway 4369, Peperi Co 949.
      expect(ids({ points: 'pos', brand: '23', minPoints: '1000' })).toEqual([]);
      expect(ids({ points: 'pos', brand: '21', minPoints: '1000' })).toEqual([1]);
    });
  });

  it('filters by registration date, inclusive at both ends', () => {
    expect(ids({ regFrom: '2026-09-22' })).toEqual([3, 4]);
    expect(ids({ regTo: '2026-01-19' })).toEqual([2]);
    expect(ids({ regFrom: '2026-06-01', regTo: '2026-06-12' })).toEqual([1, 5]);
  });

  describe('last order — the most recent COMPLETED order', () => {
    it('within the last N days', () => {
      expect(ids({ lastOrder: '7' })).toEqual([1]);
      expect(ids({ lastOrder: '90' })).toEqual([1, 2]);
    });
    it('lapsed: ordered before, but not for N+ days', () => {
      expect(ids({ lastOrder: 'lapsed30' })).toEqual([2, 3]);
      expect(ids({ lastOrder: 'lapsed60' })).toEqual([3]);
      expect(ids({ lastOrder: 'lapsed90' })).toEqual([3]);
    });
    it('"within N days" and "not for N+ days" split the customers between them', () => {
      // Exactly N days ago is still within; nobody is in both or in neither.
      const onTheDay = mk({ id: 8, orderStats: { completed_count: 1, cancelled_count: 0, spent: 1, last_order_at: daysAgo(30) } });
      const dayAfter = mk({ id: 9, orderStats: { completed_count: 1, cancelled_count: 0, spent: 1, last_order_at: daysAgo(31) } });
      const within = filterCustomers([onTheDay, dayAfter], { ...EMPTY_FILTERS, lastOrder: '30' }, NOW).map((c) => c.id);
      const lapsed = filterCustomers([onTheDay, dayAfter], { ...EMPTY_FILTERS, lastOrder: 'lapsed30' }, NOW).map((c) => c.id);
      expect(within).toEqual([8]);
      expect(lapsed).toEqual([9]);
    });
    it('a customer who never ordered is not "lapsed" — they have their own option', () => {
      expect(ids({ lastOrder: 'lapsed30' })).not.toContain(4);
      expect(ids({ lastOrder: 'never' })).toEqual([4, 5]);
    });
  });

  describe('orders — completed orders, never cancelled ones', () => {
    it('none / at least one / exactly one / repeat', () => {
      expect(ids({ orders: 'none' })).toEqual([4, 5]);
      expect(ids({ orders: 'some' })).toEqual([1, 2, 3]);
      expect(ids({ orders: 'one' })).toEqual([2]);
      expect(ids({ orders: 'repeat' })).toEqual([1, 3]);
    });
    it('minimum orders ignores cancellations', () => {
      // zainab: 2 completed, 5 cancelled — not a 5-order customer.
      expect(ids({ minOrders: '5' })).toEqual([1]);
    });
  });

  it('filters by minimum spend', () => {
    expect(ids({ minSpend: '2000' })).toEqual([1, 2]);
    expect(ids({ minSpend: '50000' })).toEqual([]);
  });

  it('cannot filter on a spend the viewer is not allowed to see', () => {
    const hidden = ALL.map((c) => ({ ...c, orderStats: { ...c.orderStats!, spent: null } }));
    expect(filterCustomers(hidden, { ...EMPTY_FILTERS, minSpend: '50000' }, NOW)).toHaveLength(ALL.length);
  });

  it('combines filters — every one must match', () => {
    expect(ids({ source: 'consumer_app', points: 'pos', lastOrder: '7', minSpend: '10000' })).toEqual([1]);
    expect(ids({ source: 'pos', points: 'pos' })).toEqual([]);
  });

  it('copes with rows that carry no figures at all', () => {
    const bare: CustomerRow = { id: 9, name: 'Bare', phone: '03000000009' };
    expect(filterCustomers([bare], EMPTY_FILTERS, NOW)).toHaveLength(1);
    expect(filterCustomers([bare], { ...EMPTY_FILTERS, orders: 'none', points: 'none', lastOrder: 'never' }, NOW)).toHaveLength(1);
    expect(filterCustomers([bare], { ...EMPTY_FILTERS, minOrders: '1' }, NOW)).toHaveLength(0);
  });
});

describe('points helpers', () => {
  it('adds POS wallets across brands, or takes one brand’s', () => {
    expect(posPoints(abdullah)).toBe(5318);
    expect(posPoints(abdullah, 23)).toBe(949);
    expect(posPoints(abdullah, 99)).toBe(0);
  });
  it('keeps app points separate', () => {
    expect(appPoints(abdullah)).toBe(0);
    expect(appPoints(ammar)).toBe(800);
  });
  it('picks the balance a minimum is compared against', () => {
    expect(pointsForFilter(ammar, { points: 'pos', brand: '' })).toBe(300);
    expect(pointsForFilter(ammar, { points: 'app', brand: '' })).toBe(800);
    expect(pointsForFilter(ammar, { points: '', brand: '' })).toBe(1100);
  });
});

describe('sortCustomers', () => {
  const order = (key: Parameters<typeof sortCustomers>[1], dir: 'asc' | 'desc') =>
    sortCustomers(ALL, key, dir).map((c) => c.id);

  it('leaves the server’s order alone when no column is picked', () => {
    expect(sortCustomers(ALL, '', 'desc')).toBe(ALL);
  });

  it('never reorders the list it was given', () => {
    const before = ALL.map((c) => c.id);
    sortCustomers(ALL, 'spent', 'desc');
    expect(ALL.map((c) => c.id)).toEqual(before);
  });

  it('sorts by name, the nameless last either way', () => {
    expect(order('name', 'asc')).toEqual([1, 2, 4, 3, 5]);
    expect(order('name', 'desc')).toEqual([3, 4, 2, 1, 5]);
  });

  it('sorts by completed, cancelled, spend and points', () => {
    expect(order('completed', 'desc').slice(0, 3)).toEqual([1, 3, 2]);
    expect(order('cancelled', 'desc').slice(0, 2)).toEqual([3, 1]);
    expect(order('spent', 'desc').slice(0, 3)).toEqual([1, 2, 3]);
    expect(order('points', 'desc').slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('sorts by last order, never-ordered last either way', () => {
    expect(order('last_order', 'desc')).toEqual([1, 2, 3, 5, 4]);
    expect(order('last_order', 'asc')).toEqual([3, 2, 1, 5, 4]);
  });

  it('opens a column the natural way round', () => {
    expect(defaultSortDir('name')).toBe('asc');
    expect(defaultSortDir('spent')).toBe('desc');
    expect(defaultSortDir('last_order')).toBe('desc');
  });
});

describe('filters in the URL', () => {
  it('reads every filter back from its query-string name', () => {
    const sp = new URLSearchParams(
      'q=ali&source=pos&brand=21&branch=10&points=both&min_points=500&reg_from=2026-01-01&reg_to=2026-02-01&last_order=lapsed30&orders=repeat&min_orders=3&min_spend=1000',
    );
    expect(filtersFromParams(sp)).toEqual({
      q: 'ali', source: 'pos', brand: '21', branch: '10', points: 'both', minPoints: '500',
      regFrom: '2026-01-01', regTo: '2026-02-01', lastOrder: 'lapsed30', orders: 'repeat',
      minOrders: '3', minSpend: '1000', segment: '',
    });
    expect(filtersFromParams(new URLSearchParams('segment=lapsed')).segment).toBe('lapsed');
  });

  it('is empty for a bare URL', () => {
    expect(filtersFromParams(new URLSearchParams(''))).toEqual(EMPTY_FILTERS);
  });

  it('drops anything malformed instead of filtering on it', () => {
    const sp = new URLSearchParams(
      'brand=abc&branch=-1&points=gold&min_points=lots&reg_from=yesterday&last_order=1+OR+1&orders=many&min_spend=-5&segment=vip',
    );
    expect(filtersFromParams(sp)).toEqual(EMPTY_FILTERS);
  });

  it('counts the filters that are narrowing the list', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'a', points: 'pos', minSpend: '10' })).toBe(3);
    expect(activeFilterCount({ ...EMPTY_FILTERS, segment: 'active' })).toBe(1);
  });

  it('counts apart the ones tucked behind "More filters"', () => {
    // Search, source, brand, branch and the chips are always on show.
    expect(moreFilterCount({ ...EMPTY_FILTERS, q: 'a', source: 'pos', brand: '21', branch: '10', segment: 'active' })).toBe(0);
    expect(moreFilterCount({ ...EMPTY_FILTERS, points: 'pos', minPoints: '5', lastOrder: '7', orders: 'one', minOrders: '2', minSpend: '10', regFrom: '2026-01-01', regTo: '2026-02-01' })).toBe(8);
  });
});

describe('optionsFrom', () => {
  it('offers each brand and branch once, in name order', () => {
    expect(optionsFrom(ALL, (c) => c.brands)).toEqual([FIREAWAY, PEPERI]);
    expect(optionsFrom(ALL, (c) => c.branches)).toEqual([DHA, PINE]);
  });
});

describe('customer status — by the most recent COMPLETED order', () => {
  const at = (n: number | null) => customerStatus(n == null ? null : daysAgo(n), NOW);

  it('is active for 30 days, lapsing until 60, lapsed after', () => {
    expect(at(0)).toEqual({ key: 'active', days: 0 });
    expect(at(30).key).toBe('active');
    expect(at(31).key).toBe('lapsing');
    expect(at(60).key).toBe('lapsing');
    expect(at(61).key).toBe('lapsed');
    expect(at(400)).toEqual({ key: 'lapsed', days: 400 });
  });

  it('is "never" for a customer who has not completed an order', () => {
    expect(at(null)).toEqual({ key: 'never', days: null });
    expect(customerStatus(undefined, NOW).key).toBe('never');
    expect(customerStatus('not a date', NOW).key).toBe('never');
  });
});

describe('quick-pick chips', () => {
  const seg = (segment: CustomerFilters['segment'], extra: Partial<CustomerFilters> = {}) =>
    filterCustomers(ALL, { ...EMPTY_FILTERS, ...extra, segment }, NOW).map((c) => c.id);

  it('offers All, Active, Lapsed, Never ordered and Has points', () => {
    expect(SEGMENTS.map((s) => s.label)).toEqual([
      'All', 'Active · last 30 days', 'Lapsed · 60+ days', 'Never ordered', 'Has points',
    ]);
  });

  it('picks the customers each chip names', () => {
    expect(seg('')).toEqual([1, 2, 3, 4, 5]);
    expect(seg('active')).toEqual([1]); // 3 days ago
    expect(seg('lapsed')).toEqual([3]); // 120 days ago; ammar at 45 is only lapsing
    expect(seg('never')).toEqual([4, 5]);
    expect(seg('points')).toEqual([1, 2, 3]);
  });

  it('a customer between 30 and 60 days is neither active nor lapsed', () => {
    expect(matchesSegment(ammar, 'active', NOW)).toBe(false);
    expect(matchesSegment(ammar, 'lapsed', NOW)).toBe(false);
    expect(matchesSegment(ammar, '', NOW)).toBe(true);
  });

  it('narrows on top of the other filters', () => {
    expect(seg('points', { source: 'pos' })).toEqual([3]);
    expect(seg('active', { source: 'pos' })).toEqual([]);
  });

  it('counts what each chip would show, given every other filter', () => {
    expect(segmentCounts(ALL, EMPTY_FILTERS, NOW)).toEqual({ '': 5, active: 1, lapsed: 1, never: 2, points: 3 });
    expect(segmentCounts(ALL, { ...EMPTY_FILTERS, source: 'consumer_app' }, NOW)).toEqual({
      '': 3, active: 1, lapsed: 0, never: 1, points: 2,
    });
  });

  it('keeps the counts steady whichever chip is picked', () => {
    // The numbers describe the chips, not the current selection.
    expect(segmentCounts(ALL, { ...EMPTY_FILTERS, segment: 'never' }, NOW)).toEqual(
      segmentCounts(ALL, EMPTY_FILTERS, NOW),
    );
  });
});

describe('filter options on offer', () => {
  it('keeps every points, last-order and order-count option', () => {
    expect(POINTS_OPTIONS.map((o) => o.label)).toEqual([
      'Any', 'Has points', 'Has POS points', 'Has app points', 'Has both', 'No points',
    ]);
    expect(LAST_ORDER_OPTIONS.map((o) => o.label)).toEqual([
      'Any time', 'In the last 7 days', 'In the last 30 days', 'In the last 90 days',
      'Not for 30+ days', 'Not for 60+ days', 'Not for 90+ days', 'Never ordered',
    ]);
    expect(ORDERS_OPTIONS.map((o) => o.label)).toEqual([
      'Any', 'None', 'At least 1', 'Exactly one', 'Repeat (2 or more)',
    ]);
  });
});
