/**
 * Seed: Fireaway buy-one-get-one, as FIXED-PRICE DEALS for the mobile app.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THREE DEALS, AND WHY FIXED PRICE
 * ───────────────────────────────────────────────────────────────────────────
 * The BOGO also runs as a `buy_x_get_y` discount, which prices correctly but is
 * invisible until checkout: the customer adds two pizzas, sees full price in
 * the cart, and only meets the saving on the last screen. On the app that reads
 * as the offer being broken. A deal is a menu item, so it gets its own tile and
 * shows its price the moment it is tapped.
 *
 * This replaces an earlier single DYNAMIC deal (`deal_pricing_mode = 'bogo'`,
 * two mirrored slots). That shape was correct server-side, but the live app
 * build mishandles `mirror_slot_index` — it lists every pizza in slot 1 and
 * then resets incompatible picks — so a customer could choose a Classic and a
 * Signature and have the selection snap back. Splitting into one deal PER
 * RANGE removes the need to mirror at all: a deal that only contains Classic
 * pizzas cannot be used to pick a Signature. The constraint becomes structural
 * rather than a rule the client has to honour.
 *
 * A fixed price is only honest when every pizza in the deal costs the same, so
 * this seeder REFUSES to build a deal whose items differ in price rather than
 * quietly over- or under-charging. That is why Margherita gets its own deal:
 * it is Rs 250 cheaper than the rest of the Classic range, and folding it in
 * would mean "buy one get one free" charged MORE than one Margherita costs.
 *
 * Each deal's price is COMPUTED from the resolved pizzas (one pizza's price =
 * pay for one, take two), never hardcoded, so a menu price change is picked up
 * by re-running rather than silently drifting.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NON-DESTRUCTIVE — safe to run on production.
 * ───────────────────────────────────────────────────────────────────────────
 *   menu_items        → each deal root is upserted BY NAME within the brand, so
 *                       re-running reprices in place and the id (and the order
 *                       history hanging off it) survives. Superseded deals in
 *                       RETIRE_DEAL_NAMES are DEACTIVATED, never deleted.
 *   deal_components   → rebuilt for these deals only.
 *   branch_menu_items → only when ATTACH_TO_BRANCHES is true, and only rows
 *                       that are missing. Existing overrides never touched.
 *
 * It never creates or edits a category, a pizza, or any other menu item.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * USAGE
 * ───────────────────────────────────────────────────────────────────────────
 *   npm run seed:fireaway-bogo              # DRY RUN — resolves, reports, rolls back
 *   npm run seed:fireaway-bogo -- --commit  # actually writes
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource, EntityManager, In } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Brand } from './entities/brand.entity';
import { Branch } from './entities/branch.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuVariant } from './entities/menu-variant.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';
import { DealComponent } from './entities/deal-component.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

// ===========================================================================
// CONFIG — edit here, nowhere else.
// ===========================================================================

const BRAND_SLUG = 'fireaway';
const BRAND_NAME = 'Fireaway';

/** Where the deal tiles live. Must be ACTIVE or the app will not show them. */
const DEAL_CATEGORY = 'Deals';

/** Fireaway pizzas are single-size; every variant carries size_key '12'. */
const PIZZA_SIZE_KEY = '12';

/**
 * Sale channels: 'pos' | 'app' | 'web' | 'kiosk'. null = everywhere.
 * ['app'] keeps these OFF the till — POS and the call centre already get the
 * BOGO automatically through the `buy_x_get_y` discount, and offering both
 * routes at one till invites double-handling.
 */
const DEAL_CHANNELS: string[] | null = ['app'];

/** Order types: 'delivery' | 'pickup' | 'dine_in'. null = every order type. */
const DEAL_ORDER_TYPES: string[] | null = ['delivery'];

/**
 * Deals superseded by the ones below. DEACTIVATED (is_active = false), never
 * deleted — `order_items.menu_item_id` is ON DELETE CASCADE, so deleting a deal
 * root would take its order history with it.
 */
