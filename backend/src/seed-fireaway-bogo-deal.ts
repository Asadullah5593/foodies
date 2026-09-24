/**
 * Seed: Fireaway "Buy One Get One Free" as a DEAL (not a discount).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A DEAL AND NOT A DISCOUNT
 * ───────────────────────────────────────────────────────────────────────────
 * The BOGO already runs as a `buy_x_get_y` discount and prices correctly, but
 * an order-wide discount is invisible until checkout: the customer adds two
 * pizzas, sees full price on the cart, and only meets the saving on the last
 * screen. On the mobile app that reads as "the offer isn't working".
 *
 * A deal is a MENU ITEM. It sits on the menu as its own tile, opens a picker
 * with two pizza slots, and prices itself — so the offer is visible from the
 * moment the customer taps it, with no app release required.
 *
 * Pricing is `deal_pricing_mode = 'bogo'`: each slot is priced from its OWN
 * menu price, then the cheapest `get` of every (buy+get) cohort is discounted
 * by `BOGO_GET_PERCENT`. That is why `base_price` is 0 — the deal has no fixed
 * price, it is computed from the two pizzas chosen. See `bogo-pricing.ts`.
 *
 * The second slot MIRRORS the first (`mirror_slot_index`), so the 2nd pizza
 * must match the 1st on size and on strict category — Classic pairs only with
 * Classic, Signature only with Signature. Enforced SERVER-SIDE in
 * `validateBogoComponents`, so a tampered payload cannot mix them even if the
 * client lets the customer try.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NON-DESTRUCTIVE — safe to run on production.
 * ───────────────────────────────────────────────────────────────────────────
 * Touches ONLY the one deal named below.
 *
 *   menu_items        → the deal root is upserted BY NAME within the brand, so
 *                       re-running reprices in place and the id (and the order
 *                       history hanging off it) survives. Never deleted.
 *   deal_components   → rebuilt for this deal only.
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
 *
 * The dry run performs every write inside a transaction and rolls it back, so
 * the plan you read is the plan the database accepted. Resolution is BY NAME
 * against whatever database it is pointed at; anything that does not resolve
 * aborts the whole run and prints exactly what is missing.
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

const DEAL_NAME = 'Buy One Get One Free';
const DEAL_DESCRIPTION =
    'Buy any 12" pizza and get a 2nd pizza of the same range FREE. ' +
    'Classic pairs with Classic, Signature with Signature.';

/**
 * Where the deal tile lives. It must be an ACTIVE category or the app will not
 * show it.
 *
 * Fireaway already carries a "Deals" category on production that is INACTIVE
 * and holds no active items. Two ways to give this deal a home, and the
 * resolver below copes with either:
 *
 *   - REACTIVATE that row (preferred — no duplicate names), or
 *   - create a NEW active "Deals" category, leaving the old inactive one in
 *     place. The brand then has two rows called "Deals"; `findCategory`
 *     prefers the ACTIVE one, so the deal still lands correctly.
 *
 * If both rows ever end up active the script refuses to guess and aborts,
 * rather than filing the deal somewhere customers never see.
 */
const DEAL_CATEGORY = 'Deals';

/**
 * The two pizza ranges the deal draws from. Every ACTIVE item in each category
 * is offered, so a pizza added to the menu later joins the deal automatically.
 * These are CATEGORIES on production (6 active items each); the `label` column
 * is empty brand-wide, which is why the deal keys off category, not label.
 */
const PIZZA_CATEGORIES = ['Classic', 'Signature'];

/** Fireaway pizzas are single-size; every variant carries size_key '12'. */
const PIZZA_SIZE_KEY = '12';

/** 100 = the 2nd pizza is free. 50 would be "2nd pizza half price". */
const BOGO_GET_PERCENT = 100;
/** Buy 1, get 1. */
const BOGO_BUY_QUANTITY = 1;
const BOGO_GET_QUANTITY = 1;

/**
 * Sale channels: 'pos' | 'app' | 'web' | 'kiosk'. null = everywhere.
 *
 * ['app'] keeps the deal OFF the till, which is the point of this exercise:
 * POS and the call centre already get the BOGO automatically through the
 * `buy_x_get_y` discount, and having both routes on one till invites
 * double-handling. Add 'web' if consumer-web should show the tile too.
 */
const DEAL_CHANNELS: string[] | null = ['app'];

/**
 * Order types: 'delivery' | 'pickup' | 'dine_in'. null = every order type.
 * Set to delivery only, matching the discount this deal mirrors. Widen it here
 * if the offer should also run on app pickup orders.
 */
const DEAL_ORDER_TYPES: string[] | null = ['delivery'];

/**
 * Recurring window, in the BRANCH timezone. Both null = all day, every day.
 * The discount this mirrors runs all day, so these stay null.
 */
