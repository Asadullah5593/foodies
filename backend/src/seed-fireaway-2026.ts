/**
 * Seed: Fireaway (Pakistan) menu — 2026 refresh.
 *
 * Source: "new updated menu/Foodies Master Menu Fireaway .xlsx" → sheet
 * "Fireaway (App & EPOS)", plus the client answers recorded below.
 *
 * This file REPLACES seed-fireaway-real.ts as the current menu definition.
 * seed-fireaway-real.ts is left untouched as the historical (pre-2026) record.
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
 * rebuild would destroy them). Override with FIREAWAY_SEED_FORCE=1.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED vs the previous menu
 * ───────────────────────────────────────────────────────────────────────────
 *  1. Sizes collapsed to Large 12" only (7", 9"/10" and 14" withdrawn).
 *     Extra toppings are now flat: meat Rs199, veg Rs89, extra cheese Rs249.
 *     3 meats + 3 veg included; 1 free dip.  [client: "its 12""]
 *  2. Coca-Cola range → Pepsi range (Pepsi, Diet Pepsi, 7up, Mirinda,
 *     Mountain Dew). Standalone 200ml juices delisted.
 *  3. Deals: 3 withdrawn, 7 renamed, Pasta Deluxe repriced 1499 → 1449.
 *  4. BOGO is 12"-only and its title no longer says "Large/XLarge".
 *     [client: "its 12" only fix title"]
 *  5. Pizzas: + Chicken Pesto Menifesto, + Angus Beef Special,
 *     − Wild Beef, Chicken Muglai moved Signature → Classic (1949 → 1749).
 *  6. Fireaway Special Salad withdrawn; category renamed to "Wings & Strips".
 *  7. Milkshakes cut to the 6 flavours listed in the new sheet.
 *     [client: "milkshake list should be copied from current milkshake
 *      options from new file"]
 *  8. Kids Meal keeps its juice choice and gains an "Add a Milkshake" flavour
 *     chooser (6 flavours, Rs499 each, repeatable) — a modifier group, not a
 *     flat addon, so the flavour is captured on the order.
 *     [client: "keep juice for kids meal" + flavour selection requested]
 *  9. Dessert flavour lists refreshed; pizza dip up-sell drops Mayo and
 *     Tomato Ketchup and gains Chipotle.
 *
 * Carried over from the old seeder (client-communicated, never in any sheet):
 * wrap "Make it a Meal?" Rs350 + its conditional meal-drink chooser, tiered
 * dip pricing, Remove-a-filling / Add-a-Sauce, Kids juice chooser,
 * Classic/Signature labels, hide_in_deals on cross-sell groups.
 *
 * Lunch windows are Mon–Fri 12:00–16:00 (the 18:00 end-time found in the dev
 * DB was a test edit, not a client instruction).
 *
 * Modifier-group names are NOT unique per brand, and must not be made unique:
 * the name is the heading the customer sees in the customize modal, and this
 * seeder rebuilds every group each run, so duplicates cost nothing.
 *
 * Run: npm run seed:fireaway-2026   (requires `npm run seed` first)
 * Prices are whole Rupees.
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource, In } from 'typeorm';
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

const BRAND_SLUG = 'fireaway';
const BRAND_NAME = 'Fireaway';

// ——— Single surviving size ———
const SIZE = '12';
const SIZE_LABEL = 'Large 12"';
const MEAT_PRICE = 199;
const VEG_PRICE = 89;
const CHEESE_PRICE = 249;
const INCLUDED_TOPPINGS = 3; // free meats, and separately free veg, on 12"
const DIP_INCLUDED = 1; // "1 free dip with 12"" (client-confirmed)
const DIP_PRICE_TIERS = { '1': 99, '2': 169, '3': 249 };

// "Each topping can be selected multiple times at an additional charge" → no cap.
const REPEAT_MAX = 99;
const LUNCH_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const LUNCH_START = '12:00';
const LUNCH_END = '16:00';
const COLLECTION_ONLY = ['pickup', 'dine_in']; // "Collection / In-store"

const PRICE_CLASSIC = 1749;
const PRICE_SIGNATURE = 1949;
const PRICE_MARGHERITA = 1299;
const PRICE_BYO = 1949;

const MEATS = [
    'Chicken Pepperoni',
    'Beef Pepperoni',
    'Chicken Muglai',
    'Chicken Fajita',
    'Chicken Tikka',
    'Peri Peri Chicken',
    'Kebab',
    'Sausage',
    'BBQ Chicken',
];
const VEGGIES = [
    'Black Olives',
    'Fresh Chillies',
    'Sweetcorn',
    'Jalapeños',
    'Mushrooms',
    'Mixed Peppers',
    'Pineapple',
    'Red Onion',
];
// Cheesy Garlic Bread / wrap extra toppings: the new sheet blanked out
// Beef Pepperoni and Kebab in this list.
const SIDE_TOPPING_MEATS = MEATS.filter(
    (m) => m !== 'Beef Pepperoni' && m !== 'Kebab',
);
const TOP_IT_OFF = [
    'Chilli Oil',
    'Garlic Oil',
    'Chilli Flakes',
    'Crispy Onion',
    'Oregano',
];
const BASE_SAUCES = [
    'Tomato Base',
    'Spicy Tomato Base',
    'BBQ Base',
    'Pesto Base',
    'Garlic Oil Base',
    'Peri Peri Base',
];
// Standalone Dips category — unchanged in the new sheet.
const DIPS = [
    'Ranch',
    'Garlic & Herb',
    'BBQ',
    'Sweet Chilli',
    'Tomato Ketchup',
    'Hot Peri-Peri',
];
// Dip up-sell shown on a pizza/calzone — Mayo and Tomato Ketchup dropped,
// Chipotle added.
const PIZZA_DIPS = [
    'Ranch',
    'Garlic & Herb',
    'BBQ',
    'Sweet Chilli',
    'Hot Peri-Peri',
    'Chipotle',
];
const MILKSHAKE_FLAVOURS = [
    'Oreo',
    'Nutella',
    'Lotus Biscoff',
    'Strawberry',
    'Chocolate',
    'Pistachio',
];
const SOFT_DRINKS = ['Pepsi', 'Diet Pepsi', '7up', 'Mirinda', 'Mountain Dew'];
const DEAL_250ML = [
    'Pepsi 250ml',
    'Diet Pepsi 250ml',
    'Mountain Dew 250ml',
    'Mirinda 250ml',
    '7up 250ml',
    'Still Water 250ml',
];
const WING_FLAVOURS = [
    'Plain',
    'BBQ Crunch',
    'Chilli Honey',
    'Garlic Parmesan',
    'Heat Extreme',
    'Peri Peri',
];

// Applied before anything else so the row (and its id / order history) survives.
const RENAMED_CATEGORIES: Array<[string, string]> = [
    ['Wings, Strips & Salads', 'Wings & Strips'],
];
const RENAMED_ITEMS: Array<[string, string]> = [
    ['Large Pizza Lunch Offer', 'Classic Lunch Feast Offer'],
    ['Medium Pizza, Pasta Lunch Offer', 'Power Lunch Offer'],
    ['Fireaway Wrap Lunch Deal', 'Fireaway Wrap & Roll Lunch Deal'],
    ['Snack Special', 'Snack Attack'],
    ['Large Pizza Deal', 'Family Feast Deal'],
    ['Pasta Deal', 'Pasta Combo'],
    ['Pasta Basta Special', 'Pasta Deluxe Special'],
    ['Build Your Own Pizza (Medium Deal)', 'Build Your Own Pizza (Lunch Deal)'],
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

    let brand = await brandRepo.findOne({ where: { slug: BRAND_SLUG } });
    if (!brand) {
        brand = await brandRepo.save(
            brandRepo.create({
                tenantId: tenant.id,
                name: BRAND_NAME,
                slug: BRAND_SLUG,
                description: 'Stone-baked pizza, your way.',
                logoUrl: null,
                isActive: true,
            }),
        );
        console.log(`Created brand: ${brand.name}`);
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
    if (recipeRefs > 0 && process.env.FIREAWAY_SEED_FORCE !== '1') {
        console.error(
            `ABORTING: ${recipeRefs} recipe row(s) reference this brand's modifiers/variants.\n` +
                `Rebuilding them would cascade-delete those recipes. Review them first, then\n` +
                `re-run with FIREAWAY_SEED_FORCE=1 if you accept the loss.`,
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

    // ——— Helpers ———
    const touchedCategories = new Set<number>();
    const touchedItems = new Set<number>();
    const touchedAddons = new Set<number>();

    let catSort = 0;
    const mkCategory = async (name: string, description?: string) => {
        let cat = await categoryRepo.findOne({ where: { brandId, name } });
        if (!cat) {
            cat = categoryRepo.create({ brandId, name, imageUrl: null });
        }
        cat.description = description ?? null;
        cat.sortOrder = catSort++;
        cat.isActive = true;
        cat = await categoryRepo.save(cat);
        touchedCategories.add(cat.id);
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
        channels?: string[] | null;
        /** Sale channels ('pos'|'app'|'web'|'kiosk'); null = all channels. */
        availableChannels?: string[] | null;
        label?: string | null;
        availableTimeStart?: string | null;
        availableTimeEnd?: string | null;
        availableDaysOfWeek?: number[] | null;
        dealPricingMode?: string | null;
        dealBogoBuyQuantity?: number | null;
        dealBogoGetQuantity?: number | null;
        dealBogoGetPercent?: number | null;
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
        item.categoryId = opts.category.id;
        item.description = opts.description ?? null;
        item.basePrice = opts.basePrice;
        item.isActive = true;
        item.sortOrder = itemSort++;
        item.dealOnly = opts.dealOnly ?? false;
        item.availableForOrderTypes = opts.channels ?? null;
        item.availableChannels = opts.availableChannels ?? null;
        item.label = opts.label ?? null;
        // Allergens & calories columns are present but BLANK in the sheet → left null.
        item.allergens = null;
        item.calories = null;
        item.availableTimeStart = opts.availableTimeStart ?? null;
        item.availableTimeEnd = opts.availableTimeEnd ?? null;
        item.availableDaysOfWeek = opts.availableDaysOfWeek ?? null;
        item.dealPricingMode = opts.dealPricingMode ?? null;
        item.dealBogoBuyQuantity = opts.dealBogoBuyQuantity ?? null;
        item.dealBogoGetQuantity = opts.dealBogoGetQuantity ?? null;
        item.dealBogoGetPercent = opts.dealBogoGetPercent ?? null;
        item = await itemRepo.save(item);
        touchedItems.add(item.id);

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

    const mkAddon = async (
        category: MenuCategory,
        name: string,
        price: number,
        sortOrder: number,
    ) => {
        let addon = await addonRepo.findOne({ where: { brandId, name } });
        if (!addon) {
            addon = addonRepo.create({ brandId, name });
        }
        addon.categoryId = category.id;
        addon.price = price;
        addon.isActive = true;
        addon.sortOrder = sortOrder;
        addon = await addonRepo.save(addon);
        touchedAddons.add(addon.id);
        return addon;
    };

    type ModDef = {
        name: string;
        price?: number;
        priceBySize?: Record<string, number> | null;
        availableForSizes?: string[] | null;
    };
    const mkGroup = async (
        name: string,
        cfg: {
            minSelect?: number;
            maxSelect?: number;
            includedQuantity?: number;
            includedBySize?: Record<string, number> | null;
            allowQuantity?: boolean;
            priceTiers?: Record<string, number> | null;
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
                includedQuantity: cfg.includedQuantity ?? 0,
                includedBySize: cfg.includedBySize ?? null,
                allowQuantity: cfg.allowQuantity ?? false,
                priceTiers: cfg.priceTiers ?? null,
                hideInDeals: cfg.hideInDeals ?? false,
            }),
        );
        for (const m of mods) {
            await modifierRepo.save(
                modifierRepo.create({
                    modifierGroupId: group.id,
                    name: m.name,
                    price: m.price ?? 0,
                    priceBySize: m.priceBySize ?? null,
                    availableForSizes: m.availableForSizes ?? null,
                }),
            );
        }
        return group;
    };

    const linkGroups = async (item: MenuItem, groups: ModifierGroup[]) => {
        await dataSource
            .createQueryBuilder()
            .relation(MenuItem, 'modifierGroups')
            .of(item.id)
            .add(groups.map((g) => g.id));
        // Persist per-item display order so the customize wizard follows THIS array
        // (e.g. "Pizza or Calzone" first), not the global group sort_order/id order.
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
    const linkAddons = async (item: MenuItem, addons: MenuAddon[]) => {
        if (!addons.length) return;
        await dataSource.query(
            'DELETE FROM menu_item_addons WHERE menu_item_id = $1',
            [item.id],
        );
        await dataSource
            .createQueryBuilder()
            .relation(MenuItem, 'addons')
            .of(item.id)
            .add(addons.map((a) => a.id));
    };

    // ===================================================================
    // SHARED MODIFIER GROUPS (reused across items via M2M)
    // ===================================================================
    // Only 12" survives, so Thin and Regular are both always available.
    const grpCrust = await mkGroup(
        'Choose your Crust',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Thin Crust' }, { name: 'Regular Crust' }],
    );
    const grpBase = await mkGroup(
        'Choose Your Base',
        { minSelect: 1, maxSelect: 1 },
        BASE_SAUCES.map((b) => ({ name: b })),
    );
    // BYO cheese: Mozzarella included; Extra Cheese Rs249 (12").
    const grpCheeseBYO = await mkGroup(
        'Choose Your Cheese',
        { minSelect: 1, maxSelect: 2 },
        [{ name: 'Mozzarella' }, { name: 'Extra Cheese', price: CHEESE_PRICE }],
    );
    // Classic/Signature cheese: As It Comes / No Cheese / Extra Cheese.
    const grpCheeseSig = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 }, // required, exactly one (auto-selects "As It Comes")
        [
            { name: 'As It Comes' },
            { name: 'No Cheese On The Pizza' },
            { name: 'Extra Cheese', price: CHEESE_PRICE },
        ],
    );
    // BYO meats/veg: 3 free each on 12"; extras Rs199 / Rs89.
    const grpMeatBYO = await mkGroup(
        'Choose Your Meat',
        {
            minSelect: 0,
            maxSelect: REPEAT_MAX,
            includedQuantity: INCLUDED_TOPPINGS,
        },
        MEATS.map((m) => ({ name: m, price: MEAT_PRICE })),
    );
    const grpVegBYO = await mkGroup(
        'Choose Your Veggies',
        {
            minSelect: 0,
            maxSelect: REPEAT_MAX,
            includedQuantity: INCLUDED_TOPPINGS,
        },
        VEGGIES.map((v) => ({ name: v, price: VEG_PRICE })),
    );
    const grpTopItOff = await mkGroup(
        'Top It Off',
        { minSelect: 0, maxSelect: 1 },
        TOP_IT_OFF.map((t) => ({ name: t })),
    );
    // Signature/Classic extra toppings: meats + veg in one list, no free
    // allowance, each repeatable at the 12" rate.
    const grpSigToppings = await mkGroup(
        'Add Extra Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            ...MEATS.map((m) => ({ name: `Extra ${m}`, price: MEAT_PRICE })),
            ...VEGGIES.map((v) => ({ name: `Extra ${v}`, price: VEG_PRICE })),
        ],
    );
    // Lunch-deal pizza toppings: the deal grants exactly 2 (two different, or
    // the same twice) with NO surcharge, so no charged extras are offered.
    const grpDealToppings = await mkGroup(
        'Choose 2 Toppings',
        { minSelect: 0, maxSelect: 2, includedQuantity: 2 },
        [
            ...MEATS.map((m) => ({ name: m })),
            ...VEGGIES.map((v) => ({ name: v })),
        ],
    );
    const grpPizzaOrCalzone = await mkGroup(
        'Pizza or Calzone',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Pizza' }, { name: 'Calzone' }],
    );
    // Dips on a pizza/calzone: 1 free on 12", then a tiered bundle price
    // (1=99, 2=169, 3=249) for the extras.
    const grpAddDips = await mkGroup(
        'Add a dip(s)',
        {
            minSelect: 0,
            maxSelect: 6,
            includedQuantity: DIP_INCLUDED,
            priceTiers: DIP_PRICE_TIERS,
        },
        PIZZA_DIPS.map((d) => ({ name: d })),
    );
    // Drinks as a paid up-sell. Cross-sell — hidden inside deals (deals supply
    // drinks via their own slot).
    const grpAddDrinks = await mkGroup(
        'Add a drink(s)',
        { minSelect: 0, maxSelect: REPEAT_MAX, hideInDeals: true },
        [
            ...SOFT_DRINKS.map((f) => ({ name: `${f} 345ml`, price: 130 })),
            { name: 'Water 500ml', price: 75 },
            ...SOFT_DRINKS.map((f) => ({ name: `${f} 1L`, price: 199 })),
            ...SOFT_DRINKS.map((f) => ({ name: `${f} 1.5L`, price: 249 })),
        ],
    );

    // ===================================================================
    // CATEGORIES + ITEMS
    // ===================================================================
    const catDeals = await mkCategory('Deals');
    const catBYO = await mkCategory('Build Your Own');
    const catPizza = await mkCategory('Classic and Signature Pizza Or Calzone');
    const catKids = await mkCategory('Kids Pizza');
    const catPasta = await mkCategory('Pasta', 'Delicious oven baked pastas');
    const catSides = await mkCategory('Classic Sides');
    const catWings = await mkCategory('Wings & Strips');
    const catDips = await mkCategory('Dips');
    const catWraps = await mkCategory(
        'Firey Wraps',
        'All wraps come with lettuce, onion, cucumber and mayo',
    );
    const catDesserts = await mkCategory('Desserts');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    // Single size — kept as a variant so deal slots can still pin on size_key '12'.
    const large12 = (price: number): SizeDef[] => [
        { name: SIZE_LABEL, sizeKey: SIZE, price, isDefault: true },
    ];

    // ——— BUILD YOUR OWN ———
    const byo = await mkItem({
        category: catBYO,
        name: 'Build Your Own Pizza',
        description:
            'Choose your base and throw on as many toppings as you like! Up to 7 toppings in total: 3 meats, 3 veg and 1 top it off.',
        basePrice: PRICE_BYO,
        sizes: large12(PRICE_BYO),
    });
    await linkGroups(byo, [
        grpCrust,
        grpBase,
        grpCheeseBYO,
        grpMeatBYO,
        grpVegBYO,
        grpTopItOff,
        grpAddDips,
        grpAddDrinks,
    ]);

    // ——— CLASSIC & SIGNATURE PIZZAS ———
    const pizzaGroups = [
        grpPizzaOrCalzone,
        grpCrust,
        grpCheeseSig,
        grpSigToppings,
        grpAddDips,
        grpAddDrinks,
    ];

    const classicPizzas: MenuItem[] = []; // for Classic-only deals
    const classics: Array<[string, string]> = [
        [
            'Twisted Hawaiian Pizza',
            'Tomato base, mozzarella, chicken and pineapple',
        ],
        [
            'Veggie Supreme Pizza',
            'Tomato base, mozzarella, onions, mixed peppers, sweetcorn, mushrooms and olives',
        ],
        [
            'BBQ Chicken Pizza',
            'BBQ base, mozzarella, red onions, green peppers, sweetcorn, jalapeños and fajita chicken',
        ],
        [
            'Chicken Special Pizza',
            'Tomato base, mozzarella, chicken tikka, chicken pepperoni, jalapeno, sweetcorn',
        ],
        [
            'Chicken Tikka Pizza',
            'Tomato base, mozzarella, chicken tikka, mixed peppers, onions and jalapeños',
        ],
        // Moved Signature → Classic in the new sheet (so Rs1949 → Rs1749).
        [
            'Chicken Muglai Pizza',
            'Tomato base, mozzarella, chicken muglai, chicken fajita, onion and jalapeños',
        ],
    ];
    for (const [name, desc] of classics) {
        const it = await mkItem({
            category: catPizza,
            name,
            description: desc,
            basePrice: PRICE_CLASSIC,
            sizes: large12(PRICE_CLASSIC),
            label: 'Classic',
        });
        await linkGroups(it, pizzaGroups);
        classicPizzas.push(it);
    }
    const signatures: Array<[string, string]> = [
        // New in the 2026 sheet.
        [
            'Chicken Pesto Menifesto',
            'Pesto base sauce, chicken with herbs, tomatoes, onion and sun-dried tomatoes',
        ],
        // New in the 2026 sheet.
        [
            'Angus Beef Special',
            'Taco beef mince, mozzarella, peppers, onion, jalapenos and taco sauce',
        ],
        [
            'Fireaway Special Pizza',
            'Spicy tomato base, mozzarella, chicken muglai, peri peri chicken, red onions and mushrooms',
        ],
        [
            'King Pepperoni Pizza',
            'Tomato base, mozzarella and loaded with pepperoni',
        ],
        [
            'Meat Heaven Pizza',
            'Tomato base, mozzarella, chicken fajita, sausages, chicken pepperoni, onion, green peppers',
        ],
        [
            'Sausage Special Pizza',
            'Tomato base, mozzarella, sausages, onions, jalapeños and mushrooms',
        ],
        [
            'Peri Peri Special',
            'Peri peri tomato base, mozzarella, peri peri chicken, jalapenos, chillies',
        ],
    ];
    const signaturePizzas: MenuItem[] = []; // for the BOGO eligible pool
    for (const [name, desc] of signatures) {
        const it = await mkItem({
            category: catPizza,
            name,
            description: desc,
            basePrice: PRICE_SIGNATURE,
            sizes: large12(PRICE_SIGNATURE),
            label: 'Signature',
        });
        await linkGroups(it, pizzaGroups);
        signaturePizzas.push(it);
    }
    // Margherita — its own price.
    const margherita = await mkItem({
        category: catPizza,
        name: 'Margherita Pizza',
        description: 'Tomato base and mozzarella',
        basePrice: PRICE_MARGHERITA,
        sizes: large12(PRICE_MARGHERITA),
        label: 'Classic',
    });
    await linkGroups(margherita, pizzaGroups);
    classicPizzas.push(margherita);

    // ——— KIDS PIZZA ———
    // Kids pizza is its own small base, so it keeps its own flat topping prices
    // rather than inheriting the 12" rates.
    const kids = await mkItem({
        category: catKids,
        name: 'Kids Pizza Meal',
        description:
            'Margherita pizza for kids in a smiley bear shape: tomato base, mozzarella and fresh basil. Includes a juice drink.',
        basePrice: 899,
    });
    const grpKidsCheese = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'As It Comes' }, { name: 'No Cheese On The Pizza' }],
    );
    // The kids meal always includes a juice drink → let the customer pick which
    // one (free). Retained on the client's instruction even though the 200ml
    // juices are no longer sold as standalone drinks.
    const grpKidsJuice = await mkGroup(
        'Choose your Juice',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Orange Juice' }, { name: 'Mango Juice' }],
    );
    const grpKidsToppings = await mkGroup(
        'Add Extra Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            ...MEATS.map((m) => ({ name: `Extra ${m}`, price: 99 })),
            ...VEGGIES.map((v) => ({ name: `Extra ${v}`, price: 49 })),
        ],
    );
    // New in the 2026 sheet: "Add Milkshake for Rs 499". A modifier GROUP (not
    // a flat addon) so the customer picks WHICH flavour; each option carries the
    // full Rs 499 price. allowQuantity keeps the multiple-milkshakes ability the
    // old addon stepper had. (The previous "Add Milkshake" addon is retired by
    // the deactivation sweep below.)
    const grpKidsShake = await mkGroup(
        'Add a Milkshake',
        { minSelect: 0, maxSelect: 6, allowQuantity: true },
        MILKSHAKE_FLAVOURS.map((f) => ({
            name: `${f} Milkshake`,
            price: 499,
        })),
    );
    await linkGroups(kids, [
        grpKidsCheese,
        grpKidsJuice,
        grpKidsToppings,
        grpKidsShake,
    ]);
    const addonKidsFries = await mkAddon(catKids, 'Add Fries', 199, 0);
    await linkAddons(kids, [addonKidsFries]);

    // ——— PASTA (Rs949 each) ———
    const grpAddParmesan = await mkGroup(
        'Additional',
        { minSelect: 0, maxSelect: 1 },
        [{ name: 'Add Parmesan' }],
    );
    const pastas: Array<[string, string]> = [
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
            'Smooth Carbonara',
            'Pasta tossed with a creamy carbonara sauce, topped with savory turkey bacon and parmesan.',
        ],
        [
            'Chicken Arrabiata',
            'Tender chicken, earthy mushrooms, and tangy tomatoes tossed with pasta in a flavourful herb-infused sauce.',
        ],
    ];
    const pastaItems: MenuItem[] = [];
    for (const [name, desc] of pastas) {
        const it = await mkItem({
            category: catPasta,
            name,
            description: desc,
            basePrice: 949,
        });
        await linkGroups(it, [grpAddParmesan, grpAddDrinks]);
        pastaItems.push(it);
    }

    // ——— CLASSIC SIDES ———
    await mkItem({
        category: catSides,
        name: 'Garlic Bread',
        description: 'Freshly baked 10" base topped with our famous garlic oil',
        basePrice: 699,
    });
    // Side/wrap toppings: flat extra meat Rs149 / veg Rs69. Beef Pepperoni and
    // Kebab were removed from this list in the new sheet.
    const grpSideToppings = await mkGroup(
        'Add Extra Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            ...SIDE_TOPPING_MEATS.map((m) => ({
                name: `Extra ${m}`,
                price: 149,
            })),
            ...VEGGIES.map((v) => ({ name: `Extra ${v}`, price: 69 })),
        ],
    );
    const cheesyGarlicBread = await mkItem({
        category: catSides,
        name: 'Cheesy Garlic Bread',
        description:
            'Freshly baked 10" base topped with our famous garlic oil and 100% mozzarella cheese',
        basePrice: 799,
    });
    await linkGroups(cheesyGarlicBread, [grpSideToppings]);
    const wedges = await mkItem({
        category: catSides,
        name: 'Homemade Potato Wedges',
        description:
            'Homemade British potato wedges with garlic, herbs and the option of parmesan cheese',
        basePrice: 499,
    });
    await linkGroups(wedges, [grpAddParmesan]);
    const grpBitesFlavour = await mkGroup(
        'Choose your Flavour',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'Chicken Tikka' },
            { name: 'Pepperoni' },
            { name: 'Jalapenos' },
            { name: 'Chicken Fajita' },
        ],
    );
    const bites = await mkItem({
        category: catSides,
        name: 'Fireaway Bites',
        description: '6 dough bites',
        basePrice: 999,
    });
    await linkGroups(bites, [grpBitesFlavour]);
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
    const grpDirtyCheese = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'As It Comes' }, { name: 'No Cheese' }],
    );
    const grpDirtyMeat = await mkGroup(
        'Choose your Meat',
        { minSelect: 0, maxSelect: 2, includedQuantity: 2 }, // 2 meats included
        MEATS.map((m) => ({ name: m })),
    );
    const dirtyFries = await mkItem({
        category: catSides,
        name: 'Create Your Dirty Fries',
        description: 'Chips with your choice of cheese and 2 meats',
        basePrice: 899,
    });
    await linkGroups(dirtyFries, [grpDirtyCheese, grpDirtyMeat]);

    // ——— WINGS & STRIPS ———
    // (Fireaway Special Salad withdrawn in the 2026 sheet → deactivated below.)
    const grpWingFlavour = await mkGroup(
        'Choose your Flavour',
        { minSelect: 1, maxSelect: 1 },
        WING_FLAVOURS.map((f) => ({ name: f })),
    );
    const wings = await mkItem({
        category: catWings,
        name: 'Chicken Wings',
        description: 'Crispy chicken wings smothered in a choice of 5 flavours',
        basePrice: 799,
        sizes: [
            { name: '5 Pcs', sizeKey: '5', price: 799, isDefault: true },
            { name: '10 Pcs', sizeKey: '10', price: 1499 },
        ],
    });
    await linkGroups(wings, [grpWingFlavour]);
    const strips = await mkItem({
        category: catWings,
        name: 'Crispy Chicken Strips',
        description:
            '100% chicken breast breaded with our own spice blend, available in a choice of 5 flavours',
        basePrice: 799,
        sizes: [
            { name: '5 Pcs', sizeKey: '5', price: 799, isDefault: true },
            { name: '10 Pcs', sizeKey: '10', price: 1499 },
        ],
    });
    await linkGroups(strips, [grpWingFlavour]);

    // ——— DIPS (standalone) ———
    const grpPick1Dip = await mkGroup(
        'Choose your dip',
        { minSelect: 1, maxSelect: 1 },
        DIPS.map((d) => ({ name: d })),
    );
    const grpPick2Dip = await mkGroup(
        'Choose 2 dips',
        { minSelect: 2, maxSelect: 2 },
        DIPS.map((d) => ({ name: d })),
    );
    const grpPick3Dip = await mkGroup(
        'Choose 3 dips',
        { minSelect: 3, maxSelect: 3 },
        DIPS.map((d) => ({ name: d })),
    );
    const single = await mkItem({
        category: catDips,
        name: 'Single Dip',
        description:
            'Choose from: Ranch, Garlic & Herb, BBQ, Sweet Chilli, Tomato Ketchup, Hot Peri-Peri',
        basePrice: 99,
    });
    await linkGroups(single, [grpPick1Dip]);
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

    // ——— FIREY WRAPS ———
    const grpRemoveFilling = await mkGroup(
        'Remove a filling',
        { minSelect: 0, maxSelect: 4 },
        ['Mixed Leaves', 'Onion', 'Peppers', 'Mayo'].map((f) => ({ name: f })),
    );
    // Free, but the same sauce can be added multiple times → allowQuantity.
    const grpAddSauce = await mkGroup(
        'Add a Sauce',
        { minSelect: 0, maxSelect: REPEAT_MAX, allowQuantity: true },
        ['Mayo', 'BBQ', 'Ketchup', 'Sweet Chilli'].map((s) => ({ name: s })),
    );
    // "Make it a meal" as a modifier group (not a flat addon) so the customer
    // picks WHICH drink. Client-communicated, never in any sheet.
    // Hidden inside deals (the deal supplies fries + drink via its own slots).
    const grpWrapMeal = await mkGroup(
        'Make it a Meal?',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'Wrap Only' },
            { name: 'Make it a Meal (Reg Fries + 345ml Drink)', price: 350 },
        ],
    );
    // Conditional drink chooser — only shown once the paid meal option is picked.
    const grpWrapMealDrink = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            ...SOFT_DRINKS.map((s) => ({ name: `${s} 345ml` })),
            { name: 'Water 500ml' },
            { name: 'Orange Juice 200ml' },
            { name: 'Mango Juice 200ml' },
            // Milkshakes are offered in every drink chooser at an extra price.
            ...MILKSHAKE_FLAVOURS.map((f) => ({
                name: `${f} Milkshake`,
                price: 250,
            })),
        ],
    );
    const wrapMealPaidIds = (
        await modifierRepo.find({ where: { modifierGroupId: grpWrapMeal.id } })
    )
        .filter((m) => Number(m.price) > 0)
        .map((m) => m.id);
    grpWrapMealDrink.visibleWhenModifierIds = wrapMealPaidIds;
    await groupRepo.save(grpWrapMealDrink);
    const wraps: Array<[string, string, number]> = [
        [
            'Chicken Tikka Wrap',
            'Chicken tikka, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Krunchy Chicken Wrap',
            'Krunchy chicken, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Peri Peri Chicken Wrap',
            'Peri peri chicken, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Chicken and Pepperoni Wrap',
            'Chicken & pepperoni, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Firey Special Wrap',
            'Chicken fajita, kebab, sausage, lettuce, onion, cucumber and mayo',
            649,
        ],
    ];
    let firySpecialWrap: MenuItem | null = null;
    for (const [name, desc, price] of wraps) {
        const it = await mkItem({
            category: catWraps,
            name,
            description: desc,
            basePrice: price,
        });
        await linkGroups(it, [
            grpRemoveFilling,
            grpAddSauce,
            grpSideToppings,
            grpWrapMeal,
            grpWrapMealDrink,
        ]);
        if (name === 'Firey Special Wrap') firySpecialWrap = it;
    }

    // ——— DESSERTS ———
    const grpChocCrust = await mkGroup(
        'Crust',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Thin Crust' }, { name: 'Regular' }],
    );
    // "Bananas" dropped in the 2026 sheet.
    const grpChocToppings = await mkGroup(
        'Additional Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            { name: 'Chopped Nuts', price: 149 },
            { name: 'Marshmallows', price: 149 },
            { name: 'Crushed Oreos', price: 149 },
            { name: 'Crushed Lotus Biscoff', price: 149 },
        ],
    );
    const chocPizza = await mkItem({
        category: catDesserts,
        name: 'Chocolate Pizza',
        description:
            'Freshly baked 9" pizza base topped with creamy chocolate and icing sugar, and if you dare, loaded with toppings of your choice.',
        basePrice: 999,
    });
    await linkGroups(chocPizza, [grpChocCrust, grpChocToppings]);
    const grpCookieFlavour = await mkGroup(
        'Choose Your Flavour',
        { minSelect: 1, maxSelect: 1 },
        [
            'Chocolate Hazelnut',
            'Classic Cookie',
            'Kunaffa Cookie',
            'Lotus Cookie',
            'Red Velvet',
        ].map((f) => ({ name: f })),
    );
    const cookie = await mkItem({
        category: catDesserts,
        name: 'Homemade Cookie',
        description: 'Choose from our special flavours',
        basePrice: 350,
    });
    await linkGroups(cookie, [grpCookieFlavour]);
    // Brownie lost its spread choice in the 2026 sheet; dough balls keep it.
    const brownie = await mkItem({
        category: catDesserts,
        name: 'Chocolate Brownie',
        description: 'Chocolate brownie with chocolate spread (1 per portion)',
        basePrice: 299,
    });
    await linkGroups(brownie, []);
    const grpSpread = await mkGroup(
        'Choose Your Flavour',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'With Chocolate Spread' },
            { name: 'Without Chocolate Spread' },
        ],
    );
    const doughBalls = await mkItem({
        category: catDesserts,
        name: 'Chocolate Dough Balls',
        description: 'Fireaway special 6 chocolate dough balls',
        basePrice: 899,
    });
    await linkGroups(doughBalls, [grpSpread]);
    const grpDoughnutFlavour = await mkGroup(
        'Choose Your Flavour',
        { minSelect: 1, maxSelect: 1 },
        [
            'Plain Glazed',
            'Double Chocolate',
            'Cotton Candy',
            'Lotus',
            'Nutella',
            'Ferrero Rocher',
        ].map((f) => ({ name: f })),
    );
    const doughnut = await mkItem({
        category: catDesserts,
        name: 'Doughnut',
        description: 'Our special selection of doughnuts',
        basePrice: 250,
    });
    await linkGroups(doughnut, [grpDoughnutFlavour]);

    // ——— MILKSHAKES (Rs499 each) ———
    const shakeItems: MenuItem[] = [];
    for (const s of MILKSHAKE_FLAVOURS) {
        shakeItems.push(
            await mkItem({
                category: catShakes,
                name: `${s} Milkshake`,
                description:
                    'Freshly made luscious milkshake with real fresh ingredients',
                basePrice: 499,
            }),
        );
    }

    // ——— DRINKS (standalone) ———
    // The sheet's "1 L / 1.5 L - all above options" applies every flavour to
    // those sizes. The 200ml juices are no longer sold standalone — they
    // survive only inside the Kids Meal juice chooser.
    const SOFT_DRINK_SIZES: Array<[string, number]> = [
        ['345ml', 130],
        ['1L', 199],
        ['1.5L', 249],
    ];
    for (const flavour of SOFT_DRINKS) {
        for (const [size, price] of SOFT_DRINK_SIZES) {
            await mkItem({
                category: catDrinks,
                name: `${flavour} ${size}`,
                basePrice: price,
            });
        }
    }
    await mkItem({ category: catDrinks, name: 'Water 500ml', basePrice: 75 });

    // Deal-only 250ml drinks (lunch-deal drink slots; hidden from the menu).
    const deal250Drinks: MenuItem[] = [];
    for (const n of DEAL_250ML) {
        deal250Drinks.push(
            await mkItem({
                category: catDrinks,
                name: n,
                basePrice: 0,
                dealOnly: true,
            }),
        );
    }
    const deal345Drinks = await itemRepo.find({
        where: { brandId, name: In(SOFT_DRINKS.map((f) => `${f} 345ml`)) },
    });
    const deal1LDrinks = await itemRepo.find({
        where: { brandId, name: In(SOFT_DRINKS.map((f) => `${f} 1L`)) },
    });

    // ===================================================================
    // DEALS  (deal = MenuItem in "Deals" category + deal_components)
    // ===================================================================
    const mkDeal = async (opts: {
        name: string;
        description: string;
        price: number;
        lunch?: boolean;
        /** Sheet: "FIREAWAY APP & E-Pos ONLY" → sellable on POS + own app only. */
        appAndPosOnly?: boolean;
        pricingMode?: string | null;
        bogoBuyQuantity?: number | null;
        bogoGetQuantity?: number | null;
        bogoGetPercent?: number | null;
        slots: Array<{
            type: 'fixed' | 'choice_category' | 'choice_list';
            sourceMenuItemId?: number | null;
            sourceCategoryId?: number | null;
            sourceMenuItemIds?: number[] | null;
            quantity?: number;
            allowCustomization?: boolean;
            slotSurcharges?: Record<string, number> | null;
            slotSizeKey?: string | null;
            allowedSizeKeys?: string[] | null;
            mirrorSlotIndex?: number | null;
            mirrorMatchSize?: boolean;
            mirrorMatchCategory?: boolean;
        }>;
    }) => {
        const deal = await mkItem({
            category: catDeals,
            name: opts.name,
            description: opts.description,
            basePrice: opts.price,
            channels: opts.lunch ? COLLECTION_ONLY : null,
            availableChannels: opts.appAndPosOnly ? ['pos', 'app'] : null,
            availableTimeStart: opts.lunch ? LUNCH_START : null,
            availableTimeEnd: opts.lunch ? LUNCH_END : null,
            availableDaysOfWeek: opts.lunch ? LUNCH_DAYS : null,
            dealPricingMode: opts.pricingMode ?? null,
            dealBogoBuyQuantity: opts.bogoBuyQuantity ?? null,
            dealBogoGetQuantity: opts.bogoGetQuantity ?? null,
            dealBogoGetPercent: opts.bogoGetPercent ?? null,
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
                    allowCustomization: s.allowCustomization ?? true,
                    slotSurcharges: s.slotSurcharges ?? null,
                    slotSizeKey: s.slotSizeKey ?? null,
                    allowedSizeKeys: s.allowedSizeKeys ?? null,
                    mirrorSlotIndex: s.mirrorSlotIndex ?? null,
                    mirrorMatchSize: s.mirrorMatchSize ?? false,
                    mirrorMatchCategory: s.mirrorMatchCategory ?? false,
                }),
            );
        }
        return deal;
    };

    const drink250Ids = deal250Drinks.map((d) => d.id);
    const drink345Ids = deal345Drinks.map((d) => d.id);
    const drink1LIds = deal1LDrinks.map((d) => d.id);
    // Every deal drink chooser also offers the milkshakes at +Rs250.
    const shakeItemIds = shakeItems.map((it) => it.id);
    const shakeUpgradeSurcharges = Object.fromEntries(
        shakeItemIds.map((id) => [String(id), 250]),
    );

    // Classic Lunch Feast Offer — any 12" Classic pizza for Rs999.
    await mkDeal({
        name: 'Classic Lunch Feast Offer',
        appAndPosOnly: true, // sheet: "FIREAWAY APP & E-Pos ONLY"
        description:
            'Any Large 12" Classic pizza for only Rs 999! Monday–Friday 12–4pm.',
        price: 999,
        lunch: true,
        slots: [
            {
                // "All 12\" Classic Pizza options" — Classic pizzas only.
                type: 'choice_list',
                sourceMenuItemIds: classicPizzas.map((p) => p.id),
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: SIZE,
            },
        ],
    });

    // Power Lunch Offer — a 12" build-your-own pizza (base + cheese + 2 free
    // toppings) OR a pasta, flat Rs899. The à-la-carte BYO item is not reused:
    // its meat/veg groups include 3 free each plus charged extras, well beyond
    // the deal's "2 toppings" grant.
    const byoLunchDeal = await mkItem({
        category: catBYO,
        name: 'Build Your Own Pizza (Lunch Deal)',
        description:
            'Your 12" pizza, built your way: choose a base, cheese and 2 toppings.',
        basePrice: PRICE_BYO,
        sizes: large12(PRICE_BYO),
        dealOnly: true, // used only inside this deal — hidden from the menu
    });
    await linkGroups(byoLunchDeal, [
        grpCrust,
        grpBase,
        grpCheeseBYO, // Extra Cheese still charged (client-confirmed)
        grpDealToppings, // 2 included, any/same twice, no charged extras
    ]);
    await mkDeal({
        name: 'Power Lunch Offer',
        appAndPosOnly: true, // sheet: "FIREAWAY APP & E-Pos ONLY"
        description:
            'A 12" build-your-own pizza (base, cheese & 2 toppings) or a pasta for only Rs 899. Monday–Friday 12–4pm.',
        price: 899,
        lunch: true,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: [
                    byoLunchDeal.id,
                    ...pastaItems.map((p) => p.id),
                ],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: SIZE, // pizza pins to 12"; pasta is sizeless (no-op)
            },
        ],
    });

    // Fireaway Wrap & Roll Lunch Deal — any wrap + 250ml drink Rs549;
    // upgrade to Firey Special +Rs100.
    await mkDeal({
        name: 'Fireaway Wrap & Roll Lunch Deal',
        appAndPosOnly: true, // sheet: "FIREAWAY APP & E-Pos ONLY"
        description:
            'Choose any wrap and a 250ml drink for Rs 549 (upgrade to Firey Special wrap for +Rs 100). Monday–Friday 12–4pm.',
        price: 549,
        lunch: true,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catWraps.id,
                quantity: 1,
                allowCustomization: true,
                slotSurcharges: firySpecialWrap
                    ? { [String(firySpecialWrap.id)]: 100 }
                    : null,
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: [...drink250Ids, ...shakeItemIds],
                quantity: 1,
                allowCustomization: false,
                slotSurcharges: shakeUpgradeSurcharges,
            },
        ],
    });

    // Snack Attack Rs1299 — Cheesy Garlic Bread (auto) + 5 wings or strips + 2 dips.
    await mkDeal({
        name: 'Snack Attack',
        description:
            '1 Cheesy Garlic Bread, 1 portion of 5 pcs chicken wings or strips, and 2 dips.',
        price: 1299,
        slots: [
            {
                type: 'fixed',
                sourceMenuItemId: cheesyGarlicBread.id,
                quantity: 1,
                allowCustomization: true,
            },
            {
                // "5 pcs chicken wings or strips" — lock to the 5-piece variant.
                type: 'choice_list',
                sourceMenuItemIds: [wings.id, strips.id],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '5',
            },
            {
                type: 'fixed',
                sourceMenuItemId: twoDips.id,
                quantity: 1,
                allowCustomization: true,
            },
        ],
    });

    // Family Feast Deal Rs1899 — any 12" pizza + 1L drink.
    await mkDeal({
        name: 'Family Feast Deal',
        description:
            '1 any Large 12" Classic or Signature pizza, 1 soft drink (1L).',
        price: 1899,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPizza.id,
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: SIZE,
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: [...drink1LIds, ...shakeItemIds],
                quantity: 1,
                allowCustomization: false,
                slotSurcharges: shakeUpgradeSurcharges,
            },
        ],
    });

    // Firestarter for 2 Rs2499 — 12" pizza + (garlic bread or 5 wings or 5
    // strips) + 2 × 345ml.
    await mkDeal({
        name: 'Firestarter for 2',
        description:
            '1 any Large Classic or Signature pizza, 1 Cheesy Garlic Bread or 5 wings or 5 strips, and 2 soft drinks (345ml).',
        price: 2499,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPizza.id,
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: SIZE,
            },
            {
                // Garlic bread has no size variants, so the 5-pc lock is a no-op for it.
                type: 'choice_list',
                sourceMenuItemIds: [cheesyGarlicBread.id, wings.id, strips.id],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '5',
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: [...drink345Ids, ...shakeItemIds],
                quantity: 2,
                allowCustomization: false,
                slotSurcharges: shakeUpgradeSurcharges,
            },
        ],
    });

    // Pasta Combo Rs1049 — 1 pasta + 345ml drink.
    await mkDeal({
        name: 'Pasta Combo',
        description: '1 pasta and 1 soft drink (345ml).',
        price: 1049,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPasta.id,
                quantity: 1,
                allowCustomization: true,
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: [...drink345Ids, ...shakeItemIds],
                quantity: 1,
                allowCustomization: false,
                slotSurcharges: shakeUpgradeSurcharges,
            },
        ],
    });

    // Pasta Deluxe Special Rs1449 (was Rs1499) — pasta + cheesy garlic bread + 345ml.
    await mkDeal({
        name: 'Pasta Deluxe Special',
        description:
            '1 pasta, 1 Cheesy Garlic Bread, and 1 soft drink (345ml).',
        price: 1449,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPasta.id,
                quantity: 1,
                allowCustomization: true,
            },
            {
                type: 'fixed',
                sourceMenuItemId: cheesyGarlicBread.id,
                quantity: 1,
                allowCustomization: true,
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: [...drink345Ids, ...shakeItemIds],
                quantity: 1,
                allowCustomization: false,
                slotSurcharges: shakeUpgradeSurcharges,
            },
        ],
    });

    // Heaven Treat for 2 Rs2699 — 12" pizza + chocolate pizza + 2 × 345ml.
    await mkDeal({
        name: 'Heaven Treat for 2',
        description:
            '1 any Large Classic or Signature pizza, 1 Chocolate Pizza, and 2 soft drinks (345ml).',
        price: 2699,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPizza.id,
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: SIZE,
            },
            {
                type: 'fixed',
                sourceMenuItemId: chocPizza.id,
                quantity: 1,
                allowCustomization: true,
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: [...drink345Ids, ...shakeItemIds],
                quantity: 2,
                allowCustomization: false,
                slotSurcharges: shakeUpgradeSurcharges,
            },
        ],
    });

    // ===================================================================
    // BUY ONE GET ONE HALF PRICE — a self-contained DEAL (not a discount).
    // ===================================================================
    // Modeled as a deal so it NEVER bleeds onto other deals: the half-price is
    // computed inside the deal's own two pizza slots, not by the order-wide
    // discount engine. Dynamic pricing: full price of pizza 1 + the CHEAPER
    // pizza at 50% off. The 2nd pizza must be the SAME (strict) CATEGORY as the
    // 1st — Classic↔Classic, Signature↔Signature, BYO↔BYO. Large 12" only.
    const bogoPizzaIds = [
        ...classicPizzas.map((p) => p.id), // includes Margherita (label 'Classic')
        ...signaturePizzas.map((p) => p.id),
        byo.id,
    ];
    await mkDeal({
        name: 'Buy One Get One Half Price',
        appAndPosOnly: true, // sheet: "FIREAWAY APP & E-Pos ONLY"
        description:
            'Buy any Large 12" pizza and get a 2nd Large 12" pizza of the same category (Classic, Signature or Build Your Own) at HALF PRICE. Available all day, every day.',
        price: 0, // dynamic — computed from the two chosen pizzas at order time
        pricingMode: 'bogo',
        bogoBuyQuantity: 1,
        bogoGetQuantity: 1,
        bogoGetPercent: 50,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: bogoPizzaIds,
                quantity: 1,
                allowCustomization: true,
                allowedSizeKeys: [SIZE],
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: bogoPizzaIds,
                quantity: 1,
                allowCustomization: true,
                allowedSizeKeys: [SIZE],
                mirrorSlotIndex: 0,
                mirrorMatchSize: true,
                mirrorMatchCategory: true,
            },
        ],
    });

    // ===================================================================
    // WITHDRAW what is no longer on the menu — deactivate, never delete.
    // ===================================================================
    const retiredItems = await itemRepo.find({ where: { brandId } });
    const retired: string[] = [];
    for (const it of retiredItems) {
        if (touchedItems.has(it.id)) continue;
        if (!it.isActive) continue;
        it.isActive = false;
        await itemRepo.save(it);
        retired.push(it.name);
    }
    const retiredCats = await categoryRepo.find({ where: { brandId } });
    const retiredCatNames: string[] = [];
    for (const c of retiredCats) {
        if (touchedCategories.has(c.id)) continue;
        if (!c.isActive) continue;
        c.isActive = false;
        await categoryRepo.save(c);
        retiredCatNames.push(c.name);
    }
    const retiredAddons = await addonRepo.find({ where: { brandId } });
    const retiredAddonNames: string[] = [];
    for (const a of retiredAddons) {
        if (touchedAddons.has(a.id)) continue;
        if (!a.isActive) continue;
        a.isActive = false;
        await addonRepo.save(a);
        retiredAddonNames.push(a.name);
    }

    // ——— Make every active item available at the brand's branches ———
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

    console.log('');
    console.log('Fireaway 2026 menu seeded (non-destructive).');
    console.log(
        `  active: ${touchedItems.size} items across ${touchedCategories.size} categories, ` +
            `${touchedAddons.size} addon(s)`,
    );
    console.log(
        `  branches linked: ${branches.length} (${bmiCreated} new branch_menu_items row(s))`,
    );
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