const RETIRE_DEAL_NAMES = ['Buy One Get One Free'];

/**
 * Whether to make the deals sellable by creating the missing
 * `branch_menu_items` rows.
 *
 * FALSE (the default) creates them attached to NO branch. A menu item with no
 * branch_menu_items row is absent from that branch's menu entirely, so the app
 * will NOT show it — deliberately, so the set can be checked before it goes
 * live. Attach per branch in the admin, or flip this and re-run.
 */
const ATTACH_TO_BRANCHES = false;

interface DealSpec {
    name: string;
    description: string;
    /** Active items in these categories form the pool. */
    fromCategories: string[];
    /** Drop these by name (e.g. the one pizza priced differently). */
    excludeItems?: string[];
    /** Keep ONLY these by name. Applied after `excludeItems`. */
    onlyItems?: string[];
}

/**
 * One deal per price point. Classic splits in two because Margherita is
 * Rs 1499 against Rs 1749 for the other five; Signature is uniform at Rs 1949.
 * The seeder re-checks that split every run — add a pizza at a new price and it
 * aborts rather than mispricing the deal.
 */
const DEALS: DealSpec[] = [
    {
        name: 'BOGO Classic Pizzas',
        description:
            'Buy any Classic pizza and get a 2nd Classic pizza FREE. Pick your two from the Classic range.',
        fromCategories: ['Classic'],
        excludeItems: ['Margherita'],
    },
    {
        name: 'BOGO Signature Pizzas',
        description:
            'Buy any Signature pizza and get a 2nd Signature pizza FREE. Pick your two from the Signature range.',
        fromCategories: ['Signature'],
    },
    {
        name: 'BOGO Margherita',
        description: 'Buy a Margherita and get a 2nd Margherita FREE.',
        fromCategories: ['Classic'],
        onlyItems: ['Margherita'],
    },
];

// ===========================================================================
// Bootstrap
// ===========================================================================

const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_DATABASE ?? 'foodies',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

const COMMIT = process.argv.includes('--commit');

/** Thrown to roll the transaction back on a dry run, or on an unresolved config. */
class Rollback extends Error {
    constructor() {
        super('dry-run rollback');
        this.name = 'Rollback';
    }
}

function slugify(name: string) {
    return `${name
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')}-${BRAND_SLUG}`;
}

interface ResolvedDeal {
    spec: DealSpec;
    pizzaIds: number[];
    pizzaNames: string[];
    /** One pizza's price — what the customer pays for two. */
    price: number;
    existing: MenuItem | null;
}

interface Resolved {
    brand: Brand;
    dealCategory: MenuCategory;
    deals: ResolvedDeal[];
    retiring: MenuItem[];
    branchIds: number[];
}

// ===========================================================================
// Phase 1 — RESOLVE (read-only)
// ===========================================================================

