/**
 * Filtering and sorting for the admin Customers table.
 *
 * The page loads every customer in one request and narrows in the browser, so
 * all of it lives here as pure functions: the page only binds controls to the
 * URL. The filters are kept in the query string so a narrowed view can be
 * bookmarked or sent to someone.
 *
 * Order figures follow the server's rules (customer-order-stats.ts): only
 * finished orders count, "orders" means COMPLETED orders, spend is completed
 * orders only, and "last order" is the most recent completed one.
 */
import { daysSince, localDayKey } from './dateDisplay';

export type CustomerWallet = {
  wallet_type: 'pos' | 'app';
  brand_id: number | null;
  brand_name: string | null;
  balance: number;
};

export type CustomerOrderStats = {
  completed_count: number;
  cancelled_count: number;
  /** Completed orders only. null when the viewer may not see money totals. */
  spent: number | null;
  /** Most recent completed order, or null if they never completed one. */
  last_order_at: string | null;
};

export type CustomerRow = {
  id: number;
  name: string | null;
  phone: string;
  email?: string | null;
  /** Where they registered: pos | consumer_app | consumer_web | kiosk. */
  source?: string | null;
  createdAt?: string | null;
  loyaltyPointsBalance?: number;
  loyaltyWallets?: CustomerWallet[];
  brands?: { id: number; name: string }[];
  branches?: { id: number; name: string }[];
  orderStats?: CustomerOrderStats;
};

export type PointsFilter = '' | 'any' | 'pos' | 'app' | 'both' | 'none';
export type LastOrderFilter = '' | '7' | '30' | '90' | 'lapsed30' | 'lapsed60' | 'lapsed90' | 'never';
export type OrdersFilter = '' | 'none' | 'some' | 'one' | 'repeat';
/** The quick-pick chips above the table. One at a time; '' is "All". */
export type SegmentFilter = '' | 'active' | 'lapsed' | 'never' | 'points';

/** A customer who completed an order within this many days is "active". */
export const ACTIVE_WITHIN_DAYS = 30;
/** One whose last completed order is older than this has "lapsed". */
export const LAPSED_AFTER_DAYS = 60;

/** The dropdowns' options, in the order they are offered. */
export const POINTS_OPTIONS: Array<{ value: PointsFilter; label: string }> = [
  { value: '', label: 'Any' },
  { value: 'any', label: 'Has points' },
  { value: 'pos', label: 'Has POS points' },
  { value: 'app', label: 'Has app points' },
  { value: 'both', label: 'Has both' },
  { value: 'none', label: 'No points' },
];
export const LAST_ORDER_OPTIONS: Array<{ value: LastOrderFilter; label: string }> = [
  { value: '', label: 'Any time' },
  { value: '7', label: 'In the last 7 days' },
  { value: '30', label: 'In the last 30 days' },
  { value: '90', label: 'In the last 90 days' },
  { value: 'lapsed30', label: 'Not for 30+ days' },
  { value: 'lapsed60', label: 'Not for 60+ days' },
  { value: 'lapsed90', label: 'Not for 90+ days' },
  { value: 'never', label: 'Never ordered' },
];
export const ORDERS_OPTIONS: Array<{ value: OrdersFilter; label: string }> = [
  { value: '', label: 'Any' },
  { value: 'none', label: 'None' },
  { value: 'some', label: 'At least 1' },
  { value: 'one', label: 'Exactly one' },
  { value: 'repeat', label: 'Repeat (2 or more)' },
];
export const SEGMENTS: Array<{ key: SegmentFilter; label: string }> = [
  { key: '', label: 'All' },
  { key: 'active', label: `Active · last ${ACTIVE_WITHIN_DAYS} days` },
  { key: 'lapsed', label: `Lapsed · ${LAPSED_AFTER_DAYS}+ days` },
  { key: 'never', label: 'Never ordered' },
  { key: 'points', label: 'Has points' },
];

