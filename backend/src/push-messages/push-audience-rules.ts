import { BadRequestException } from '@nestjs/common';
import { normalizePakistaniPhone } from '../utils/phone';
import type {
    AudienceRuleInput,
    AudienceSpec,
    PushAudienceScope,
} from './push-message.types';

/**
 * Every audience rule the admin page offers, defined once: its label, its
 * inputs, and the SQL that tests one customer (`c` = customers). The page
 * draws its rule picker and inputs from GET /meta, so a rule added here shows
 * up without touching the frontend.
 *
 * All values reach SQL as bound parameters; only the fixed fragments below are
 * ever concatenated.
 */

export type RuleGroup =
    | 'who'
    | 'where'
    | 'when'
    | 'how_much'
    | 'what'
    | 'loyalty'
    | 'cart'
    | 'phone';

export type RuleParamType =
    | 'brands'
    | 'branches'
    | 'branch'
    | 'categories'
    | 'items'
    | 'order_types'
    | 'sources'
    | 'platform'
    | 'phone'
    | 'phones'
    | 'message'
    | 'int'
    | 'money';

export interface RuleParamDef {
    name: string;
    type: RuleParamType;
    label: string;
    required: boolean;
    min?: number;
    max?: number;
    default?: number;
    /** Unit shown after a number input ("days", "km", "Rs"). */
    suffix?: string;
    /** Shown under the input. */
    hint?: string;
}

export interface AudienceRuleDef {
    key: string;
    group: RuleGroup;
    label: string;
    description: string;
    params: RuleParamDef[];
    build(p: Record<string, unknown>, bind: Binder): string;
}

export type Binder = (value: unknown) => string;

/** Collects positional parameters ($1, $2, …) for one query. */
export class SqlParams {
    readonly values: unknown[] = [];
    constructor(private readonly offset = 0) {}
    bind: Binder = (value: unknown) => {
        this.values.push(value);
        return `$${this.offset + this.values.length}`;
    };
}

export const ORDER_TYPES = ['delivery', 'takeaway', 'dine_in'] as const;
export const ORDER_SOURCES = [
    'consumer_app',
    'consumer_web',
    'pos',
    'call_centre',
    'kiosk',
] as const;
export const PLATFORMS = ['android', 'ios'] as const;

/** A placed, not-cancelled order of this customer (alias `o`). */
const ORDERED = `o.customer_id = c.id AND o.status <> 'cancelled'`;

const withinDays = (p: Record<string, unknown>, bind: Binder): string =>
    p.within_days != null
        ? ` AND o.placed_at >= now() - make_interval(days => ${bind(p.within_days)})`
        : '';

const WITHIN_DAYS: RuleParamDef = {
    name: 'within_days',
    type: 'int',
    label: 'In the last',
    required: false,
    min: 1,
    max: 3650,
    suffix: 'days',
    hint: 'Leave empty for any time',
};

/** Great-circle distance in km between two rows that have latitude/longitude. */
const distanceKm = (a: string, b: string): string =>
    `(6371 * 2 * asin(least(1, sqrt(
        power(sin(radians(${b}.latitude::float - ${a}.latitude::float) / 2), 2)
        + cos(radians(${a}.latitude::float)) * cos(radians(${b}.latitude::float))
        * power(sin(radians(${b}.longitude::float - ${a}.longitude::float) / 2), 2)))))`;

/** Last 10 digits — matches 03001234567, 3001234567 and +923001234567 alike. */
export const PHONE_KEY_SQL = `right(regexp_replace(c.phone, '\\D', '', 'g'), 10)`;
export function phoneKey(raw: string): string | null {
    const n = normalizePakistaniPhone(String(raw ?? ''));
    return n ? n.slice(-10) : null;
}