async function resolve(
    manager: EntityManager,
    problems: string[],
): Promise<Resolved | null> {
    const brandRepo = manager.getRepository(Brand);
    const categoryRepo = manager.getRepository(MenuCategory);
    const itemRepo = manager.getRepository(MenuItem);
    const variantRepo = manager.getRepository(MenuVariant);

    const brand = await brandRepo.findOne({ where: { slug: BRAND_SLUG } });
    if (!brand) {
        problems.push(`brand "${BRAND_NAME}" (slug "${BRAND_SLUG}") not found`);
        return null;
    }
    const brandId = brand.id;
    let wantCategoryHint = false;

    /**
     * Resolve a category by name. A name matching more than one row is a hard
     * failure rather than an arbitrary pick — Fireaway carries an inactive
     * "Deals" category alongside the live one, and filing a deal into the dead
     * one would hide it from customers. Active rows win when both exist.
     */
    const findCategory = async (
        name: string,
        neededBy: string,
    ): Promise<MenuCategory | null> => {
        const matches = await categoryRepo.find({ where: { brandId, name } });
        const active = matches.filter((c) => c.isActive);
        const pick = active.length ? active : matches;
        if (pick.length === 1) {
            if (!pick[0].isActive)
                problems.push(
                    `${BRAND_NAME}: category "${name}" (id ${pick[0].id}) is INACTIVE — the app will not show anything filed under it`,
                );
            return pick[0];
        }
        if (pick.length > 1) {
            problems.push(
                `${BRAND_NAME}: category "${name}" is AMBIGUOUS — ${pick.length} rows (ids ${pick
                    .map((c) => c.id)
                    .join(', ')}) (needed by ${neededBy})`,
            );
            return null;
        }
        problems.push(
            `${BRAND_NAME}: category "${name}" not found (needed by ${neededBy})`,
        );
        wantCategoryHint = true;
        return null;
    };

    const dealCategory = await findCategory(DEAL_CATEGORY, 'the deal tiles');

    const deals: ResolvedDeal[] = [];
    for (const spec of DEALS) {
        const pool: MenuItem[] = [];
        for (const catName of spec.fromCategories) {
            const cat = await findCategory(catName, `"${spec.name}"`);
            if (!cat) continue;
            pool.push(
                ...(await itemRepo.find({
                    where: { brandId, categoryId: cat.id, isActive: true },
                    order: { sortOrder: 'ASC', id: 'ASC' },
                })),
            );
        }

        let items = pool;
        if (spec.excludeItems?.length) {
            const drop = new Set(spec.excludeItems);
            for (const n of spec.excludeItems) {
                if (!items.some((i) => i.name === n))
                    problems.push(
                        `${BRAND_NAME}: "${spec.name}" excludes "${n}" but no active item of that name is in the pool — the exclusion is silently doing nothing`,
                    );
            }
            items = items.filter((i) => !drop.has(i.name));
        }
        if (spec.onlyItems?.length) {
            const keep = new Set(spec.onlyItems);
            for (const n of spec.onlyItems) {
                if (!items.some((i) => i.name === n))
                    problems.push(
                        `${BRAND_NAME}: "${spec.name}" wants only "${n}" but no active item of that name is in the pool`,
                    );
            }
            items = items.filter((i) => keep.has(i.name));
        }

        if (items.length === 0) {
            problems.push(
                `${BRAND_NAME}: "${spec.name}" resolved to no pizzas`,
            );
            continue;
        }

        // A FIXED price is only honest when every pizza in the deal costs the
        // same. Mixed prices mean the deal either overcharges the cheap pick or
        // gives away the dear one, so refuse rather than guess.
        const prices = [...new Set(items.map((i) => Number(i.basePrice)))];
        if (prices.length > 1) {
            const byPrice = prices
                .sort((a, b) => b - a)
                .map(
                    (p) =>
                        `Rs ${p}: ${items
                            .filter((i) => Number(i.basePrice) === p)
                            .map((i) => i.name)
                            .join(', ')}`,
                )
                .join(' | ');
            problems.push(
                `${BRAND_NAME}: "${spec.name}" mixes ${prices.length} prices, so one fixed price cannot be right — ${byPrice}. Split it into one deal per price, or exclude the odd ones.`,
            );
            continue;
        }

        const ids = items.map((i) => i.id);
        const withSize = await variantRepo.count({
            where: { menuItemId: In(ids), sizeKey: PIZZA_SIZE_KEY },
        });
        if (withSize < ids.length) {
            problems.push(
                `${BRAND_NAME}: "${spec.name}" — only ${withSize}/${ids.length} pizzas carry a '${PIZZA_SIZE_KEY}' variant; the rest would be unpickable inside the deal`,
            );
        }

        deals.push({
            spec,
            pizzaIds: ids,
            pizzaNames: items.map((i) => i.name),
            // Pay for one, take two.
            price: prices[0],
            existing: await itemRepo.findOne({
                where: { brandId, name: spec.name },
            }),
        });
    }

    if (wantCategoryHint) {
        const all = await categoryRepo.find({
            where: { brandId },
            order: { name: 'ASC' },
        });
        console.log(
            `  ? ${BRAND_NAME} categories: ${all
                .map((c) => `${c.name}${c.isActive ? '' : ' (inactive)'}`)
                .join(' · ')}`,
        );
    }

    // Never retire something this run also creates.
    const creating = new Set(DEALS.map((d) => d.name));
    const retiring = (
        await itemRepo.find({
            where: { brandId, name: In(RETIRE_DEAL_NAMES), isActive: true },
        })
    ).filter((m) => !creating.has(m.name));

    const branches = await manager
        .getRepository(Branch)
        .createQueryBuilder('b')
        .innerJoin('branch_brands', 'bb', 'bb.branch_id = b.id')
        .where('bb.brand_id = :brandId', { brandId })
        .getMany();

    if (!dealCategory) return null;
    return {
        brand,
        dealCategory,
        deals,
        retiring,
        branchIds: branches.map((b) => b.id),
    };
}

