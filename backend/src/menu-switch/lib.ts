/**
 * Menu switch — shared helpers (data source, brand lookup, live export,
 * manifest IO, order-history checksum, prod guard).
 */
import { config as dotenvConfig } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

dotenvConfig({ path: join(process.cwd(), '.env') });

export const DB_NAME = process.env.DB_DATABASE ?? 'foodies';
export const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';

export function openDataSource() {
    return new DataSource({
        type: 'postgres',
        host: DB_HOST,
        port: parseInt(process.env.DB_PORT ?? '5432', 10),
        username: process.env.DB_USERNAME ?? 'postgres',
        password: String(process.env.DB_PASSWORD ?? ''),
        database: DB_NAME,
        ssl:
            process.env.DB_SSL === 'true'
                ? { rejectUnauthorized: false }
                : false,
        namingStrategy: new SnakeNamingStrategy(),
        synchronize: false,
        entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
    });
}

/**
 * Standing rule: production is hands-off unless explicitly authorised.
 * The live DB is the RDS database literally named "foodies".
 */
export function assertNotProd(action: string) {
    const looksLikeProd =
        DB_NAME === 'foodies' && /rds\.amazonaws\.com/i.test(DB_HOST);
    if (looksLikeProd && process.env.MENU_SWITCH_ALLOW_PROD !== '1') {
        console.error(
            `REFUSING to ${action} on ${DB_NAME}@${DB_HOST}: this looks like PRODUCTION.\n` +
                `Set MENU_SWITCH_ALLOW_PROD=1 only with an explicit go-ahead.`,
        );
        process.exit(2);
    }
}

/**
 * TypeORM returns `UPDATE/DELETE … RETURNING` as a `[rows, affectedCount]`
 * tuple, but `INSERT … RETURNING` as plain rows. Normalise to rows.
 */
export function returningRows<T>(res: unknown): T[] {
    if (
        Array.isArray(res) &&
        res.length === 2 &&
        Array.isArray(res[0]) &&
        typeof res[1] === 'number'
    ) {
        return res[0] as T[];
    }
    return res as T[];
}

export function slugify(name: string, brandSlug: string) {
    return `${name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')}-${brandSlug}`;
}

// ——— Live export (active items with their full configuration) ———
export type LiveModifier = {
    id: number;
    name: string;
    price: string | number;
    price_by_size: Record<string, number> | null;
    sizes: string[] | null;
};
export type LiveGroup = {
    group_id: number;
    name: string;
    min: number;
    max: number;
    min_by_size: Record<string, number> | null;
    max_by_size: Record<string, number> | null;
    included: number;
    included_by_size: Record<string, number> | null;
    allow_qty: boolean;
    price_tiers: Record<string, number> | null;
    hide_in_deals: boolean;
    visible_when: number[] | null;
    pos: number | null;
    modifiers: LiveModifier[] | null;
};
export type LiveItem = {
    id: number;
    brand_id: number;
    name: string;
    image_url: string | null;
    groups: LiveGroup[] | null;
};

export async function loadLiveItems(
    ds: DataSource,
    brandIds: number[],
): Promise<LiveItem[]> {
    const rows: Array<{ j: LiveItem }> = await ds.query(
        `select row_to_json(i) as j from (
           select i.id, i.brand_id, i.name, i.image_url,
             (select json_agg(json_build_object(
                 'group_id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
                 'min_by_size', g.min_select_by_size, 'max_by_size', g.max_select_by_size,
                 'included', g.included_quantity, 'included_by_size', g.included_by_size,
                 'allow_qty', g.allow_quantity, 'price_tiers', g.price_tiers,
                 'hide_in_deals', g.hide_in_deals, 'visible_when', g.visible_when_modifier_ids,
                 'pos', p.sort_order,
                 'modifiers', (select json_agg(json_build_object('id', m.id, 'name', m.name, 'price', m.price,
                                 'price_by_size', m.price_by_size, 'sizes', m.available_for_sizes)
                               order by m.sort_order, m.id) from modifiers m where m.modifier_group_id = g.id)
               ) order by coalesce(p.sort_order, 999), g.id)
              from menu_item_modifier_groups mg
              join modifier_groups g on g.id = mg.modifier_group_id
              left join menu_item_modifier_group_positions p on p.menu_item_id = i.id and p.modifier_group_id = g.id
              where mg.menu_item_id = i.id) as groups
           from menu_items i
           join menu_categories c on c.id = i.category_id
           where i.brand_id = any($1::int[]) and i.is_active and c.is_active
         ) i`,
        [brandIds],
    );
    return rows.map((r) => r.j);
}

// ——— Order-history checksum (must be identical before/after any switch) ———
export type HistoryChecksum = {
    orders: number;
    order_total: string;
    order_items: number;
    order_items_named: number;
    order_item_modifiers: number;
    order_item_addons: number;
};
export async function historyChecksum(
    ds: DataSource,
): Promise<HistoryChecksum> {
    const [r]: HistoryChecksum[] = await ds.query(`
        select (select count(*)::int from orders) as orders,
               (select coalesce(sum(total_amount),0)::text from orders) as order_total,
               (select count(*)::int from order_items) as order_items,
               (select count(name_snapshot)::int from order_items) as order_items_named,
               (select count(*)::int from order_item_modifiers) as order_item_modifiers,
               (select count(*)::int from order_item_addons) as order_item_addons`);
    return r;
}
export function assertSameChecksum(a: HistoryChecksum, b: HistoryChecksum) {
    const diff = (Object.keys(a) as Array<keyof HistoryChecksum>).filter(
        (k) => String(a[k]) !== String(b[k]),
    );
    if (diff.length) {
        throw new Error(
            `ORDER HISTORY CHANGED: ${diff.map((k) => `${k} ${String(a[k])}→${String(b[k])}`).join(', ')}`,
        );
    }
}

// ——— Manifest ———
export type Manifest = {
    db: string;
    host: string;
    status: 'applied' | 'reverted';
    appliedAt: string;
    revertedAt?: string;
    brands: Array<{ id: number; name: string; slug: string }>;
    deactivated: { items: number[]; categories: number[]; addons: number[] };
    created: {
        items: number[];
        categories: number[];
        addons: number[];
        groups: number[];
    };
    checksumBefore: HistoryChecksum;
    checksumAfter?: HistoryChecksum;
};

const MANIFEST_DIR = join(process.cwd(), 'menu-switch-manifests');
export function manifestPath(db = DB_NAME) {
    return join(MANIFEST_DIR, `${db}.json`);
}
export function readManifest(db = DB_NAME): Manifest | null {
    const p = manifestPath(db);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as Manifest;
}
export function writeManifest(m: Manifest) {
    mkdirSync(MANIFEST_DIR, { recursive: true });
    writeFileSync(manifestPath(m.db), JSON.stringify(m, null, 2));
    // Timestamped copy so nothing is ever overwritten.
    writeFileSync(
        join(
            MANIFEST_DIR,
            `${m.db}.${m.status}.${m.appliedAt.replace(/[:.]/g, '-')}.json`,
        ),
        JSON.stringify(m, null, 2),
    );
}