export type CustomerFilters = {
  /** Name, phone or email contains this. */
  q: string;
  source: string;
  /** Brand id: ordered from, or linked to, this brand. */
  brand: string;
  /** Branch id: has a finished order at this branch. */
  branch: string;
  points: PointsFilter;
  minPoints: string;
  /** Registered on or after / on or before (YYYY-MM-DD, local). */
  regFrom: string;
  regTo: string;
  lastOrder: LastOrderFilter;
  orders: OrdersFilter;
  minOrders: string;
  minSpend: string;
  segment: SegmentFilter;
};

export const EMPTY_FILTERS: CustomerFilters = {
  q: '', source: '', brand: '', branch: '', points: '', minPoints: '',
  regFrom: '', regTo: '', lastOrder: '', orders: '', minOrders: '', minSpend: '', segment: '',
};

/** The filters tucked behind "More filters" — the rest are always on show. */
export const MORE_FILTER_KEYS: Array<keyof CustomerFilters> = [
  'points', 'minPoints', 'lastOrder', 'orders', 'minOrders', 'minSpend', 'regFrom', 'regTo',
];

/** Filter field → its query-string name. */
export const FILTER_PARAM: Record<keyof CustomerFilters, string> = {
  q: 'q', source: 'source', brand: 'brand', branch: 'branch', points: 'points',
  minPoints: 'min_points', regFrom: 'reg_from', regTo: 'reg_to', lastOrder: 'last_order',
  orders: 'orders', minOrders: 'min_orders', minSpend: 'min_spend', segment: 'segment',
};

const POINTS = POINTS_OPTIONS.map((o) => o.value);
const LAST_ORDER = LAST_ORDER_OPTIONS.map((o) => o.value);
const ORDERS = ORDERS_OPTIONS.map((o) => o.value);
const SEGMENT_KEYS = SEGMENTS.map((o) => o.key);
const oneOf = <T extends string>(allowed: T[], raw: string | null): T =>
  (allowed as string[]).includes(raw ?? '') ? ((raw ?? '') as T) : ('' as T);
const isDay = (raw: string | null) => (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '');
/** A non-negative number as typed, or '' — a stray "abc" in the URL filters nothing. */
const numeric = (raw: string | null) => (raw && /^\d+(\.\d+)?$/.test(raw.trim()) ? raw.trim() : '');
const id = (raw: string | null) => (raw && /^[1-9]\d*$/.test(raw) ? raw : '');

/** Read the filters out of the URL, dropping anything malformed. */
export function filtersFromParams(sp: URLSearchParams): CustomerFilters {
  return {
    q: sp.get(FILTER_PARAM.q) ?? '',
    source: sp.get(FILTER_PARAM.source) ?? '',
    brand: id(sp.get(FILTER_PARAM.brand)),
    branch: id(sp.get(FILTER_PARAM.branch)),
    points: oneOf(POINTS, sp.get(FILTER_PARAM.points)),
    minPoints: numeric(sp.get(FILTER_PARAM.minPoints)),
    regFrom: isDay(sp.get(FILTER_PARAM.regFrom)),
    regTo: isDay(sp.get(FILTER_PARAM.regTo)),
    lastOrder: oneOf(LAST_ORDER, sp.get(FILTER_PARAM.lastOrder)),
    orders: oneOf(ORDERS, sp.get(FILTER_PARAM.orders)),
    minOrders: numeric(sp.get(FILTER_PARAM.minOrders)),
    minSpend: numeric(sp.get(FILTER_PARAM.minSpend)),
    segment: oneOf(SEGMENT_KEYS, sp.get(FILTER_PARAM.segment)),
  };
}

/** How many filters are narrowing the list (for the "Clear" affordance). */
export function activeFilterCount(f: CustomerFilters): number {
  return (Object.keys(EMPTY_FILTERS) as Array<keyof CustomerFilters>).filter((k) => f[k] !== '').length;
}

/** How many of the tucked-away filters are set — shown on the "More filters" button. */
export function moreFilterCount(f: CustomerFilters): number {
  return MORE_FILTER_KEYS.filter((k) => f[k] !== '').length;
}

const wallets = (c: CustomerRow) => c.loyaltyWallets ?? [];