// ===========================================================================
// Phase 2 — WRITE
// ===========================================================================

async function write(manager: EntityManager, r: Resolved) {
    const itemRepo = manager.getRepository(MenuItem);
    const dealComponentRepo = manager.getRepository(DealComponent);
    const bmiRepo = manager.getRepository(BranchMenuItem);

    let created = 0;
    let updated = 0;
    let bmiCreated = 0;
    const ids: Array<{ name: string; id: number; price: number }> = [];

    for (const rd of r.deals) {
        let deal = rd.existing;
        if (deal) updated++;
        else {
            created++;
            deal = itemRepo.create({
                brandId: r.brand.id,
                slug: slugify(rd.spec.name),
            });
        }

        deal.categoryId = r.dealCategory.id;
        deal.name = rd.spec.name;
        deal.description = rd.spec.description;
        // Fixed price: the customer pays one pizza's price and takes two.
        deal.basePrice = rd.price;
        deal.isActive = true;
        deal.dealOnly = false;
        // Explicitly NOT a dynamic BOGO root. Cleared in full so a re-run over
        // the old dynamic deal cannot leave stale bogo_* values behind.
        deal.dealPricingMode = null;
        deal.dealBogoBuyQuantity = null;
        deal.dealBogoGetQuantity = null;
        deal.dealBogoGetPercent = null;
        deal.availableChannels = DEAL_CHANNELS;
        deal.availableForOrderTypes = DEAL_ORDER_TYPES;
        deal.availableTimeStart = null;
        deal.availableTimeEnd = null;
        deal.availableDaysOfWeek = null;
        deal = await itemRepo.save(deal);
        ids.push({ name: deal.name, id: deal.id, price: rd.price });

        await dealComponentRepo.delete({ menuItemId: deal.id });
        // Two independent slots over the same single-range pool. No mirroring:
        // the range IS the constraint, and the live app mishandles
        // mirror_slot_index.
        for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
            await dealComponentRepo.save(
                dealComponentRepo.create({
                    menuItemId: deal.id,
                    slotIndex,
                    type: 'choice_list',
                    sourceMenuItemId: null,
                    sourceCategoryId: null,
                    sourceMenuItemIds: rd.pizzaIds,
                    quantity: 1,
                    allowCustomization: true,
                    optional: false,
                    slotSurcharges: null,
                    slotSizeKey: null,
                    allowedSizeKeys: [PIZZA_SIZE_KEY],
                    mirrorSlotIndex: null,
                    mirrorMatchSize: false,
                    mirrorMatchCategory: false,
                }),
            );
        }

        if (ATTACH_TO_BRANCHES) {
            for (const branchId of r.branchIds) {
                const existingBmi = await bmiRepo.findOne({
                    where: { branchId, menuItemId: deal.id },
                });
                if (!existingBmi) {
                    await bmiRepo.save(
                        bmiRepo.create({
                            branchId,
                            menuItemId: deal.id,
                            priceOverride: null,
                            isAvailable: true,
                            isHiddenOnline: false,
                        }),
                    );
                    bmiCreated++;
                }
            }
        }
    }

    // Superseded deals: deactivated, never deleted.
    for (const old of r.retiring) {
        old.isActive = false;
        await itemRepo.save(old);
    }

    return { created, updated, bmiCreated, ids, retired: r.retiring.length };
}