const AVAILABLE_TIME_START: string | null = null;
const AVAILABLE_TIME_END: string | null = null;
const AVAILABLE_DAYS: number[] | null = null;

/**
 * Whether to make the deal sellable by creating the missing
 * `branch_menu_items` rows.
 *
 * FALSE (the default) creates the deal attached to NO branch. A menu item with
 * no branch_menu_items row is absent from that branch's menu entirely, so the
 * app will NOT show it. That is deliberate — it lets the deal be staged and
 * checked before it goes live. Flip to true (or attach per branch in the
 * admin) when you want customers to see it.
 */
const ATTACH_TO_BRANCHES = false;

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

interface Resolved {
    brand: Brand;
    dealCategory: MenuCategory;
    /** Every active pizza across PIZZA_CATEGORIES, in category order. */
    pizzaIds: number[];
    /** For the plan: category name → item names. */
    byCategory: Array<{ name: string; items: string[] }>;
    existing: MenuItem | null;
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

    /** Set when a category name misses, so we can show what DOES exist. */
    let wantCategoryHint = false;

    /**
     * Resolve one category by name. A name matching more than one row is a hard
     * failure rather than an arbitrary pick — production carries duplicate
     * category names on some brands, and filing a deal into the wrong one would
     * hide it from customers. Active rows win when both exist.
     */
    const findCategory = async (
        name: string,
        neededBy: string,
    ): Promise<MenuCategory | null> => {
        const matches = await categoryRepo.find({
            where: { brandId, name },
        });
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

    /** The brand's real categories — printed once, after every lookup is done. */
    const printCategoryHint = async () => {
        if (!wantCategoryHint) return;
        const all = await categoryRepo.find({
            where: { brandId },
            order: { name: 'ASC' },
        });
        console.log(
            `  ? ${BRAND_NAME} categories: ${all
                .map((c) => `${c.name}${c.isActive ? '' : ' (inactive)'}`)
                .join(' · ')}`,
        );
    };

    const dealCategory = await findCategory(DEAL_CATEGORY, 'the deal tile');

    const pizzaIds: number[] = [];
    const byCategory: Array<{ name: string; items: string[] }> = [];
    for (const catName of PIZZA_CATEGORIES) {
        const cat = await findCategory(catName, 'the pizza slots');
        if (!cat) continue;
        const items = await itemRepo.find({
            where: { brandId, categoryId: cat.id, isActive: true },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
        if (items.length === 0) {
            problems.push(
                `${BRAND_NAME}: category "${cat.name}" (id ${cat.id}) has no active items`,
            );
            continue;
        }
        pizzaIds.push(...items.map((i) => i.id));
        byCategory.push({ name: cat.name, items: items.map((i) => i.name) });
    }

    // A pinned size the choices do not have makes the slot unpickable at order
    // time, so this is a blocker rather than a warning.
    if (pizzaIds.length > 0) {
        const withSize = await variantRepo.count({
            where: { menuItemId: In(pizzaIds), sizeKey: PIZZA_SIZE_KEY },
        });
        if (withSize === 0) {
            problems.push(
                `${BRAND_NAME}: no pizza carries a '${PIZZA_SIZE_KEY}' variant — the deal slots would be unpickable`,
            );
        } else if (withSize < pizzaIds.length) {
            problems.push(
                `${BRAND_NAME}: only ${withSize}/${pizzaIds.length} pizzas have a '${PIZZA_SIZE_KEY}' variant — the rest would be unpickable inside the deal`,
            );
        }
    }

    // Two slots of the same pool: with fewer than 2 pizzas the deal is unusable.
    if (pizzaIds.length < 2) {
        problems.push(
            `${BRAND_NAME}: only ${pizzaIds.length} pizza(s) resolved — a buy-one-get-one needs at least 2`,
        );
    }

    await printCategoryHint();

    const existing = await itemRepo.findOne({
        where: { brandId, name: DEAL_NAME },
    });

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
        pizzaIds,
        byCategory,
        existing,
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

    let deal = r.existing;
    const created = deal == null;
    if (!deal) {
        deal = itemRepo.create({
            brandId: r.brand.id,
            slug: slugify(DEAL_NAME),
        });
    }

    deal.categoryId = r.dealCategory.id;
    deal.name = DEAL_NAME;
    deal.description = DEAL_DESCRIPTION;
    // Dynamic pricing: the deal has no fixed price. Each slot is priced from
    // its own menu price and the cheaper pizza is discounted, so a base price
    // here would be meaningless (and is ignored for 'bogo' roots).
    deal.basePrice = 0;
    deal.isActive = true;
    deal.dealOnly = false;
    deal.dealPricingMode = 'bogo';
    deal.dealBogoBuyQuantity = BOGO_BUY_QUANTITY;
    deal.dealBogoGetQuantity = BOGO_GET_QUANTITY;
    deal.dealBogoGetPercent = BOGO_GET_PERCENT;
    deal.availableChannels = DEAL_CHANNELS;
    deal.availableForOrderTypes = DEAL_ORDER_TYPES;
    deal.availableTimeStart = AVAILABLE_TIME_START;
    deal.availableTimeEnd = AVAILABLE_TIME_END;
    deal.availableDaysOfWeek = AVAILABLE_DAYS;
    deal = await itemRepo.save(deal);

    // Rebuild this deal's slots only.
    await dealComponentRepo.delete({ menuItemId: deal.id });

    // Slot 0 — the pizza the customer pays for.
    await dealComponentRepo.save(
        dealComponentRepo.create({
            menuItemId: deal.id,
            slotIndex: 0,
            type: 'choice_list',
            sourceMenuItemId: null,
            sourceCategoryId: null,
            sourceMenuItemIds: r.pizzaIds,
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

    // Slot 1 — the free one. Mirrors slot 0, so it must be the same size AND
    // the same strict category: Classic with Classic, Signature with
    // Signature. Enforced server-side at order time by validateBogoComponents.
    await dealComponentRepo.save(
        dealComponentRepo.create({
            menuItemId: deal.id,
            slotIndex: 1,
            type: 'choice_list',
            sourceMenuItemId: null,
            sourceCategoryId: null,
            sourceMenuItemIds: r.pizzaIds,
            quantity: 1,
            allowCustomization: true,
            optional: false,
            slotSurcharges: null,
            slotSizeKey: null,
            allowedSizeKeys: [PIZZA_SIZE_KEY],
            mirrorSlotIndex: 0,
            mirrorMatchSize: true,
            mirrorMatchCategory: true,
        }),
    );

    let bmiCreated = 0;
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

    return { dealId: deal.id, created, bmiCreated };
}

// ===========================================================================

async function main() {
    await dataSource.initialize();

    console.log('');
    console.log(
        COMMIT
            ? '=== FIREAWAY BOGO DEAL — COMMIT (writes will be kept) ==='
            : '=== FIREAWAY BOGO DEAL — DRY RUN (nothing will be kept) ===',
    );
    console.log(
        `    "${DEAL_NAME}" · buy ${BOGO_BUY_QUANTITY} get ${BOGO_GET_QUANTITY} at ${BOGO_GET_PERCENT}% off`,
    );
    console.log(
        `    category "${DEAL_CATEGORY}" · channels ${
            DEAL_CHANNELS ? DEAL_CHANNELS.join(',') : 'all'
        } · order types ${DEAL_ORDER_TYPES ? DEAL_ORDER_TYPES.join(',') : 'all'}`,
    );
    console.log(
        `    branches ${
            ATTACH_TO_BRANCHES
                ? 'ATTACHED (deal goes live)'
                : 'NOT attached (deal stays invisible until attached)'
        }`,
    );
    console.log(
        `    db ${process.env.DB_DATABASE ?? 'foodies'} @ ${process.env.DB_HOST ?? '127.0.0.1'}`,
    );
    console.log('');

    let summary = { dealId: 0, created: false, bmiCreated: 0 };
    let aborted = false;

    try {
        await dataSource.transaction(async (manager) => {
            const problems: string[] = [];
            const r = await resolve(manager, problems);

            if (r) {
                console.log(
                    `${BRAND_NAME}  (brand id ${r.brand.id}, ${r.branchIds.length} branch(es))`,
                );
                console.log(
                    `  ${r.existing ? `UPDATE id ${r.existing.id}` : 'CREATE'}  "${DEAL_NAME}"  (dynamic price)`,
                );
                for (const c of r.byCategory) {
                    console.log(
                        `      ${c.name} (${c.items.length}): ${c.items.join(', ')}`,
                    );
                }
                console.log(
                    `      slot 0: any of the ${r.pizzaIds.length} pizzas above, size ${PIZZA_SIZE_KEY}"`,
                );
                console.log(
                    `      slot 1: same list, size ${PIZZA_SIZE_KEY}", MUST match slot 0's size and category → ${BOGO_GET_PERCENT}% off the cheaper pizza`,
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
            `deal ${summary.created ? 'created' : 'updated'} (id ${summary.dealId}) · new branch_menu_items rows: ${summary.bmiCreated}`,
        );
        if (!ATTACH_TO_BRANCHES)
            console.log(
                'branches were NOT attached: the deal is on no branch menu yet, so the app will not show it.',
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
    console.error('Fireaway BOGO deal seed failed:', err);
    if (dataSource.isInitialized) await dataSource.destroy();
    process.exit(1);
});