/** POS points — one brand's when `brandId` is given, otherwise every brand's. */
export function posPoints(c: CustomerRow, brandId?: number | null): number {
  return wallets(c)
    .filter((w) => w.wallet_type === 'pos' && (brandId == null || w.brand_id === brandId))
    .reduce((s, w) => s + (Number(w.balance) || 0), 0);
}

/** Mobile-app points: the one balance shared by all brands. */
export function appPoints(c: CustomerRow): number {
  return wallets(c)
    .filter((w) => w.wallet_type === 'app')
    .reduce((s, w) => s + (Number(w.balance) || 0), 0);
}

export function totalPoints(c: CustomerRow): number {
  return posPoints(c) + appPoints(c);
}

/**
 * The balance a "minimum points" filter compares against: the kind of points
 * picked (POS / app / either), and for POS only the picked brand's wallet.
 */
export function pointsForFilter(c: CustomerRow, f: Pick<CustomerFilters, 'points' | 'brand'>): number {
  const brandId = f.brand ? Number(f.brand) : null;
  if (f.points === 'pos') return posPoints(c, brandId);
  if (f.points === 'app') return appPoints(c);
  return posPoints(c, brandId) + appPoints(c);
}

const completed = (c: CustomerRow) => c.orderStats?.completed_count ?? 0;

export type CustomerStatus = {
  /**
   * active  — completed an order within ACTIVE_WITHIN_DAYS
   * lapsing — longer ago than that, but not yet LAPSED_AFTER_DAYS
   * lapsed  — nothing for more than LAPSED_AFTER_DAYS
   * never   — has never completed an order
   */
  key: 'active' | 'lapsing' | 'lapsed' | 'never';
  /** Whole days since the last completed order; null when there is none. */
  days: number | null;
};

/** Where a customer stands, going by their most recent COMPLETED order. */
export function customerStatus(lastOrderAt: string | null | undefined, now: Date = new Date()): CustomerStatus {
  const days = daysSince(lastOrderAt, now);
  if (days == null) return { key: 'never', days: null };
  if (days <= ACTIVE_WITHIN_DAYS) return { key: 'active', days };
  if (days <= LAPSED_AFTER_DAYS) return { key: 'lapsing', days };
  return { key: 'lapsed', days };
}

/** Does the customer belong to that quick-pick chip? '' (All) takes everyone. */
export function matchesSegment(c: CustomerRow, segment: SegmentFilter, now: Date = new Date()): boolean {
  if (!segment) return true;
  if (segment === 'points') return totalPoints(c) > 0;
  const status = customerStatus(c.orderStats?.last_order_at, now).key;
  if (segment === 'active') return status === 'active';
  if (segment === 'lapsed') return status === 'lapsed';
  return status === 'never';
}

export function filterCustomers(list: CustomerRow[], f: CustomerFilters, now: Date = new Date()): CustomerRow[] {
  const q = f.q.trim().toLowerCase();
  const brandId = f.brand ? Number(f.brand) : null;
  const branchId = f.branch ? Number(f.branch) : null;
  const minPoints = f.minPoints !== '' ? Number(f.minPoints) : null;
  const minOrders = f.minOrders !== '' ? Number(f.minOrders) : null;
  const minSpend = f.minSpend !== '' ? Number(f.minSpend) : null;

  return list.filter((c) => {
    if (q) {
      const hay = [c.name, c.phone, c.email].map((v) => (v ?? '').toLowerCase());
      if (!hay.some((v) => v.includes(q))) return false;
    }
    if (f.source && (c.source ?? 'pos') !== f.source) return false;
    if (brandId != null && !(c.brands ?? []).some((b) => Number(b.id) === brandId)) return false;
    if (branchId != null && !(c.branches ?? []).some((b) => Number(b.id) === branchId)) return false;

    if (!matchesSegment(c, f.segment, now)) return false;

    if (f.points) {
      const pos = posPoints(c, brandId);
      const app = appPoints(c);
      if (f.points === 'any' && pos + app <= 0) return false;
      if (f.points === 'pos' && pos <= 0) return false;
      if (f.points === 'app' && app <= 0) return false;
      if (f.points === 'both' && !(pos > 0 && app > 0)) return false;
      if (f.points === 'none' && totalPoints(c) > 0) return false;
    }
    if (minPoints != null && pointsForFilter(c, f) < minPoints) return false;

    if (f.regFrom || f.regTo) {
      const day = localDayKey(c.createdAt);
      if (!day) return false;
      if (f.regFrom && day < f.regFrom) return false;
      if (f.regTo && day > f.regTo) return false;
    }

    if (f.lastOrder) {
      const ago = daysSince(c.orderStats?.last_order_at, now);
      if (f.lastOrder === 'never') {
        if (ago != null) return false;
      } else if (f.lastOrder.startsWith('lapsed')) {
        // Ordered before, but not within the window. Never-ordered customers
        // are not "lapsed" — they have their own option. "Within N days" and
        // "not for N+ days" are exact opposites: N days ago is still within.
        const window = Number(f.lastOrder.slice('lapsed'.length));
        if (ago == null || ago <= window) return false;
      } else {
        const window = Number(f.lastOrder);
        if (ago == null || ago > window) return false;
      }
    }

    if (f.orders === 'none' && completed(c) !== 0) return false;
    if (f.orders === 'some' && completed(c) < 1) return false;
    if (f.orders === 'one' && completed(c) !== 1) return false;
    if (f.orders === 'repeat' && completed(c) < 2) return false;
    if (minOrders != null && completed(c) < minOrders) return false;

    if (minSpend != null) {
      const spent = c.orderStats?.spent;
      // A viewer without money totals has no spend to filter on.
      if (spent != null && spent < minSpend) return false;
    }
    return true;
  });
}