// ===========================================================================

async function main() {
    await dataSource.initialize();

    console.log('');
    console.log(
        COMMIT
            ? '=== FIREAWAY BOGO DEALS — COMMIT (writes will be kept) ==='
            : '=== FIREAWAY BOGO DEALS — DRY RUN (nothing will be kept) ===',
    );
    console.log(
        `    category "${DEAL_CATEGORY}" · channels ${
            DEAL_CHANNELS ? DEAL_CHANNELS.join(',') : 'all'
        } · order types ${DEAL_ORDER_TYPES ? DEAL_ORDER_TYPES.join(',') : 'all'}`,
    );
    console.log(
        `    branches ${
            ATTACH_TO_BRANCHES
                ? 'ATTACHED (deals go live)'
                : 'NOT attached (deals stay invisible until attached)'
        }`,
    );
    console.log(
        `    db ${process.env.DB_DATABASE ?? 'foodies'} @ ${process.env.DB_HOST ?? '127.0.0.1'}`,
    );
    console.log('');

    let summary = {
        created: 0,
        updated: 0,
        bmiCreated: 0,
        retired: 0,
        ids: [] as Array<{ name: string; id: number; price: number }>,
    };
    let aborted = false;

    try {
        await dataSource.transaction(async (manager) => {
            const problems: string[] = [];
            const r = await resolve(manager, problems);

            if (r) {
                console.log(
                    `${BRAND_NAME}  (brand id ${r.brand.id}, ${r.branchIds.length} branch(es))`,
                );
                for (const rd of r.deals) {
                    console.log(
                        `  ${rd.existing ? `UPDATE id ${rd.existing.id}` : 'CREATE'}  "${rd.spec.name}"  Rs ${rd.price}  (2 pizzas for the price of 1)`,
                    );
                    console.log(
                        `      ${rd.pizzaNames.length} pizza(s) @ Rs ${rd.price}: ${rd.pizzaNames.join(', ')}`,
                    );
                    console.log(
                        `      slots 0 and 1: same list, size ${PIZZA_SIZE_KEY}", independent (no mirroring)`,
                    );
                }
                for (const old of r.retiring)
                    console.log(
                        `  RETIRE id ${old.id}  "${old.name}"  → is_active = false`,
                    );
                console.log('');
            }

            if (problems.length) {
                console.log('UNRESOLVED — nothing was written:');
                for (const p of [...new Set(problems)]) console.log(`  ✗ ${p}`);
                console.log('');
                console.log(
                    'Fix the CONFIG block at the top of this file and re-run.',
                );
                aborted = true;
                throw new Rollback();
            }

            summary = await write(manager, r!);
            if (!COMMIT) throw new Rollback();
        });
    } catch (err) {
        if (!(err instanceof Rollback)) throw err;
    }

    if (!aborted) {
        console.log(
            `deals created: ${summary.created} · updated: ${summary.updated} · retired: ${summary.retired} · new branch_menu_items rows: ${summary.bmiCreated}`,
        );
        for (const { name, id, price } of summary.ids)
            console.log(`    id ${id}  "${name}"  Rs ${price}`);
        if (!ATTACH_TO_BRANCHES)
            console.log(
                'branches were NOT attached: these deals are on no branch menu yet, so the app will not show them.',
            );
        console.log(
            COMMIT
                ? 'Committed. Nothing was deleted; order history is intact.'
                : 'Dry run complete — transaction rolled back. Re-run with `-- --commit` to apply.',
        );
    }

    await dataSource.destroy();
    if (aborted) process.exit(1);
}

main().catch(async (err) => {
    console.error('Fireaway BOGO deals seed failed:', err);
    if (dataSource.isInitialized) await dataSource.destroy();
    process.exit(1);
});