export const AUDIENCE_RULES: AudienceRuleDef[] = [
    // —— Who ——
    {
        key: 'phone',
        group: 'who',
        label: 'One customer by phone',
        description: 'The customer with this phone number.',
        params: [
            { name: 'phone', type: 'phone', label: 'Phone', required: true },
        ],
        build: (p, bind) => `${PHONE_KEY_SQL} = ${bind(p.phone)}`,
    },
    {
        key: 'phone_list',
        group: 'who',
        label: 'A list of phone numbers',
        description: 'Customers whose phone is on the pasted list.',
        params: [
            {
                name: 'phones',
                type: 'phones',
                label: 'Phone numbers',
                required: true,
                hint: 'One per line, or separated by commas',
            },
        ],
        build: (p, bind) => `${PHONE_KEY_SQL} = ANY(${bind(p.phones)}::text[])`,
    },
    {
        key: 'got_message',
        group: 'who',
        label: 'Got a push notification',
        description:
            'Was sent this notification — optionally only those who did not order within N days of getting it.',
        params: [
            {
                name: 'message_id',
                type: 'message',
                label: 'Notification',
                required: true,
            },
            {
                name: 'no_order_within_days',
                type: 'int',
                label: 'And did not order within',
                required: false,
                min: 1,
                max: 90,
                suffix: 'days',
                hint: 'Leave empty for everyone who got it',
            },
        ],
        build: (p, bind) => {
            const noOrder =
                p.no_order_within_days != null
                    ? ` AND NOT EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED}
                        AND o.placed_at >= r.sent_at
                        AND o.placed_at < r.sent_at + make_interval(days => ${bind(p.no_order_within_days)}))`
                    : '';
            return `EXISTS (SELECT 1 FROM push_message_recipients r
                WHERE r.customer_id = c.id AND r.tenant_id = c.tenant_id
                  AND r.message_id = ${bind(p.message_id)} AND r.status = 'sent'${noOrder})`;
        },
    },

    // —— Where ——
    {
        key: 'ordered_from_brand',
        group: 'where',
        label: 'Ordered from brand',
        description: 'Has placed an order with any of these brands.',
        params: [
            {
                name: 'brand_ids',
                type: 'brands',
                label: 'Brands',
                required: true,
            },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED}
                AND o.brand_id = ANY(${bind(p.brand_ids)}::int[])${withinDays(p, bind)})`,
    },
    {
        key: 'ordered_at_branch',
        group: 'where',
        label: 'Ordered at branch',
        description: 'Has placed an order at any of these branches.',
        params: [
            {
                name: 'branch_ids',
                type: 'branches',
                label: 'Branches',
                required: true,
            },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED}
                AND o.branch_id = ANY(${bind(p.branch_ids)}::int[])${withinDays(p, bind)})`,
    },
    {
        key: 'near_branch',
        group: 'where',
        label: 'Lives near a branch',
        description:
            'A saved delivery address (or their pinned location) within this distance of the branch.',
        params: [
            {
                name: 'branch_id',
                type: 'branch',
                label: 'Branch',
                required: true,
            },
            {
                name: 'km',
                type: 'int',
                label: 'Within',
                required: true,
                min: 1,
                max: 100,
                default: 5,
                suffix: 'km',
            },
        ],
        build: (p, bind) => {
            const km = bind(p.km);
            return `EXISTS (SELECT 1 FROM branches nb
                WHERE nb.id = ${bind(p.branch_id)} AND nb.latitude IS NOT NULL AND (
                    EXISTS (SELECT 1 FROM customer_addresses ca
                        WHERE ca.tenant_id = c.tenant_id AND ca.deleted_at IS NULL
                          AND (ca.customer_id = c.id OR (ca.customer_id IS NULL AND ca.customer_phone = c.phone))
                          AND ca.latitude IS NOT NULL
                          AND ${distanceKm('ca', 'nb')} <= ${km})
                    OR (c.latitude IS NOT NULL AND ${distanceKm('c', 'nb')} <= ${km})))`;
        },
    },

    // —— When ——
    {
        key: 'ordered_recently',
        group: 'when',
        label: 'Ordered recently',
        description: 'Placed an order in the last N days.',
        params: [
            {
                name: 'days',
                type: 'int',
                label: 'In the last',
                required: true,
                min: 1,
                max: 3650,
                default: 30,
                suffix: 'days',
            },
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED}
                AND o.placed_at >= now() - make_interval(days => ${bind(p.days)}))`,
    },
    {
        key: 'lapsed',
        group: 'when',
        label: 'Has not ordered for a while',
        description:
            'Ordered before, but not in the last N days — the win-back audience.',
        params: [
            {
                name: 'days',
                type: 'int',
                label: 'No order in',
                required: true,
                min: 1,
                max: 3650,
                default: 30,
                suffix: 'days',
            },
        ],
        build: (p, bind) =>
            `(EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED})
              AND NOT EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED}
                AND o.placed_at >= now() - make_interval(days => ${bind(p.days)})))`,
    },
    {
        key: 'never_ordered',
        group: 'when',
        label: 'Signed up but never ordered',
        description: 'Has an account and no order yet.',
        params: [],
        build: () => `NOT EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED})`,
    },
    {
        key: 'joined',
        group: 'when',
        label: 'Joined between',
        description:
            'Account created between these many days ago (0 = today). "0 to 1" is everyone who joined in the last day.',
        params: [
            {
                name: 'from_days',
                type: 'int',
                label: 'From',
                required: true,
                min: 0,
                max: 3650,
                default: 0,
                suffix: 'days ago',
            },
            {
                name: 'to_days',
                type: 'int',
                label: 'To',
                required: true,
                min: 1,
                max: 3650,
                default: 7,
                suffix: 'days ago',
            },
        ],
        build: (p, bind) =>
            `(c.created_at <= now() - make_interval(days => ${bind(p.from_days)})
              AND c.created_at > now() - make_interval(days => ${bind(p.to_days)}))`,
    },

    // —— How much ——
    {
        key: 'min_orders',
        group: 'how_much',
        label: 'Number of orders',
        description: 'At least this many completed orders.',
        params: [
            {
                name: 'count',
                type: 'int',
                label: 'At least',
                required: true,
                min: 1,
                max: 10000,
                default: 5,
                suffix: 'orders',
            },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `(SELECT count(*) FROM orders o WHERE o.customer_id = c.id
                AND o.status = 'completed'${withinDays(p, bind)}) >= ${bind(p.count)}`,
    },
    {
        key: 'min_spend',
        group: 'how_much',
        label: 'Total spent',
        description: 'Completed orders adding up to at least this much.',
        params: [
            {
                name: 'amount',
                type: 'money',
                label: 'At least',
                required: true,
                min: 1,
                max: 100000000,
                default: 10000,
                suffix: 'Rs',
            },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `(SELECT COALESCE(sum(o.total_amount), 0) FROM orders o WHERE o.customer_id = c.id
                AND o.status = 'completed'${withinDays(p, bind)}) >= ${bind(p.amount)}`,
    },

    // —— What ——
    {
        key: 'ordered_item',
        group: 'what',
        label: 'Ordered a menu item',
        description: 'Has ordered any of these items.',
        params: [
            { name: 'item_ids', type: 'items', label: 'Items', required: true },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                WHERE ${ORDERED} AND oi.menu_item_id = ANY(${bind(p.item_ids)}::int[])${withinDays(p, bind)})`,
    },
    {
        key: 'ordered_category',
        group: 'what',
        label: 'Ordered from a category',
        description: 'Has ordered anything in these menu categories.',
        params: [
            {
                name: 'category_ids',
                type: 'categories',
                label: 'Categories',
                required: true,
            },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                JOIN menu_items mi ON mi.id = oi.menu_item_id
                WHERE ${ORDERED} AND mi.category_id = ANY(${bind(p.category_ids)}::int[])${withinDays(p, bind)})`,
    },
    {
        key: 'mostly_order_type',
        group: 'what',
        label: 'Usually orders as',
        description:
            'At least half of their orders were of these types (delivery, takeaway, dine-in).',
        params: [
            {
                name: 'order_types',
                type: 'order_types',
                label: 'Order types',
                required: true,
            },
        ],
        build: (p, bind) =>
            `(SELECT count(*) > 0
                     AND count(*) FILTER (WHERE o.order_type = ANY(${bind(p.order_types)}::text[])) * 2 >= count(*)
              FROM orders o WHERE ${ORDERED})`,
    },
    {
        key: 'ordered_via',
        group: 'what',
        label: 'Ordered through',
        description:
            'Has ordered through these channels (app, website, till…).',
        params: [
            {
                name: 'sources',
                type: 'sources',
                label: 'Channels',
                required: true,
            },
            WITHIN_DAYS,
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM orders o WHERE ${ORDERED}
                AND o.source = ANY(${bind(p.sources)}::text[])${withinDays(p, bind)})`,
    },

    // —— Loyalty ——
    {
        key: 'app_points',
        group: 'loyalty',
        label: 'App points balance',
        description: 'Has at least this many points in their app wallet.',
        params: [
            {
                name: 'points',
                type: 'int',
                label: 'At least',
                required: true,
                min: 1,
                max: 100000000,
                default: 500,
                suffix: 'points',
            },
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM loyalty_wallets w WHERE w.customer_id = c.id
                AND w.wallet_type = 'app' AND w.balance >= ${bind(p.points)})`,
    },

    // —— Cart ——
    {
        key: 'abandoned_cart',
        group: 'cart',
        label: 'Left items in the cart',
        description:
            'Added items to their cart and has not ordered since. Only works if the app saves the cart on our server.',
        params: [
            {
                name: 'within_hours',
                type: 'int',
                label: 'Cart touched in the last',
                required: true,
                min: 1,
                max: 720,
                default: 48,
                suffix: 'hours',
            },
            {
                name: 'idle_minutes',
                type: 'int',
                label: 'Untouched for at least',
                required: true,
                min: 5,
                max: 1440,
                default: 60,
                suffix: 'minutes',
            },
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM carts ct
                CROSS JOIN LATERAL (SELECT max(ci.updated_at) AS touched FROM cart_items ci WHERE ci.cart_id = ct.id) t
                WHERE ct.customer_id = c.id AND t.touched IS NOT NULL
                  AND t.touched >= now() - make_interval(hours => ${bind(p.within_hours)})
                  AND t.touched <= now() - make_interval(mins => ${bind(p.idle_minutes)})
                  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.placed_at >= t.touched))`,
    },

    // —— Phone ——
    {
        key: 'platform',
        group: 'phone',
        label: 'Phone type',
        description:
            'Has the app on this kind of phone. With "match all", only those phones are sent to.',
        params: [
            {
                name: 'platform',
                type: 'platform',
                label: 'Phone',
                required: true,
            },
        ],
        build: (p, bind) =>
            `EXISTS (SELECT 1 FROM push_devices pd WHERE pd.owner_id = c.id AND pd.platform = ${bind(p.platform)})`,
    },
];

