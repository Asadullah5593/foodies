/**
 * What gets logged, and what it is called.
 *
 * Two lists do the work:
 *
 * - SKIP: high-frequency machine traffic (POS quotes, KDS status churn, rider
 *   GPS, consumer cart). Without this the table is 90% noise and the useful
 *   rows are unfindable.
 * - SENSITIVE_READS: the GETs worth keeping, because "who looked at the
 *   customer list" is a real question. Everything else read-only is ignored.
 */

export type CaptureLevel =
    | 'off'
    | 'mutations'
    | 'mutations+sensitive_reads'
    | 'all';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Machine chatter. Matched as a prefix against the path (without `/api`).
 * Money-moving order routes are deliberately NOT here — see isSkippedRoute.
 */
const SKIP_PREFIXES = [
    '/pos/orders/quote',
    '/rider/location',
    '/rider/orders/location',
    '/consumer/cart',
    '/kitchen/orders/status',
    '/notifications/read',
    '/health',
    '/api-docs',
];

/** Kept even though they sit under a skipped prefix — the money and the outliers. */
const SKIP_EXCEPTIONS = [
    '/pay',
    '/void',
    '/refund',
    '/cancel',
    '/discount',
    '/comp',
];

/** Reads worth an audit row. Prefix match, GET only. */
const SENSITIVE_READ_PREFIXES = [
    '/admin/customers',
    '/admin/rider-hrm/profiles',
    '/admin/rider-hrm/payroll',
    '/admin/reports',
    '/admin/shifts',
    '/admin/branches',
    '/admin/activity-logs',
];

/**
 * Routes whose rows SHOULD carry a before/after diff. A row from one of these
 * with `changes = NULL` means the instrumentation is missing — which is then a
 * query, not a mystery.
 */
const DIFF_EXPECTED_PREFIXES = [
    '/admin/roles',
    '/admin/users',
    '/admin/branch-users',
    '/admin/menu-items',
    '/admin/branch-menu-items',
    '/admin/discounts',
    '/admin/coupons',
    '/admin/brands',
    '/admin/branches',
    '/admin/shifts',
];

/** Actions written immediately instead of via the batch buffer. */
const CRITICAL_ACTIONS = [
    'auth.login',
    'auth.login.failed',
    'auth.logout',
    'role.',
    'permission.',
    'user.create',
    'user.delete',
    'user.password',
    'shift.close',
    'shift.cash-out',
    'menu-item.price',
    'branch-menu-item.',
    'discount.create',
    'activity-log.',
];

/**
 * English-ish singularisation for action names. A naive `replace(/s$/, '')`
 * produces `categorie.create` and `branche.update`, which look like typos in
 * every filter and report.
 */
export function singularise(word: string): string {
    const w = word.toLowerCase();
    if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
    if (/(ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
    if (w.endsWith('ss')) return w;
    if (w.endsWith('s') && w.length > 2) return w.slice(0, -1);
    return w;
}

/** Strips the global `/api` prefix and the query string. */
export function normalisePath(url: string): string {
    const path = (url.split('?')[0] || '').replace(/\/+$/, '');
    return path.startsWith('/api') ? path.slice(4) || '/' : path || '/';
}

export function isSkippedRoute(method: string, path: string): boolean {
    if (SKIP_EXCEPTIONS.some((e) => path.includes(e))) return false;
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return true;
    // A POS order create is skipped, but its payment/void/refund is not (above).
    if (method === 'POST' && path === '/pos/orders') return true;
    return false;
}

export function isSensitiveRead(method: string, path: string): boolean {
    if (method !== 'GET') return false;
    return SENSITIVE_READ_PREFIXES.some((p) => path.startsWith(p));
}

export function expectsDiff(method: string, path: string): boolean {
    if (method !== 'PUT' && method !== 'PATCH') return false;
    return DIFF_EXPECTED_PREFIXES.some((p) => path.startsWith(p));
}

export function isCriticalAction(action: string): boolean {
    return CRITICAL_ACTIONS.some((a) => action.startsWith(a));
}

/** Should this request produce a row at all, at the configured capture level? */
export function shouldCapture(
    level: CaptureLevel,
    method: string,
    path: string,
    statusCode: number,
): boolean {
    if (level === 'off') return false;
    if (level === 'all') return true;

    // A refused request is always worth a row, whatever it was aimed at:
    // denied access is the highest-value event in the whole table, and an
    // interceptor-based design would never have seen it.
    if (statusCode === 401 || statusCode === 403) return true;

    // So is a server error. Skipping POS/KDS chatter is about volume, and a 500
    // is not volume — it is the one time that traffic is worth reading. Without
    // this, the busiest routes in the system are also the ones whose failures
    // are invisible.
    if (statusCode >= 500) return true;

    if (isSkippedRoute(method, path)) return false;
    if (MUTATING.has(method)) return true;
    if (level === 'mutations+sensitive_reads') {
        return isSensitiveRead(method, path);
    }
    return false;
}

/**
 * A stable, dotted action name derived from the route, e.g.
 * `PUT /admin/menu-items/12` → `menu-item.update`. Handler metadata refines
 * this when the interceptor runs; this is the fallback that guarantees every
 * row is named even when it does not.
 */
export function deriveAction(method: string, path: string): string {
    const segments = path.split('/').filter(Boolean);
    const meaningful = segments.filter(
        (s) => !/^\d+$/.test(s) && s !== 'api' && s !== 'admin',
    );
    const resource = singularise(meaningful[0] ?? 'request');
    const sub = meaningful.length > 1 ? meaningful[meaningful.length - 1] : '';
    const verb =
        method === 'POST'
            ? 'create'
            : method === 'PUT' || method === 'PATCH'
              ? 'update'
              : method === 'DELETE'
                ? 'delete'
                : 'view';
    // A trailing non-id segment is usually the real verb (`/shifts/5/close`).
    if (sub && sub !== resource && sub !== `${resource}s` && method !== 'GET') {
        return `${resource}.${sub}`.toLowerCase();
    }
    return `${resource}.${verb}`.toLowerCase();
}

/**
 * Refines an action with what actually happened. A failed login and a
 * successful one are different events for alerting — "five auth.login rows from
 * one IP" is meaningless if you cannot tell them apart without also reading the
 * status code.
 */
export function refineAction(action: string, statusCode: number): string {
    if (statusCode < 400) return action;
    if (action === 'auth.login' || action.endsWith('.login')) {
        return 'auth.login.failed';
    }
    return action;
}

/** Coarse bucket for the UI's filter chips. */
export function deriveActionGroup(path: string): string {
    const p = path.replace(/^\/api/, '');
    if (p.startsWith('/auth') || p.includes('/login')) return 'auth';
    if (p.startsWith('/admin/reports')) return 'reports';
    if (p.startsWith('/admin/inventory') || p.startsWith('/admin/procurement'))
        return 'inventory';
    if (p.startsWith('/admin/roles') || p.startsWith('/admin/users'))
        return 'access';
    if (p.startsWith('/admin/shifts')) return 'shifts';
    if (p.includes('/orders')) return 'orders';
    if (
        p.startsWith('/admin/menu') ||
        p.startsWith('/admin/categories') ||
        p.startsWith('/admin/deals')
    )
        return 'menu';
    if (p.startsWith('/admin/discounts') || p.startsWith('/admin/coupons'))
        return 'offers';
    if (p.startsWith('/admin/activity-log')) return 'audit';
    return 'other';
}

export function outcomeFor(statusCode: number): string {
    if (statusCode === 401 || statusCode === 403) return 'denied';
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'failed';
    return 'success';
}
