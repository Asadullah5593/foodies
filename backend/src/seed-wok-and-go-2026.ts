/**
 * Seed: WOK&GO (Pakistan) menu — 2026 refresh.
 *
 * Source: "new updated menu/Foodies Master Menu WOK&GO.xlsx" → sheet
 * "WOK&GO (App & EPOS)", plus the client answers recorded below.
 *
 * This file REPLACES seed-wok-and-go-real.ts as the current menu definition.
 * seed-wok-and-go-real.ts is left untouched as the historical (pre-2026) record.
 *
 * NOTE on the workbook: that .xlsx is another copy of the Fireaway master
 * template; ONLY the sheet "WOK&GO (App & EPOS)" (Country: Pakistan, Rs prices)
 * is real WOK&GO content. Every other sheet is leftover template data.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NON-DESTRUCTIVE — safe to run on production.
 * ───────────────────────────────────────────────────────────────────────────
 * `order_items.menu_item_id`, `menu_categories → menu_items` and
 * `order_item_addons.addon_id` are all ON DELETE CASCADE, so deleting a
 * category, item or addon silently deletes historical order lines.
 * This seeder therefore NEVER deletes them:
 *
 *   menu_categories · menu_items · menu_addons  → upserted; anything that has
 *       left the menu is set is_active = false (row and history preserved)
 *   renamed items/categories                    → renamed IN PLACE, so the id
 *       survives and reporting continuity is kept
 *   menu_variants · modifier_groups · modifiers · deal_components · m2m links
 *                                               → rebuilt. Their order-history
 *       FKs are ON DELETE SET NULL and every row carries name_snapshot /
 *       price_snapshot / variant_size_snapshot, so past orders stay readable.
 *   branch_menu_items                           → missing rows added only;
 *       existing price overrides / availability flags are never touched.
 *   campaign_items                              → untouched (items survive).
 *
 * Preflight: aborts if any recipe points at this brand's modifiers or variants
 * (recipes.modifier_id / recipes.variant_id are ON DELETE CASCADE, so the
 * rebuild would destroy them). Override with WOKANDGO_SEED_FORCE=1.
 *
 * Modifier-group names are NOT unique per brand, and must not be made unique:
 * the name is the heading the customer sees in the customize modal, and this
 * seeder rebuilds every group each run, so duplicates cost nothing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED vs the previous menu
 * ───────────────────────────────────────────────────────────────────────────
 *  1. WOK&GO Express is switched OFF — the category, the "WOK&GO Express Box"
 *     and the "Lunch Special" deal are all seeded INACTIVE. See the note below.
 *  2. Coca-Cola range → Pepsi range (Pepsi, Diet Pepsi, 7up, Mirinda,
 *     Mountain Dew). Juice 200ml withdrawn.
 *  3. Milkshakes cut 11 → 6 (the flavours listed in the new sheet).
 *  4. Classic Boxes: −Nasi Seafood Box, −Sing'A'Box;
 *     "Mee Gee Seafood Box" renamed → "Spicey Seafood Box".
 *     Hot Box and Sweet Chilli Box no longer list beef; Black Bean Box reworded.
 *  5. Street Food: −Chicken Katsu Curry Box, −Chinese Street Fries,
 *     −WOK&GO Surprise Bag. Peking Loaded Fries no longer lists cucumber.
 *  6. Classic Sides: −Sweet'n'Sour Chicken Balls, −Mixed Side Platter.
 *     Mini Sides Platter Rs799 → Rs699 and drops the 2 popcorn chicken balls.
 *  7. Wings & Strips price cut: 5 Pcs Rs799 → Rs699, 10 Pcs Rs1499 → Rs1299.
 *  8. Pasta: "Smooth Carbonara" renamed → "Chicken Carbonara" (still Rs949).
 *  9. Create Your Own: −Prawn (meat), −Mangetout (veg), −Black Bean /
 *     −Katsu Curry / −Sing-a-Sauce (sauces), and Fried Garlic → Spring Onions.
 * 10. Desserts: cookie flavours → Chocolate Hazelnut / Classic Cookies /
 *     Kunafa; brownie lost its spread choice; doughnuts cut 9 → 6.
 *
 * Client answers driving four judgement calls:
 *  - The sheet carries a note in the WOK&GO EXPRESS block: "Asad please add
 *    this but make it in-active for now." Client clarified that the whole
 *    category and its single item should go inactive. Because "Lunch Special"
 *    can ONLY be built from the Express Box, that deal would be unorderable —
 *    so it is switched off too, and the Express Box is dropped from the other
 *    two deals' box lists. All three are still fully seeded (groups, variants,
 *    slots), just is_active = false, so re-enabling is a one-line change.
 *  - "Chicken Chilli Dry" appears in the new sheet carrying the WOK&GO
 *    Surprise Bag's description — it bled down when that row was deleted.
 *    Client: "restore the original", so it keeps
 *    "Chicken, green peppers, onion, green chilli".
 *  - Black Bean sauce is gone from Create Your Own while the Black Bean Box
 *    stays. Client: "i thinks its intentional" — followed as written.
 *  - Spring Rolls stay "(5 Pcs)" with a 5-roll description. The new sheet says
 *    4, but the client re-confirmed 5 (same call as the previous seeder).
 *
 * Carried over from the old seeder (client-communicated, never in any sheet):
 * per-size selection limits on the Express Box toppings ({large:2, xl:3}), the
 * two "Make it Meal?" models + their conditional meal-drink choosers, the paid
 * "Add a Drink(s)" cross-sell, the Kids Meal wiring and its small-milkshake
 * upgrade, and the repeatable-dip / repeatable-meat quantity groups.
 *
 * Run: npm run seed:wok-and-go-2026   (requires `npm run seed` first)
 * Prices are whole Rupees.
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Tenant } from './entities/tenant.entity';
import { Brand } from './entities/brand.entity';
import { Branch } from './entities/branch.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuAddon } from './entities/menu-addon.entity';
import { MenuVariant } from './entities/menu-variant.entity';
import { ModifierGroup } from './entities/modifier-group.entity';
import { MenuItemModifierGroupPosition } from './entities/menu-item-modifier-group-position.entity';
import { Modifier } from './entities/modifier.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';
import { DealComponent } from './entities/deal-component.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'wok-and-go';
const BRAND_NAME = 'Wok & Go';

// Flip to true to bring WOK&GO Express (category, box and Lunch Special) back.
const EXPRESS_ACTIVE = false;

// ——— Shared option lists (straight from the sheet) ———
const SODAS = ['Pepsi', 'Diet Pepsi', '7up', 'Mirinda', 'Mountain Dew'];
// 500ml bottles — Pepsi & 7up only, Rs 180 standalone; +Rs 50 as an upgrade
// wherever a 345ml drink is included (client-confirmed, all brands).
const SODAS_500ML = ['Pepsi', '7up'];
const PRICE_500ML = 180;
const UPGRADE_500ML = 50;
const MILKSHAKES = [
    'Oreo',
    'Nutella',
    'Lotus Biscoff',
    'Strawberry',
    'Chocolate',
    'Pistachio',
];
const MILKSHAKE_UPGRADE = 250; // "Upgrade to any milkshake - Add Rs 250"
const KIDS_SHAKE_UPGRADE = 200; // "Upgrade to small milkshake - Add Rs 200"
const MEAL_DRINK_345 = 130; // à-la-carte 345ml soda price
const LUNCH_DAYS = [1, 2, 3, 4, 5]; // "Monday to Friday"
const LUNCH_START = '12:00'; // "12:00-16:00 only"
const LUNCH_END = '16:00';

// Wings & strips flavours ("choice of 5 flavours" + Plain).
const WING_FLAVOURS = [
    'Plain',
    'BBQ Crunch',
    'Chilli Honey',
    'Teriyaki',
    'Heat Extreme',
    'Peri Peri',
];
// NOTE: the sheet's Single Dips description lists "Ranch, …, Tomato Ketchup" but the actual
// option cells start with "Soy" — we follow the selectable option cells.
const DIP_OPTIONS = [
    'Soy',
    'Garlic & Herb',
    'BBQ',
    'Sweet Chilli',
    'Tomato Ketchup',
    'Hot Peri-Peri',
];
const COOKIE_FLAVOURS = [
    'Chocolate Hazelnut',
    'Classic Cookies',
    'Kunafa',
    'Lotus',
    'Red Velvet',
];
const DOUGHNUT_FLAVOURS = [
    'Plain Glazed Doughnut',
    'Cotton Candy',
    'Double Chocolate',
    'Lotus',
    'Nutella',
    'Ferrero Rocher',
];

// Applied before anything else so the row (and its id / order history) survives.
const RENAMED_CATEGORIES: Array<[string, string]> = [];
const RENAMED_ITEMS: Array<[string, string]> = [
    ['Mee Gee Seafood Box', 'Spicey Seafood Box'],
    ['Smooth Carbonara', 'Chicken Carbonara'],
];

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

function slugify(name: string) {
    return `${name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')}-${BRAND_SLUG}`;
}

async function seed() {
    await dataSource.initialize();
    const tenantRepo = dataSource.getRepository(Tenant);
    const brandRepo = dataSource.getRepository(Brand);
    const branchRepo = dataSource.getRepository(Branch);
    const categoryRepo = dataSource.getRepository(MenuCategory);
    const itemRepo = dataSource.getRepository(MenuItem);
    const addonRepo = dataSource.getRepository(MenuAddon);
    const variantRepo = dataSource.getRepository(MenuVariant);
    const groupRepo = dataSource.getRepository(ModifierGroup);
    const modifierRepo = dataSource.getRepository(Modifier);
    const bmiRepo = dataSource.getRepository(BranchMenuItem);
    const dealComponentRepo = dataSource.getRepository(DealComponent);
    const positionRepo = dataSource.getRepository(
        MenuItemModifierGroupPosition,
    );

    const [tenant] = await tenantRepo.find({ order: { id: 'ASC' }, take: 1 });
    if (!tenant) {
        console.log('No tenant found. Run `npm run seed` first.');
        await dataSource.destroy();
        return;
    }

    // Resolve by slug, then by name. Editing a brand in the admin UI regenerates
    // its slug from the name ("Wok & Go" → "wok--go"), which would otherwise
    // orphan this lookup and make the seeder create a SECOND brand.
    let brand = await brandRepo.findOne({ where: { slug: BRAND_SLUG } });
    if (!brand) {
        brand = await brandRepo.findOne({ where: { name: BRAND_NAME } });
        if (brand) {
            console.log(
                `Matched brand by name: ${brand.name} (#${brand.id}, slug "${brand.slug}")`,
            );
        }
    }
    if (!brand) {
        brand = await brandRepo.save(
            brandRepo.create({
                tenantId: tenant.id,
                name: BRAND_NAME,
                slug: BRAND_SLUG,
                description:
                    'Fresh wok-tossed noodle & rice boxes and Asian street food.',
                logoUrl: null,
                isActive: true,
            }),
        );
        console.log(`Created brand: ${brand.name} (#${brand.id})`);
    } else {
        console.log(`Using existing brand: ${brand.name} (#${brand.id})`);
    }
    const brandId = brand.id;

    // ——— Preflight: recipes cascade-delete with modifiers/variants ———
    const recipeRefRows: Array<{ count: number }> = await dataSource.query(
        `SELECT COUNT(*)::int AS count
           FROM recipes r
           LEFT JOIN modifiers m ON m.id = r.modifier_id
           LEFT JOIN modifier_groups g ON g.id = m.modifier_group_id
           LEFT JOIN menu_variants v ON v.id = r.variant_id
           LEFT JOIN menu_items vi ON vi.id = v.menu_item_id
          WHERE g.brand_id = $1 OR vi.brand_id = $1`,
        [brandId],
    );
    const recipeRefs = recipeRefRows[0]?.count ?? 0;
    if (recipeRefs > 0 && process.env.WOKANDGO_SEED_FORCE !== '1') {
        console.error(
            `ABORTING: ${recipeRefs} recipe row(s) reference this brand's modifiers/variants.\n` +
                `Rebuilding them would cascade-delete those recipes. Review them first, then\n` +
                `re-run with WOKANDGO_SEED_FORCE=1 if you accept the loss.`,
        );
        await dataSource.destroy();
        process.exit(1);
    }

    // ——— Renames first, so ids (and their order history) survive ———
    for (const [from, to] of RENAMED_CATEGORIES) {
        const existingNew = await categoryRepo.findOne({
            where: { brandId, name: to },
        });
        if (existingNew) continue;
        const row = await categoryRepo.findOne({
            where: { brandId, name: from },
        });
        if (row) {
            row.name = to;
            await categoryRepo.save(row);
            console.log(`  renamed category: "${from}" → "${to}"`);
        }
    }
    for (const [from, to] of RENAMED_ITEMS) {
        const existingNew = await itemRepo.findOne({
            where: { brandId, name: to },
        });
        if (existingNew) continue;
        const row = await itemRepo.findOne({ where: { brandId, name: from } });
        if (row) {
            row.name = to;
            row.slug = slugify(to);
            await itemRepo.save(row);
            console.log(`  renamed item: "${from}" → "${to}"`);
        }
    }

    // ——— Rebuild the parts that are safe to rebuild ———
    // (order-history FKs on these are SET NULL and rows carry name snapshots)
    const brandItemRows: Array<{ id: number }> = await dataSource.query(
        'SELECT id FROM menu_items WHERE brand_id = $1',
        [brandId],
    );
    const brandItemIds: number[] = brandItemRows.map((r) => r.id);
    if (brandItemIds.length) {
        await dataSource.query(
            'DELETE FROM deal_components WHERE menu_item_id = ANY($1::int[])',
            [brandItemIds],
        );
        await dataSource.query(
            'DELETE FROM menu_variants WHERE menu_item_id = ANY($1::int[])',
            [brandItemIds],
        );
    }
    await groupRepo.delete({ brandId }); // cascades modifiers, m2m links, positions

    // ===================================================================
    // Helpers
    // ===================================================================
    const touchedCategories = new Set<number>();
    const touchedItems = new Set<number>();
    const touchedAddons = new Set<number>();
    const deliberatelyInactive: string[] = [];

    let catSort = 0;
    const mkCategory = async (
        name: string,
        description?: string,
        active = true,
    ) => {
        let cat = await categoryRepo.findOne({ where: { brandId, name } });
        if (!cat) {
            cat = categoryRepo.create({ brandId, name, imageUrl: null });
        }
        cat.description = description ?? null;
        cat.sortOrder = catSort++;
        cat.isActive = active;
        cat = await categoryRepo.save(cat);
        touchedCategories.add(cat.id);
        if (!active) deliberatelyInactive.push(`category "${name}"`);
        return cat;
    };

    type SizeDef = {
        name: string;
        sizeKey: string | null;
        price: number;
        isDefault?: boolean;
    };
    let itemSort = 0;
    const mkItem = async (opts: {
        category: MenuCategory;
        name: string;
        description?: string | null;
        basePrice: number;
        sizes?: SizeDef[];
        dealOnly?: boolean;
        active?: boolean;
        availableTimeStart?: string | null;
        availableTimeEnd?: string | null;
        availableDaysOfWeek?: number[] | null;
    }): Promise<MenuItem> => {
        let item = await itemRepo.findOne({
            where: { brandId, name: opts.name },
        });
        if (!item) {
            item = itemRepo.create({
                brandId,
                name: opts.name,
                slug: slugify(opts.name),
                imageUrl: null,
            });
        }
        const active = opts.active ?? true;
        item.categoryId = opts.category.id;
        item.description = opts.description ?? null;
        item.basePrice = opts.basePrice;
        item.isActive = active;
        item.sortOrder = itemSort++;
        item.dealOnly = opts.dealOnly ?? false;
        item.availableForOrderTypes = null;
        item.availableTimeStart = opts.availableTimeStart ?? null;
        item.availableTimeEnd = opts.availableTimeEnd ?? null;
        item.availableDaysOfWeek = opts.availableDaysOfWeek ?? null;
        // Allergens & calories columns are present but BLANK in the sheet → left null.
        item.allergens = null;
        item.calories = null;
        item = await itemRepo.save(item);
        touchedItems.add(item.id);
        if (!active) deliberatelyInactive.push(`"${opts.name}"`);

        if (opts.sizes?.length) {
            let vSort = 0;
            for (const s of opts.sizes) {
                await variantRepo.save(
                    variantRepo.create({
                        menuItemId: item.id,
                        name: s.name,
                        sizeKey: s.sizeKey,
                        priceModifier: s.price - opts.basePrice,
                        isDefault: s.isDefault ?? false,
                        sortOrder: vSort++,
                    }),
                );
            }
        }
        return item;
    };

    type ModDef = { name: string; price?: number };
    const mkGroup = async (
        name: string,
        cfg: {
            minSelect?: number;
            maxSelect?: number;
            minSelectBySize?: Record<string, number> | null;
            maxSelectBySize?: Record<string, number> | null;
            includedQuantity?: number;
            allowQuantity?: boolean;
            hideInDeals?: boolean;
        },
        mods: ModDef[],
    ): Promise<ModifierGroup> => {
        const group = await groupRepo.save(
            groupRepo.create({
                brandId,
                name,
                minSelect: cfg.minSelect ?? 0,
                maxSelect: cfg.maxSelect ?? 1,
                minSelectBySize: cfg.minSelectBySize ?? null,
                maxSelectBySize: cfg.maxSelectBySize ?? null,
                includedQuantity: cfg.includedQuantity ?? 0,
                includedBySize: null,
                allowQuantity: cfg.allowQuantity ?? false,
                priceTiers: null,
                hideInDeals: cfg.hideInDeals ?? false,
                visibleWhenModifierIds: null,
            }),
        );
        for (const m of mods) {
            await modifierRepo.save(
                modifierRepo.create({
                    modifierGroupId: group.id,
                    name: m.name,
                    price: m.price ?? 0,
                    priceBySize: null,
                    availableForSizes: null,
                }),
            );
        }
        return group;
    };

    const linkGroups = async (item: MenuItem, groups: ModifierGroup[]) => {
        if (!groups.length) return;
        await dataSource
            .createQueryBuilder()
            .relation(MenuItem, 'modifierGroups')
            .of(item.id)
            .add(groups.map((g) => g.id));
        // Persist per-item display order so the customize wizard follows THIS array.
        for (let i = 0; i < groups.length; i++) {
            await positionRepo.upsert(
                {
                    menuItemId: item.id,
                    modifierGroupId: groups[i].id,
                    sortOrder: i,
                },
                ['menuItemId', 'modifierGroupId'],
            );
        }
    };

    // Conditional visibility helper: return the ids of a group's PAID options, so a follow-up
    // drink chooser appears only once a paid upgrade is picked (not "No Drink" / "Just the Box").
    const paidModifierIds = async (group: ModifierGroup): Promise<number[]> => {
        const mods = await modifierRepo.find({
            where: { modifierGroupId: group.id },
        });
        return mods.filter((m) => Number(m.price) > 0).map((m) => m.id);
    };

    // ===================================================================
    // SHARED MODIFIER GROUPS
    // ===================================================================
    const grpBoxMeal = await mkGroup(
        'Make it Meal?',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'No Drink' },
            { name: 'Meal with Drink', price: MEAL_DRINK_345 },
            { name: 'Meal (Fries + Drink)', price: 350 },
            { name: 'Meal (Spicy Fries + Drink)', price: 380 },
        ],
    );
    const grpMealDrinkShake = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            ...SODAS.map((s) => ({ name: `${s} 345ml` })),
            // 500ml bottles are a paid upgrade over the included 345ml.
            ...SODAS_500ML.map((s) => ({
                name: `${s} 500ml`,
                price: UPGRADE_500ML,
            })),
            ...MILKSHAKES.map((m) => ({
                name: `${m} Milkshake`,
                price: MILKSHAKE_UPGRADE,
            })),
        ],
    );
    grpMealDrinkShake.visibleWhenModifierIds =
        await paidModifierIds(grpBoxMeal);
    await groupRepo.save(grpMealDrinkShake);

    // "Make it Meal" for Classic Boxes — "Just the box" or "Add a drink 345ml - Add Rs130".
    const grpClassicMeal = await mkGroup(
        'Make it Meal',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'Just the Box' },
            { name: 'Add a 345ml Drink', price: MEAL_DRINK_345 },
        ],
    );
    const grpMealDrinkSoda = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            ...SODAS.map((s) => ({ name: `${s} 345ml` })),
            // 500ml bottles are a paid upgrade over the included 345ml.
            ...SODAS_500ML.map((s) => ({
                name: `${s} 500ml`,
                price: UPGRADE_500ML,
            })),
            ...MILKSHAKES.map((m) => ({
                name: `${m} Milkshake`,
                price: MILKSHAKE_UPGRADE,
            })),
        ],
    );
    grpMealDrinkSoda.visibleWhenModifierIds =
        await paidModifierIds(grpClassicMeal);
    await groupRepo.save(grpMealDrinkSoda);

    // Paid drink cross-sell (Create Your Own) — "Note: Drink is not free.
    // Every drink needs to [be] charged", repeatable.
    const grpAddDrinksPaid = await mkGroup(
        'Add a Drink(s)',
        { minSelect: 0, maxSelect: 12, allowQuantity: true, hideInDeals: true },
        [
            ...SODAS.map((s) => ({
                name: `${s} 345ml`,
                price: MEAL_DRINK_345,
            })),
            ...SODAS_500ML.map((s) => ({
                name: `${s} 500ml`,
                price: PRICE_500ML,
            })),
            { name: 'Water 500ml', price: 75 },
            ...SODAS.map((s) => ({ name: `${s} 1L`, price: 199 })),
            ...SODAS.map((s) => ({ name: `${s} 1.5L`, price: 249 })),
            ...MILKSHAKES.map((m) => ({ name: `${m} Milkshake`, price: 499 })),
        ],
    );

    // ===================================================================
    // CATEGORIES
    // ===================================================================
    const catDeals = await mkCategory('Deals');
    const catExpress = await mkCategory(
        'WOK&GO Express',
        "In a rush? Don't worry, we have you covered — get served in seconds with authentic dishes with multiple choices.",
        EXPRESS_ACTIVE,
    );
    const catBYO = await mkCategory(
        'Build Your Own',
        'All boxes include wok-toasted carrots, beansprouts, spring onions and egg (optional).',
    );
    const catClassics = await mkCategory('Classic Boxes');
    const catStreetFood = await mkCategory('Street Food');
    const catKids = await mkCategory('Kids Meal');
    const catPasta = await mkCategory('Pasta', 'Delicious fresh pastas');
    const catSides = await mkCategory('Classic Sides');
    const catWings = await mkCategory('Wings & Strips');
    const catDips = await mkCategory('Dips');
    const catDesserts = await mkCategory('Desserts');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    // ===================================================================
    // WOK&GO EXPRESS — seeded in full but INACTIVE (client instruction).
    // Flip EXPRESS_ACTIVE at the top of this file to bring it back.
    // ===================================================================
    const grpExpressBase = await mkGroup(
        'Choose your Base',
        { minSelect: 1, maxSelect: 1 },
        ['Chow Mein Noodles', 'Egg Fried Rice', 'Plain Rice', 'Fries'].map(
            (b) => ({ name: b }),
        ),
    );
    // Sheet rule: "Large Box - 2 Toppings / XL Box - 3 Toppings" — enforced exactly via the
    // per-size selection limits (min/max_select_by_size keyed by the box variants' sizeKey).
    // The flat 2–3 stays as the fallback for anything without a size.
    const grpExpressToppings = await mkGroup(
        'Choose your Toppings',
        {
            minSelect: 2,
            maxSelect: 3,
            minSelectBySize: { large: 2, xl: 3 },
            maxSelectBySize: { large: 2, xl: 3 },
        },
        [
            'Salt & Pepper Chicken',
            'Sticky Chilli Wings',
            "Sweet'n'Sour Chicken",
            'Chinese Chicken Curry',
            'Beef Black Bean',
            'Chicken Thai Curry',
            'Chinese Fish Curry',
        ].map((t) => ({ name: t })),
    );
    const expressBox = await mkItem({
        category: catExpress,
        name: 'WOK&GO Express Box',
        description:
            "In a rush? Don't worry, we have you covered — get served in seconds. Choose noodles or egg fried rice with your choice of chicken, beef or fish curries. Large box: 2 toppings · XL box: 3 toppings.",
        basePrice: 999,
        active: EXPRESS_ACTIVE,
        sizes: [
            {
                name: 'Large Box',
                sizeKey: 'large',
                price: 999,
                isDefault: true,
            },
            { name: 'XL Box', sizeKey: 'xl', price: 1199 },
        ],
    });
    await linkGroups(expressBox, [
        grpExpressBase,
        grpExpressToppings,
        grpBoxMeal,
        grpMealDrinkShake,
    ]);

    // ===================================================================
    // BUILD YOUR OWN ("CREATE YOUR OWN")
    // ===================================================================
    const grpByoBase = await mkGroup(
        'Noodles or Rice?',
        { minSelect: 1, maxSelect: 1 },
        ['Egg Noodles', 'Vermicelli Noodles', 'Fried Rice', 'Plain Rice'].map(
            (b) => ({ name: b }),
        ),
    );
    // Prawn withdrawn in the 2026 sheet.
    const grpByoMeat = await mkGroup(
        'Choose Your Meat (max 2)',
        { minSelect: 0, maxSelect: 2 },
        ['Regular Chicken', 'Crispy Chicken', 'Beef', 'Shrimp'].map((m) => ({
            name: m,
        })),
    );
    // Mangetout withdrawn in the 2026 sheet.
    const grpByoVeg = await mkGroup(
        'Choose Your Veggies (max 3)',
        { minSelect: 0, maxSelect: 3 },
        [
            'Broccoli',
            'Baby Corn',
            'Mushroom',
            'Garden Peas',
            'Mixed Peppers',
            'Pineapple',
            'Tomato',
            'Extra Asian Veggies',
        ].map((v) => ({ name: v })),
    );
    // Black Bean, Katsu Curry and Sing-a-Sauce withdrawn in the 2026 sheet.
    // (Katsu Curry / Sing-a-Sauce track their boxes being withdrawn; Black Bean
    // does not — client confirmed that removal is intentional anyway.)
    const grpByoSauce = await mkGroup(
        'Choose Your Sauce (max 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Oyster',
            'Hoisin',
            'Indonesian Nasi',
            'Pad Thai',
            'Soy Sauce',
            'Sweet Chilli',
            "Sweet'n'Sour",
            'Teriyaki',
            'Thai Green Curry',
        ].map((s) => ({ name: s })),
    );
    // Fried Garlic → Spring Onions in the 2026 sheet.
    const grpByoToppings = await mkGroup(
        'Add Toppings (max 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Spring Onions',
            'Coriander',
            'Fresh Chillies',
            'Mixed Sesame',
            'Crushed Peanuts',
        ].map((t) => ({ name: t })),
    );
    const byoBox = await mkItem({
        category: catBYO,
        name: 'Create Your Own',
        description:
            'Best to experience — create your own to fulfil your taste buds. All boxes include wok-toasted carrots, beansprouts, spring onions and egg (optional).',
        basePrice: 1199,
        sizes: [
            {
                name: 'Large Box',
                sizeKey: 'large',
                price: 1199,
                isDefault: true,
            },
            { name: 'XL Box', sizeKey: 'xl', price: 1399 },
        ],
    });
    await linkGroups(byoBox, [
        grpByoBase,
        grpByoMeat,
        grpByoVeg,
        grpByoSauce,
        grpByoToppings,
        grpAddDrinksPaid,
    ]);

    // ===================================================================
    // CLASSIC BOXES — 10 boxes (Nasi Seafood and Sing'A'Box withdrawn),
    // all Large Rs999 / XL Rs1199, each with the drink upsell.
    // ===================================================================
    const classicBoxDefs: Array<[string, string]> = [
        ['Hot Box', 'Egg noodles, chicken, broccoli, secret hot chilli sauce'],
        [
            'Sweet Chilli Box',
            'Egg noodles, chicken, broccoli, tomato, pineapple, our secret sweet chilli sauce',
        ],
        [
            'Combo Box',
            'Egg noodles, chicken, beef, shrimp, broccoli, oyster sauce',
        ],
        [
            'Pad Thai Box',
            'Egg noodles, chicken, broccoli, peanuts, pad thai sauce',
        ],
        [
            "Sweet 'N' Sour Box",
            "Egg noodles, crispy chicken, mixed peppers, broccoli, our secret sweet'n'sour sauce",
        ],
        [
            'Spicey Seafood Box',
            'Egg noodles, shrimp, mixed peppers, spicy Malaysian style sauce',
        ],
        [
            'Green Curry Box',
            'Egg noodles, chicken, broccoli, mixed peppers, thai green curry sauce',
        ],
        [
            'Black Bean Box',
            'Egg noodles, crispy chicken, mixed peppers, broccoli, black bean sauce',
        ],
        [
            'Hoisin Box',
            'Egg noodles, crispy chicken, broccoli, spring onions, hoisin sauce',
        ],
        [
            'Chicken Teriyaki',
            'Egg noodles, chicken, broccoli, mixed peppers, our tasty teriyaki sauce',
        ],
    ];
    const classicBoxes: MenuItem[] = [];
    for (const [name, desc] of classicBoxDefs) {
        const box = await mkItem({
            category: catClassics,
            name,
            description: desc,
            basePrice: 999,
            sizes: [
                {
                    name: 'Large Box',
                    sizeKey: 'large',
                    price: 999,
                    isDefault: true,
                },
                { name: 'XL Box', sizeKey: 'xl', price: 1199 },
            ],
        });
        await linkGroups(box, [grpClassicMeal, grpMealDrinkSoda]);
        classicBoxes.push(box);
    }

    // ===================================================================
    // STREET FOOD — 6 items (Katsu Curry Box, Chinese Street Fries and
    // Surprise Bag withdrawn). No selections on the sheet.
    // ===================================================================
    const streetFoodDefs: Array<[string, string, number]> = [
        [
            "Salt'n'Pepper Crispy Shredded Chicken",
            "Egg fried rice, shredded chicken, onions, peppers, spring onions, chilli fried garlic, our salt'n'pepper spice, served with a pot of soy",
            1199,
        ],
        [
            'Peking Loaded Fries',
            'Hoisin chicken, spring onions, fresh chilli loaded on our fries',
            799,
        ],
        [
            'Firecracker Fries',
            'Fries covered in a spicy sauce, coriander, fresh chillies and spring onions',
            599,
        ],
        [
            'Teriyaki Fries',
            'Fries, spring onions, sesame seeds with teriyaki sauce',
            599,
        ],
        [
            // The new sheet shows the withdrawn Surprise Bag's text here — that
            // bled down when its row was deleted. Client: restore the original.
            'Chicken Chilli Dry',
            'Chicken, green peppers, onion, green chilli',
            699,
        ],
        [
            'Chicken Chow Mein Noodles',
            'Chicken, egg noodles, green pepper, onion, white cabbage, carrot',
            999,
        ],
    ];
    for (const [name, desc, price] of streetFoodDefs) {
        await mkItem({
            category: catStreetFood,
            name,
            description: desc,
            basePrice: price,
        });
    }

    // ===================================================================
    // KIDS MEAL — Rs699 mini combo box + fries + drink.
    // ===================================================================
    // Sheet's "Choose your cheese" header is a template mislabel — the options are bases.
    const grpKidsBase = await mkGroup(
        'Choose your Base',
        { minSelect: 1, maxSelect: 1 },
        ['Egg Noodles', 'Fried Rice', 'Plain Rice'].map((b) => ({ name: b })),
    );
    const grpKidsMeat = await mkGroup(
        'Choose your Meat',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Chicken' }, { name: 'Beef' }],
    );
    const grpKidsVeg = await mkGroup(
        'Veg Toppings (max 2)',
        { minSelect: 0, maxSelect: 2 },
        ['Mushroom', 'Mixed Peppers', 'Sweet Corn'].map((v) => ({ name: v })),
    );
    const grpKidsFries = await mkGroup(
        'Fries',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Regular Fries' }, { name: 'Large Fries', price: 200 }],
    );
    // Included drink, itemised: juices/water free, or upgrade to a small milkshake +Rs200.
    const grpKidsDrink = await mkGroup(
        'Choose your Drink',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'Orange Juice' },
            { name: 'Mango Juice' },
            { name: 'Water' },
            ...MILKSHAKES.map((m) => ({
                name: `Small ${m} Milkshake`,
                price: KIDS_SHAKE_UPGRADE,
            })),
        ],
    );
    const kidsMeal = await mkItem({
        category: catKids,
        name: 'Kids Meal',
        description:
            'Kids mini combo box, fries and drink (includes fries + juice drink)',
        basePrice: 699,
    });
    await linkGroups(kidsMeal, [
        grpKidsBase,
        grpKidsMeat,
        grpKidsVeg,
        grpKidsFries,
        grpKidsDrink,
    ]);

    // ===================================================================
    // PASTA — Rs949 each, with the same "Make it Meal?" upsell as the Express Box.
    // ===================================================================
    const pastaDefs: Array<[string, string]> = [
        [
            'Penne Marinara',
            'Penne pasta smothered in a tangy marinara sauce, topped with parmesan and fresh basil.',
        ],
        [
            'Creamy Pesto',
            'Pasta smothered in a creamy pesto sauce, topped with parmesan and fresh basil.',
        ],
        [
            'Mac & Cheese',
            'Creamy macaroni pasta smothered in a rich cheese blend, topped with parmesan and mozzarella.',
        ],
        [
            // Renamed from "Smooth Carbonara" in the 2026 sheet.
            'Chicken Carbonara',
            'Pasta tossed with a creamy carbonara sauce, topped with chicken and parmesan.',
        ],
        [
            'Chicken Arrabiata',
            'Tender chicken, earthy mushrooms, and tangy tomatoes tossed with pasta in a flavourful herb-infused sauce.',
        ],
    ];
    for (const [name, desc] of pastaDefs) {
        const pasta = await mkItem({
            category: catPasta,
            name,
            description: desc,
            basePrice: 949,
        });
        await linkGroups(pasta, [grpBoxMeal, grpMealDrinkShake]);
    }

    // ===================================================================
    // CLASSIC SIDES
    // (Sweet'n'Sour Chicken Balls and Mixed Side Platter withdrawn.)
    // ===================================================================
    // Client re-confirmed 5 pieces; the sheet's "4Pcs" name is wrong.
    await mkItem({
        category: catSides,
        name: 'Spring Rolls (5 Pcs)',
        description: 'Freshly fried 5 spring rolls',
        basePrice: 599,
    });
    await mkItem({
        category: catSides,
        name: "Hot'n'Kickin Chicken Wings",
        description:
            '5 freshly fried chicken wings coated in hot & spicy sauce',
        basePrice: 599,
    });
    await mkItem({
        category: catSides,
        name: 'Mini Sides Platter',
        description: "Reg fries, 2 spring rolls, 2 hot'n'kickin chicken wings",
        basePrice: 699,
    });
    await mkItem({
        category: catSides,
        name: 'Fries',
        description: 'Regular chips',
        basePrice: 225,
        sizes: [
            { name: 'Regular', sizeKey: null, price: 225, isDefault: true },
            { name: 'Large', sizeKey: null, price: 399 },
        ],
    });
    await mkItem({
        category: catSides,
        name: 'Spicy Fries',
        description: 'Chips with our secret spices',
        basePrice: 249,
        sizes: [
            { name: 'Regular', sizeKey: null, price: 249, isDefault: true },
            { name: 'Large', sizeKey: null, price: 425 },
        ],
    });
    await mkItem({
        category: catSides,
        name: 'Cheesy Garlic Fries',
        description: 'Popular chips with garlic cheese',
        basePrice: 499,
    });

    // Create Your Dirty Fries — cheese + 2 meats (same meat twice allowed) + meal upsell.
    const grpDirtyCheese = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'As it Comes' }, { name: 'No Cheese' }],
    );
    // "Customers can select a maximum of 2 toppings, either 2 different or the same topping
    // twice" → choose exactly 2 units, repeats allowed via the qty stepper.
    const grpDirtyMeat = await mkGroup(
        'Choose your Meat (choose 2)',
        { minSelect: 2, maxSelect: 2, allowQuantity: true },
        [
            'Chicken',
            'Beef',
            'Chicken Muglai',
            'Chicken Fajita',
            'Chicken Tikka',
            'Peri Peri Chicken',
        ].map((m) => ({ name: m })),
    );
    const dirtyFries = await mkItem({
        category: catSides,
        name: 'Create Your Dirty Fries',
        description: 'Chips with your choice of cheese and 2 meats',
        basePrice: 899,
    });
    await linkGroups(dirtyFries, [
        grpDirtyCheese,
        grpDirtyMeat,
        grpBoxMeal,
        grpMealDrinkShake, // client-confirmed: milkshakes offered on Dirty Fries too
    ]);

    // ===================================================================
    // WINGS & STRIPS — 5/10 pc size variants + one flavour. Repriced in 2026.
    // ===================================================================
    const grpWingFlavour = await mkGroup(
        'Choose your Flavour',
        { minSelect: 1, maxSelect: 1 },
        WING_FLAVOURS.map((f) => ({ name: f })),
    );
    const wings = await mkItem({
        category: catWings,
        name: 'Chicken Wings',
        description: 'Crispy chicken wings smothered in a choice of 5 flavours',
        basePrice: 699,
        sizes: [
            { name: '5 Pcs', sizeKey: '5', price: 699, isDefault: true },
            { name: '10 Pcs', sizeKey: '10', price: 1299 },
        ],
    });
    await linkGroups(wings, [grpWingFlavour]);
    const strips = await mkItem({
        category: catWings,
        name: 'Crispy Chicken Strips',
        description:
            '100% chicken breast breaded with our own spice blend, available in a choice of 5 flavours',
        basePrice: 699,
        sizes: [
            { name: '5 Pcs', sizeKey: '5', price: 699, isDefault: true },
            { name: '10 Pcs', sizeKey: '10', price: 1299 },
        ],
    });
    await linkGroups(strips, [grpWingFlavour]);

    // ===================================================================
    // DIPS — pick 1 / exactly 2 / exactly 3 (same dip repeatable via qty stepper).
    // ===================================================================
    const grpPick1Dip = await mkGroup(
        'Choose your Dip',
        { minSelect: 1, maxSelect: 1 },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const grpPick2Dip = await mkGroup(
        'Choose 2 Dips',
        { minSelect: 2, maxSelect: 2, allowQuantity: true },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const grpPick3Dip = await mkGroup(
        'Choose 3 Dips',
        { minSelect: 3, maxSelect: 3, allowQuantity: true },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const singleDip = await mkItem({
        category: catDips,
        name: 'Single Dip',
        description:
            'Choose from: Soy, Garlic & Herb, BBQ, Sweet Chilli, Tomato Ketchup, Hot Peri-Peri',
        basePrice: 99,
    });
    await linkGroups(singleDip, [grpPick1Dip]);
    const twoDips = await mkItem({
        category: catDips,
        name: '2 Dips',
        description: 'Choose 2 dips',
        basePrice: 169,
    });
    await linkGroups(twoDips, [grpPick2Dip]);
    const threeDips = await mkItem({
        category: catDips,
        name: '3 Dips',
        description: 'Choose 3 dips',
        basePrice: 249,
    });
    await linkGroups(threeDips, [grpPick3Dip]);

    // ===================================================================
    // DESSERTS (prices come from the description text on the sheet)
    // ===================================================================
    const grpCookieFlavour = await mkGroup(
        'Choose Your Flavour',
        { minSelect: 1, maxSelect: 1 },
        COOKIE_FLAVOURS.map((f) => ({ name: f })),
    );
    const cookie = await mkItem({
        category: catDesserts,
        name: 'Homemade Cookie',
        description: 'Choose from our special flavours',
        basePrice: 350,
    });
    await linkGroups(cookie, [grpCookieFlavour]);
    // Brownie lost its With/Without Chocolate Spread choice in the 2026 sheet.
    const brownie = await mkItem({
        category: catDesserts,
        name: 'Chocolate Brownie',
        description: 'Chocolate brownie with chocolate spread (1 per portion)',
        basePrice: 299,
    });
    await linkGroups(brownie, []);
    const grpCookieCreamFlavour = await mkGroup(
        'Choose your Cookie Flavour',
        { minSelect: 1, maxSelect: 1 },
        COOKIE_FLAVOURS.map((f) => ({ name: f })),
    );
    const cookieCream = await mkItem({
        category: catDesserts,
        name: 'Cookie and Cream',
        description: 'Choose from our special cookie flavours',
        basePrice: 499,
    });
    await linkGroups(cookieCream, [grpCookieCreamFlavour]);
    const grpDoughnutFlavour = await mkGroup(
        'Choose Your Flavour',
        { minSelect: 1, maxSelect: 1 },
        DOUGHNUT_FLAVOURS.map((f) => ({ name: f })),
    );
    const doughnut = await mkItem({
        category: catDesserts,
        name: 'Doughnut',
        description: 'Our special selection of doughnuts',
        basePrice: 250,
    });
    await linkGroups(doughnut, [grpDoughnutFlavour]);

    // ===================================================================
    // MILKSHAKES (Rs499 each)
    // ===================================================================
    const milkshakeItems: MenuItem[] = [];
    for (const s of MILKSHAKES) {
        milkshakeItems.push(
            await mkItem({
                category: catShakes,
                name: `${s} Milkshake`,
                description:
                    'Freshly made luscious milkshake with real fresh ingredients',
                basePrice: 499,
            }),
        );
    }

    // ===================================================================
    // DRINKS (standalone) — each soda flavour in 345ml / 1L / 1.5L; plus water.
    // Juice 200ml withdrawn in the 2026 sheet.
    // ===================================================================
    const SODA_SIZES: Array<[string, number]> = [
        ['345ml', MEAL_DRINK_345],
        ['1L', 199],
        ['1.5L', 249],
    ];
    const drinkItems: Record<string, MenuItem> = {};
    for (const flavour of SODAS) {
        for (const [label, price] of SODA_SIZES) {
            const it = await mkItem({
                category: catDrinks,
                name: `${flavour} ${label}`,
                basePrice: price,
            });
            drinkItems[`${flavour} ${label}`] = it;
        }
    }
    for (const flavour of SODAS_500ML) {
        drinkItems[`${flavour} 500ml`] = await mkItem({
            category: catDrinks,
            name: `${flavour} 500ml`,
            basePrice: PRICE_500ML,
        });
    }
    await mkItem({ category: catDrinks, name: 'Water 500ml', basePrice: 75 });

    const sodas345 = SODAS.map((f) => drinkItems[`${f} 345ml`].id);
    const sodas500 = SODAS_500ML.map((f) => drinkItems[`${f} 500ml`].id);

    // ===================================================================
    // DEALS (deal = MenuItem in "Deals" category + deal_components)
    // ===================================================================
    const mkDeal = async (opts: {
        name: string;
        description: string;
        price: number;
        lunch?: boolean;
        active?: boolean;
        slots: Array<{
            type: 'fixed' | 'choice_category' | 'choice_list';
            sourceMenuItemId?: number | null;
            sourceCategoryId?: number | null;
            sourceMenuItemIds?: number[] | null;
            quantity?: number;
            optional?: boolean;
            allowCustomization?: boolean;
            slotSurcharges?: Record<string, number> | null;
            slotSizeKey?: string | null;
        }>;
    }) => {
        const deal = await mkItem({
            category: catDeals,
            name: opts.name,
            description: opts.description,
            basePrice: opts.price,
            active: opts.active ?? true,
            availableTimeStart: opts.lunch ? LUNCH_START : null,
            availableTimeEnd: opts.lunch ? LUNCH_END : null,
            availableDaysOfWeek: opts.lunch ? LUNCH_DAYS : null,
        });
        let slotIndex = 0;
        for (const s of opts.slots) {
            await dealComponentRepo.save(
                dealComponentRepo.create({
                    menuItemId: deal.id,
                    slotIndex: slotIndex++,
                    type: s.type,
                    sourceMenuItemId: s.sourceMenuItemId ?? null,
                    sourceCategoryId: s.sourceCategoryId ?? null,
                    sourceMenuItemIds: s.sourceMenuItemIds ?? null,
                    quantity: s.quantity ?? 1,
                    optional: s.optional ?? false,
                    allowCustomization: s.allowCustomization ?? true,
                    slotSurcharges: s.slotSurcharges ?? null,
                    slotSizeKey: s.slotSizeKey ?? null,
                    allowedSizeKeys: null,
                    mirrorSlotIndex: null,
                    mirrorMatchSize: false,
                    mirrorMatchCategory: false,
                }),
            );
        }
        return deal;
    };

    // "Choose your box … from any large Classic Box or … WOK&GO Express Boxes",
    // pinned to the Large variant. The Express Box only joins the list while
    // WOK&GO Express is switched on.
    const largeBoxSlot = () => ({
        type: 'choice_list' as const,
        sourceMenuItemIds: [
            ...classicBoxes.map((b) => b.id),
            ...(EXPRESS_ACTIVE ? [expressBox.id] : []),
        ],
        quantity: 1,
        allowCustomization: true,
        slotSizeKey: 'large',
    });
    // "Choose your drink — give options of 345ml drinks from drinks section" (included);
    // milkshakes offered in every drink chooser at +Rs250 (client-confirmed).
    const drink345Slot = () => ({
        type: 'choice_list' as const,
        sourceMenuItemIds: [
            ...sodas345,
            ...sodas500,
            ...milkshakeItems.map((m) => m.id),
        ],
        quantity: 1,
        allowCustomization: false,
        slotSurcharges: {
            ...Object.fromEntries(
                milkshakeItems.map((m) => [String(m.id), MILKSHAKE_UPGRADE]),
            ),
            ...Object.fromEntries(
                sodas500.map((id) => [String(id), UPGRADE_500ML]),
            ),
        },
    });

    await mkDeal({
        name: 'Any Large Box with Drink',
        description:
            'Get any of our large boxes from our Classic range with a 345ml drink.',
        price: 1099,
        slots: [largeBoxSlot(), drink345Slot()],
    });

    await mkDeal({
        name: 'Deal for 2 — Two Large Boxes and 2 Drinks',
        description:
            'Get two of our large boxes from our Classic range with two 345ml drinks.',
        price: 1999,
        slots: [largeBoxSlot(), largeBoxSlot(), drink345Slot(), drink345Slot()],
    });

    // Lunch Special — Express Large box + 345ml drink, Mon–Fri 12:00–16:00 only.
    // Can ONLY be built from the Express Box, so it follows WOK&GO Express in
    // and out of service.
    await mkDeal({
        name: 'Lunch Special',
        description:
            'Get a large box from our tasty WOK&GO Express menu with a 345ml drink. Monday to Friday, 12:00–16:00 only.',
        price: 999,
        lunch: true,
        active: EXPRESS_ACTIVE,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: [expressBox.id],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: 'large', // "Only one Large box."
            },
            drink345Slot(),
        ],
    });

    // ===================================================================
    // WITHDRAW what is no longer on the menu — deactivate, never delete.
    // ===================================================================
    const allBrandItems = await itemRepo.find({ where: { brandId } });
    const retired: string[] = [];
    for (const it of allBrandItems) {
        if (touchedItems.has(it.id)) continue;
        if (!it.isActive) continue;
        it.isActive = false;
        await itemRepo.save(it);
        retired.push(it.name);
    }
    const allBrandCats = await categoryRepo.find({ where: { brandId } });
    const retiredCatNames: string[] = [];
    for (const c of allBrandCats) {
        if (touchedCategories.has(c.id)) continue;
        if (!c.isActive) continue;
        c.isActive = false;
        await categoryRepo.save(c);
        retiredCatNames.push(c.name);
    }
    const allBrandAddons = await addonRepo.find({ where: { brandId } });
    const retiredAddonNames: string[] = [];
    for (const a of allBrandAddons) {
        if (touchedAddons.has(a.id)) continue;
        if (!a.isActive) continue;
        a.isActive = false;
        await addonRepo.save(a);
        retiredAddonNames.push(a.name);
    }

    // ——— Make every item available at the brand's branches ———
    // Existing rows are left exactly as they are (price overrides / manual
    // availability toggles are the branch's business, not the seeder's).
    const branches = await branchRepo
        .createQueryBuilder('b')
        .innerJoin('branch_brands', 'bb', 'bb.branch_id = b.id')
        .where('bb.brand_id = :brandId', { brandId })
        .getMany();
    let bmiCreated = 0;
    for (const b of branches) {
        for (const itId of touchedItems) {
            const existing = await bmiRepo.findOne({
                where: { branchId: b.id, menuItemId: itId },
            });
            if (!existing) {
                await bmiRepo.save(
                    bmiRepo.create({
                        branchId: b.id,
                        menuItemId: itId,
                        priceOverride: null,
                        isAvailable: true,
                        isHiddenOnline: false,
                    }),
                );
                bmiCreated++;
            }
        }
    }

    const activeCount = touchedItems.size - deliberatelyInactive.length + 1; // +1: the inactive category is not an item
    console.log('');
    console.log('Wok & Go 2026 menu seeded (non-destructive).');
    console.log(
        `  seeded: ${touchedItems.size} items across ${touchedCategories.size} categories ` +
            `(${activeCount} items active)`,
    );
    console.log(
        `  branches linked: ${branches.length} (${bmiCreated} new branch_menu_items row(s))`,
    );
    if (deliberatelyInactive.length) {
        console.log(
            `  seeded but switched OFF (EXPRESS_ACTIVE=false): ${deliberatelyInactive.join(', ')}`,
        );
    }
    if (retiredCatNames.length) {
        console.log(
            `  categories deactivated (${retiredCatNames.length}): ${retiredCatNames.join(', ')}`,
        );
    }
    if (retiredAddonNames.length) {
        console.log(
            `  addons deactivated (${retiredAddonNames.length}): ${retiredAddonNames.join(', ')}`,
        );
    }
    if (retired.length) {
        console.log(`  items deactivated (${retired.length}):`);
        for (const n of retired) console.log(`    - ${n}`);
    }
    console.log('  nothing was deleted; order history is intact.');
    await dataSource.destroy();
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