const RULES_BY_KEY = new Map(AUDIENCE_RULES.map((r) => [r.key, r]));
export const MAX_RULES = 20;

/** A scalar from a JSON body as text ('' for anything else). */
function asText(v: unknown): string {
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

export function ruleDef(key: string): AudienceRuleDef {
    const def = RULES_BY_KEY.get(key);
    if (!def) throw new BadRequestException(`Unknown audience rule "${key}"`);
    return def;
}

function intList(value: unknown, label: string): number[] {
    const arr = Array.isArray(value) ? value : value == null ? [] : [value];
    const ids = [
        ...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0)),
    ];
    if (ids.length === 0) {
        throw new BadRequestException(`Pick at least one ${label}`);
    }
    return ids;
}

function oneOf<T extends string>(
    value: unknown,
    allowed: readonly T[],
    label: string,
): T[] {
    const arr = Array.isArray(value) ? value : value == null ? [] : [value];
    const picked = [
        ...new Set(arr.map(String).filter((v) => allowed.includes(v as T))),
    ] as T[];
    if (picked.length === 0) {
        throw new BadRequestException(`Pick at least one ${label}`);
    }
    return picked;
}

function numberParam(def: RuleParamDef, value: unknown): number | null {
    if (value == null || value === '') {
        if (def.required) {
            throw new BadRequestException(`"${def.label}" is required`);
        }
        return null;
    }
    const n = Number(value);
    const ok = def.type === 'money' ? Number.isFinite(n) : Number.isInteger(n);
    if (!ok) {
        throw new BadRequestException(`"${def.label}" must be a number`);
    }
    if (def.min != null && n < def.min) {
        throw new BadRequestException(
            `"${def.label}" must be at least ${def.min}`,
        );
    }
    if (def.max != null && n > def.max) {
        throw new BadRequestException(
            `"${def.label}" must be at most ${def.max}`,
        );
    }
    return n;
}