export type SortKey = 'name' | 'points' | 'completed' | 'cancelled' | 'spent' | 'last_order';
export type SortDir = 'asc' | 'desc';
export const SORT_KEYS: SortKey[] = ['name', 'points', 'completed', 'cancelled', 'spent', 'last_order'];

/** The direction a column sorts in on its first click. */
export function defaultSortDir(key: SortKey): SortDir {
  return key === 'name' ? 'asc' : 'desc';
}

/**
 * Sort a copy of the list. With no key the server's order stands (newest
 * registration first). Customers with nothing to compare — no name, never
 * ordered — always sink to the bottom, whichever way the column is sorted.
 */
export function sortCustomers(list: CustomerRow[], key: SortKey | '', dir: SortDir): CustomerRow[] {
  if (!key) return list;
  const sign = dir === 'asc' ? 1 : -1;
  const value = (c: CustomerRow): number | string | null => {
    switch (key) {
      case 'name': return c.name?.trim() ? c.name.trim().toLowerCase() : null;
      case 'points': return totalPoints(c);
      case 'completed': return c.orderStats?.completed_count ?? 0;
      case 'cancelled': return c.orderStats?.cancelled_count ?? 0;
      case 'spent': return c.orderStats?.spent ?? null;
      case 'last_order': {
        const t = c.orderStats?.last_order_at ? new Date(c.orderStats.last_order_at).getTime() : NaN;
        return Number.isNaN(t) ? null : t;
      }
    }
  };
  return [...list].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return b.id - a.id;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb);
    return cmp !== 0 ? cmp * sign : b.id - a.id;
  });
}

/**
 * How many customers each quick-pick chip would show, given every OTHER
 * filter as it stands — so a chip's number is what clicking it produces.
 */
export function segmentCounts(
  list: CustomerRow[],
  f: CustomerFilters,
  now: Date = new Date(),
): Record<SegmentFilter, number> {
  const base = filterCustomers(list, { ...f, segment: '' }, now);
  const counts = { '': base.length, active: 0, lapsed: 0, never: 0, points: 0 } as Record<SegmentFilter, number>;
  for (const c of base) {
    for (const { key } of SEGMENTS) if (key && matchesSegment(c, key, now)) counts[key] += 1;
  }
  return counts;
}

/** Distinct {id, name} options for a dropdown, from what the customers actually have. */
export function optionsFrom(list: CustomerRow[], pick: (c: CustomerRow) => { id: number; name: string }[] | undefined) {
  const seen = new Map<number, string>();
  for (const c of list) for (const o of pick(c) ?? []) if (!seen.has(Number(o.id))) seen.set(Number(o.id), o.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