/**
 * Check one rule's params and return them cleaned (right types, unknown keys
 * dropped). `scope` refuses brands / branches outside a restricted author's
 * reach, so a brand admin cannot aim at another brand's customers.
 */
export function normalizeRule(
    input: AudienceRuleInput,
    scope: PushAudienceScope,
): AudienceRuleInput {
    const def = ruleDef(String(input?.rule ?? ''));
    const raw = input?.params ?? {};
    const params: Record<string, unknown> = {};
    for (const pd of def.params) {
        const v = raw[pd.name];
        switch (pd.type) {
            case 'brands': {
                const ids = intList(v, 'brand');
                if (
                    scope.brand_ids &&
                    ids.some((id) => !scope.brand_ids!.includes(id))
                ) {
                    throw new BadRequestException(
                        'You can only target your own brand',
                    );
                }
                params[pd.name] = ids;
                break;
            }
            case 'branches':
            case 'branch': {
                const ids = intList(v, 'branch');
                if (
                    scope.branch_ids &&
                    ids.some((id) => !scope.branch_ids!.includes(id))
                ) {
                    throw new BadRequestException(
                        'You can only target your own branches',
                    );
                }
                params[pd.name] = pd.type === 'branch' ? ids[0] : ids;
                break;
            }
            case 'message':
                params[pd.name] = intList(v, 'notification')[0];
                break;
            case 'categories':
                params[pd.name] = intList(v, 'category');
                break;
            case 'items':
                params[pd.name] = intList(v, 'item');
                break;
            case 'order_types':
                params[pd.name] = oneOf(v, ORDER_TYPES, 'order type');
                break;
            case 'sources':
                params[pd.name] = oneOf(v, ORDER_SOURCES, 'channel');
                break;
            case 'platform':
                params[pd.name] = oneOf(v, PLATFORMS, 'phone type')[0];
                break;
            case 'phone': {
                const key = phoneKey(asText(v));
                if (!key) {
                    throw new BadRequestException(
                        'Enter a valid Pakistani mobile number',
                    );
                }
                params[pd.name] = key;
                break;
            }
            case 'phones': {
                const list = (Array.isArray(v) ? v.join('\n') : asText(v))
                    .split(/[\s,;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                const keys = [...new Set(list.map(phoneKey).filter(Boolean))];
                if (keys.length === 0) {
                    throw new BadRequestException(
                        'Paste at least one valid phone number',
                    );
                }
                if (keys.length > 50_000) {
                    throw new BadRequestException(
                        'At most 50,000 phone numbers',
                    );
                }
                params[pd.name] = keys;
                break;
            }
            case 'int':
            case 'money': {
                const n = numberParam(pd, v);
                if (n != null) params[pd.name] = n;
                break;
            }
        }
    }
    if (def.key === 'joined') {
        const from = Number(params.from_days);
        const to = Number(params.to_days);
        if (to <= from) {
            throw new BadRequestException(
                '"Joined between": the second number must be bigger than the first',
            );
        }
    }
    return { rule: def.key, params };
}

/** Check a whole audience from the API; throws 400 with a readable reason. */
export function normalizeAudience(
    raw: unknown,
    scope: PushAudienceScope,
): AudienceSpec {
    const a = (raw ?? {}) as Partial<AudienceSpec>;
    const include = Array.isArray(a.include) ? a.include : [];
    const exclude = Array.isArray(a.exclude) ? a.exclude : [];
    if (include.length + exclude.length > MAX_RULES) {
        throw new BadRequestException(`At most ${MAX_RULES} rules`);
    }
    return {
        match: a.match === 'any' ? 'any' : 'all',
        include: include.map((r) => normalizeRule(r, scope)),
        exclude: exclude.map((r) => normalizeRule(r, scope)),
    };
}

/**
 * The WHERE condition (on `c`) for an audience: "(include all/any) AND NOT
 * (any exclude)". An empty include means every customer.
 */
export function audienceConditionSql(
    audience: AudienceSpec,
    bind: Binder,
): string {
    const inc = audience.include.map(
        (r) => `(${ruleDef(r.rule).build(r.params ?? {}, bind)})`,
    );
    const exc = audience.exclude.map(
        (r) => `(${ruleDef(r.rule).build(r.params ?? {}, bind)})`,
    );
    const joiner = audience.match === 'any' ? ' OR ' : ' AND ';
    const includeSql = inc.length ? `(${inc.join(joiner)})` : 'TRUE';
    const excludeSql = exc.length ? ` AND NOT (${exc.join(' OR ')})` : '';
    return `${includeSql}${excludeSql}`;
}

/**
 * Phone types to send to: with "match all", an included platform rule limits
 * which of a customer's phones get it. Null = every phone.
 */
export function devicePlatforms(audience: AudienceSpec): string[] | null {
    if (audience.match !== 'all') return null;
    const picked = audience.include
        .filter((r) => r.rule === 'platform')
        .map((r) => String(r.params?.platform));
    return picked.length ? [...new Set(picked)] : null;
}

/** The author's reach as SQL on `c` (empty string = unrestricted). */
export function scopeConditionSql(
    scope: PushAudienceScope,
    bind: Binder,
): string {
    const parts: string[] = [];
    if (scope.brand_ids) {
        const ids = bind(scope.brand_ids);
        // Same reach as the Customers page for brand-locked staff: ordered from
        // their brand, or explicitly linked to it.
        parts.push(`(EXISTS (SELECT 1 FROM orders so WHERE so.customer_id = c.id
                        AND so.brand_id = ANY(${ids}::int[]))
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.brand_ids, '[]'::jsonb)) be
                        WHERE (be)::int = ANY(${ids}::int[])))`);
    }
    if (scope.branch_ids) {
        parts.push(`EXISTS (SELECT 1 FROM orders sb WHERE sb.customer_id = c.id
                        AND sb.branch_id = ANY(${bind(scope.branch_ids)}::int[]))`);
    }
    return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

/** The public description of the rules for GET /meta (no SQL). */
export function audienceRulesMeta() {
    return AUDIENCE_RULES.map((r) => ({
        key: r.key,
        group: r.group,
        label: r.label,
        description: r.description,
        params: r.params,
    }));
}
