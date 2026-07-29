/**
 * Seed: Peri Peri Co / "Peperico" (Pakistan) menu — 2026 refresh.
 *
 * Source: "new updated menu/Foodies Master Menu Peperico.xlsx" → sheet
 * "Peperico (App & EPOS)", plus the client answers recorded below.
 *
 * This file REPLACES seed-peri-peri-co-real.ts as the current menu definition.
 * seed-peri-peri-co-real.ts is left untouched as the historical (pre-2026)
 * record.
 *
 * NOTE on the workbook: that .xlsx is a copy of the Fireaway master template;
 * ONLY sheet "Peperico (App & EPOS)" (Country: Pakistan, Rs prices) is real
 * Peri Peri Co content. Every other sheet is leftover Fireaway pizza data.
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
 * rebuild would destroy them). Override with PEPERICO_SEED_FORCE=1.
 *
 * Modifier-group names are NOT unique per brand, and must not be made unique:
 * the name is the heading the customer sees in the customize modal, and this
 * seeder rebuilds every group each run, so duplicates cost nothing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED vs the previous menu
 * ───────────────────────────────────────────────────────────────────────────
 *  1. Coca-Cola range → Pepsi range (Pepsi, Diet Pepsi, 7up, Mirinda,
 *     Mountain Dew). Water 500ml and Juice 200ml both stay — unlike Fireaway,
 *     Peperico keeps its juice.
 *  2. Milkshakes cut 11 → 6 (the flavours listed in the new sheet).
 *  3. Pasta & Rice repriced Rs 949 → Rs 999 (both items).
 *  4. Deal withdrawn: "Peri Peri Burger Meal" Rs 999.
 *  5. Item withdrawn: "Peperico Special Salad" Rs 799 (and its meat / veggie /
 *     conditional-flavour groups).
 *  6. Cookie flavours (Homemade Cookie AND Cookie and Cream): Chocolate
 *     Cookies / Triple Chocolate / Pistachio → Chocolate Hazelnut / Classic
 *     Cookies / Kunafa. Lotus and Red Velvet stay.
 *  7. Doughnut flavours: −Boston Cream, Oreo, Plain Chocolate;
 *     +Cotton Candy, Double Chocolate.
 *  8. Chocolate Brownie lost its With/Without Chocolate Spread choice.
 *
 * Client answers driving two judgement calls:
 *  - "Peri Peri Meal for 2" appears in the new sheet with its five peri peri
 *    flavours blanked to 0. That was collateral from deleting the rows of the
 *    withdrawn "Peri Peri Burger Meal" above it — client confirmed
 *    "restore 5 flavours", so the flavour choice is kept.
 *  - "1/4 Peri Peri Chicken with 1 Classic Side" was found in the dev DB
 *    restricted to available_for_order_types = ["dine_in"]. Client confirmed
 *    "it was also a test edit", so this seeder resets it to all channels.
 *
 * The category is still called "Wings, Strips & Salads" — the new sheet keeps
 * that heading even though the salad itself is withdrawn.
 *
 * Carried over from the old seeder (client-communicated, never in any sheet):
 * the two "Make it a Meal?" models + their conditional meal-drink choosers,
 * the paid "Add a Drink(s)" cross-sell, the deal-only Large / Large Peri Peri
 * Fries used for in-deal fries upgrades, and the Kids Meal burger-or-nuggets
 * and juice choosers.
 *
 * Run: npm run seed:peperico-2026   (requires `npm run seed` first)
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

const BRAND_SLUG = 'peperi-co';
const BRAND_NAME = 'Peperi. Co';

// ——— Shared option lists (straight from the sheet) ———
const FLAVOURS = [
    'Mild Peri Peri',
    'Medium Peri Peri',
    'Hot Peri Peri',
    'Mango and Lime',
    'Lemon and Herbs',
];
const SODAS = ['Pepsi', 'Diet Pepsi', '7up', 'Mirinda', 'Mountain Dew'];
const MILKSHAKES = [
    'Oreo',
    'Nutella',
    'Lotus Biscoff',
    'Strawberry',
    'Chocolate',
    'Pistachio',
];
const MILKSHAKE_UPGRADE = 250; // "Upgrade to any milkshake - Add Rs 250"
const MEAL_DRINK_345 = 130; // a-la-carte 345ml soda price
const PASTA_RICE_PRICE = 999; // was Rs 949

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
    'Orange Cream',
    'Red Velvet',
];

// Applied before anything else so the row (and its id / order history) survives.
// Nothing was renamed in the 2026 refresh — kept for future refreshes.
const RENAMED_CATEGORIES: Array<[string, string]> = [];
const RENAMED_ITEMS: Array<[string, string]> = [];

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
                description:
                    'Flame-grilled peri peri chicken, smashed burgers & more.',
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
    if (recipeRefs > 0 && process.env.PEPERICO_SEED_FORCE !== '1') {
        console.error(
            `ABORTING: ${recipeRefs} recipe row(s) reference this brand's modifiers/variants.\n` +
                `Rebuilding them would cascade-delete those recipes. Review them first, then\n` +
                `re-run with PEPERICO_SEED_FORCE=1 if you accept the loss.`,
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
        label?: string | null;
        channels?: string[] | null;
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
        item.label = opts.label ?? null;
        // Reset explicitly — clears the dine_in-only test edit found on the
        // 1/4 Peri Peri Chicken platter (client confirmed it was a test).
        item.availableForOrderTypes = opts.channels ?? null;
        item.availableTimeStart = null;
        item.availableTimeEnd = null;
        item.availableDaysOfWeek = null;
        // Allergens & calories columns are present but BLANK in the sheet → left null.
        item.allergens = null;
        item.calories = null;
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

    type ModDef = { name: string; price?: number };
    const mkGroup = async (
        name: string,
        cfg: {
            minSelect?: number;
            maxSelect?: number;
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

    // ===================================================================
    // SHARED MODIFIER GROUPS
    // ===================================================================
    // Peri peri flavour — one-of-five, required. Reused on every chicken-based item.
    const grpFlavour = await mkGroup(
        'Choose your Flavour',
        { minSelect: 1, maxSelect: 1 },
        FLAVOURS.map((f) => ({ name: f })),
    );

    // Cheese: With / Without (both free) / Extra (+100). Required single choice.
    const grpCheese = await mkGroup(
        'Cheese Option',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'With Cheese' },
            { name: 'Without Cheese' },
            { name: 'Extra Cheese', price: 100 },
        ],
    );

    // Meat multipliers — four variants by surcharge ladder (from the sheet).
    const grpMeatChicken = await mkGroup(
        'Meat',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'Single Meat (as it comes)' },
            { name: 'Double Meat', price: 200 },
            { name: 'Triple Meat', price: 400 },
        ],
    );
    const grpMeatBeef = await mkGroup('Meat', { minSelect: 1, maxSelect: 1 }, [
        { name: 'Single Meat (as it comes)' },
        { name: 'Double Meat', price: 250 },
        { name: 'Triple Meat', price: 500 },
    ]);
    // Crispy chicken burgers: paid extra fillet (client-confirmed +200/+400).
    const grpMeatCrispy = await mkGroup(
        'Meat',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'As it comes' },
            { name: 'Add Extra Crispy Fillet', price: 200 },
            { name: 'Add 2 Extra Crispy Fillets', price: 400 },
        ],
    );
    const grpMeatPatty = await mkGroup('Meat', { minSelect: 1, maxSelect: 1 }, [
        { name: 'As it comes' },
        { name: 'Add Extra single patty', price: 250 },
        { name: 'Add Extra 2 patties', price: 500 },
    ]);

    // Sauce groups — up to 2 (free). Same picks, different "as it comes" default per burger family.
    const grpSaucePeri = await mkGroup(
        'Sauce Options (choose up to 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Peri Peri Mayo',
            'Chipotle',
            'BBQ',
            'Sweet Chilli',
            'Garlic Mayo',
        ].map((s) => ({ name: s })),
    );
    const grpSauceSecret = await mkGroup(
        'Sauce Options (choose up to 2)',
        { minSelect: 0, maxSelect: 2 },
        ['Secret Sauce', 'Garlic Mayo', 'BBQ', 'Sweet Chilli', 'Chipotle'].map(
            (s) => ({ name: s }),
        ),
    );
    const grpSauceCrispy = await mkGroup(
        'Sauce Options (choose up to 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Secret Burger Sauce',
            'Garlic Mayo',
            'BBQ',
            'Sweet Chilli',
            'Chipotle',
        ].map((s) => ({ name: s })),
    );
    const grpSauceMustard = await mkGroup(
        'Sauce Options (choose up to 2)',
        { minSelect: 0, maxSelect: 2 },
        ['Mustard Sauce', 'Garlic Mayo', 'BBQ', 'Sweet Chilli', 'Chipotle'].map(
            (s) => ({ name: s }),
        ),
    );

    // Salad groups — all free, multi-choice. "Remove" (item comes loaded) vs "Add" (item comes plain).
    const saladRemoveLTOJ = await mkGroup(
        'Salad Options',
        { minSelect: 0, maxSelect: 4 },
        [
            'Remove Lettuce',
            'Remove Tomato',
            'Remove Onion',
            'Remove Jalapenos',
        ].map((s) => ({ name: s })),
    );
    const saladAddLTOJ = await mkGroup(
        'Salad Options',
        { minSelect: 0, maxSelect: 4 },
        ['Add Lettuce', 'Add Tomato', 'Add Onion', 'Add Jalapenos'].map(
            (s) => ({
                name: s,
            }),
        ),
    );
    const saladRemovePine = await mkGroup(
        'Salad Options',
        { minSelect: 0, maxSelect: 4 },
        [
            'Remove Lettuce',
            'Remove Tomato',
            'Remove Onion',
            'Remove Pineapple',
        ].map((s) => ({ name: s })),
    );
    const saladRemovePickle = await mkGroup(
        'Salad Options',
        { minSelect: 0, maxSelect: 4 },
        [
            'Remove Lettuce',
            'Remove Tomato',
            'Remove Onion',
            'Remove Pickle',
        ].map((s) => ({ name: s })),
    );
    const saladRemoveSupreme = await mkGroup(
        'Salad Options',
        { minSelect: 0, maxSelect: 4 },
        [
            'Remove Onion',
            'Remove Mushroom',
            'Remove Pickle',
            'Remove Pineapple',
        ].map((s) => ({ name: s })),
    );
    const saladAddCrispy = await mkGroup(
        'Salad Options',
        { minSelect: 0, maxSelect: 5 },
        [
            'Add Lettuce',
            'Add Tomato',
            'Add Onion',
            'Add Jalapenos',
            'Add Pickle',
        ].map((s) => ({ name: s })),
    );

    // "Make it a Meal?" for burgers — mutually-exclusive priced meal variants. Hidden inside deals
    // (the deal supplies fries + drink through its own slots).
    const grpBurgerMeal = await mkGroup(
        'Make it a Meal?',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'Burger Only' },
            { name: 'Meal with Drink', price: 130 },
            { name: 'Meal (Fries + Drink)', price: 350 },
            { name: 'Meal (Spicy Fries + Drink)', price: 380 },
        ],
    );
    // Drink chooser that ITEMISES the meal's included drink. Soda = free (covered by the meal
    // upgrade above); any milkshake = +Rs250 ("upgrade to any milkshake"). Required once a paid
    // meal option is picked (min 1). Hidden inside deals. Used by burgers.
    const grpMealDrinkShake = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            ...SODAS.map((s) => ({ name: `${s} 345ml` })),
            ...MILKSHAKES.map((m) => ({
                name: `${m} Milkshake`,
                price: MILKSHAKE_UPGRADE,
            })),
        ],
    );
    // "Make it a Meal +Rs350" for chicken & wraps (Reg Fries + 345ml drink).
    const grpSimpleMeal = await mkGroup(
        'Make it a Meal?',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'On its Own' },
            { name: 'Make it a Meal (Reg Fries + 345ml Drink)', price: 350 },
        ],
    );
    const grpMealDrinkSoda = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            ...SODAS.map((s) => ({ name: `${s} 345ml` })),
            ...MILKSHAKES.map((m) => ({
                name: `${m} Milkshake`,
                price: MILKSHAKE_UPGRADE,
            })),
        ],
    );

    // Conditional visibility: the meal-drink chooser only appears once a PAID "Make it a Meal?"
    // option is selected (not "Burger Only" / "On its Own").
    const paidModifierIds = async (group: ModifierGroup): Promise<number[]> => {
        const mods = await modifierRepo.find({
            where: { modifierGroupId: group.id },
        });
        return mods.filter((m) => Number(m.price) > 0).map((m) => m.id);
    };
    grpMealDrinkShake.visibleWhenModifierIds =
        await paidModifierIds(grpBurgerMeal);
    await groupRepo.save(grpMealDrinkShake);
    grpMealDrinkSoda.visibleWhenModifierIds =
        await paidModifierIds(grpSimpleMeal);
    await groupRepo.save(grpMealDrinkSoda);

    // Paid drink cross-sell (pasta/rice) — drink NOT included; charged at full price, repeatable.
    // Hidden inside deals: the Chicken & Rice deal supplies its included drink through its own
    // slot, so this paid chooser must not show up next to it.
    const grpAddDrinksPaid = await mkGroup(
        'Add a Drink(s)',
        { minSelect: 0, maxSelect: 12, allowQuantity: true, hideInDeals: true },
        [
            ...SODAS.map((s) => ({ name: `${s} 345ml`, price: 130 })),
            { name: 'Water 500ml', price: 75 },
            { name: 'Juice 200ml', price: 75 },
            ...SODAS.map((s) => ({ name: `${s} 1L`, price: 199 })),
            ...SODAS.map((s) => ({ name: `${s} 1.5L`, price: 249 })),
            ...MILKSHAKES.map((m) => ({ name: `${m} Milkshake`, price: 499 })),
        ],
    );

    // Boneless box sauces (deal only) — up to 2, free.
    const grpBoxSauce = await mkGroup(
        'Choose Sauce (up to 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Secret Burger Sauce',
            'Garlic Mayo',
            'BBQ',
            'Sweet Chilli',
            'Chipotle',
        ].map((s) => ({ name: s })),
    );

    // Wrap fillings (free, removable) + wrap sauce (free, add/change).
    const grpWrapRemove = await mkGroup(
        'Remove a Filling',
        { minSelect: 0, maxSelect: 3 },
        ['Lettuce', 'Onion', 'Cucumber'].map((s) => ({ name: s })),
    );
    const grpWrapSauce = await mkGroup(
        'Add a Sauce',
        { minSelect: 0, maxSelect: 5, allowQuantity: true },
        [
            'Garlic Mayo',
            'Burger Sauce',
            'Chipotle',
            'Sweet Chilli',
            'Peri Peri Mayo',
        ].map((s) => ({ name: s })),
    );

    // ===================================================================
    // CATEGORIES
    // ===================================================================
    const catDeals = await mkCategory('Deals');
    const catChicken = await mkCategory(
        'Peri Peri Chicken',
        'Our famous juicy grill chicken with secret herbs & a special blend of sauces',
    );
    const catBurgers = await mkCategory('Burgers');
    const catWraps = await mkCategory(
        'Firey Wraps',
        'All wraps come with lettuce, onion, cucumber and mayo',
    );
    // The salad is withdrawn but the sheet keeps this category heading.
    const catWings = await mkCategory('Wings, Strips & Salads');
    const catPasta = await mkCategory('Pasta & Rice');
    const catSides = await mkCategory('Classic Sides');
    const catSpecialSides = await mkCategory('Special Sides');
    const catDips = await mkCategory('Dips');
    const catKids = await mkCategory('Kids Meals');
    const catDesserts = await mkCategory('Desserts');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    // ===================================================================
    // PERI PERI CHICKEN (à la carte)
    // ===================================================================
    const chickenDesc =
        'Our famous juicy grill chicken with secret herbs & special blend of sauces';
    const chickenGroups = [grpFlavour, grpSimpleMeal, grpMealDrinkSoda];
    const chickenQuarter = await mkItem({
        category: catChicken,
        name: '1/4 Peri Peri Chicken',
        description: chickenDesc,
        basePrice: 699,
    });
    await linkGroups(chickenQuarter, chickenGroups);
    const chickenHalf = await mkItem({
        category: catChicken,
        name: '1/2 Peri Peri Chicken',
        description: chickenDesc,
        basePrice: 1299,
    });
    await linkGroups(chickenHalf, chickenGroups);
    const chickenFull = await mkItem({
        category: catChicken,
        name: 'Full Peri Peri Chicken',
        description: chickenDesc,
        basePrice: 2499,
    });
    await linkGroups(chickenFull, chickenGroups);

    // ===================================================================
    // BURGERS (à la carte)
    // ===================================================================
    const mkBurger = async (
        name: string,
        price: number,
        description: string,
        intrinsic: ModifierGroup[],
    ) => {
        const it = await mkItem({
            category: catBurgers,
            name,
            description,
            basePrice: price,
        });
        await linkGroups(it, [...intrinsic, grpBurgerMeal, grpMealDrinkShake]);
        return it;
    };

    // — Peri peri chicken burger —
    // Keeps its flavour group: the new sheet blanked the flavour cells only as
    // collateral from deleting the withdrawn Peri Peri Burger Meal rows.
    const periBurger = await mkBurger(
        'Peperico Special Burger',
        649,
        'Special blend of peri peri grilled chicken burger with lettuce, tomatoes, onion, jalapenos and peri peri mayo',
        [grpFlavour, grpMeatChicken, grpCheese, saladRemoveLTOJ, grpSaucePeri],
    );

    // — Beef smashed —
    await mkBurger(
        'Smashed Classic',
        899,
        '5oz juicy beef and a cheese slice with our special secret grill sauce',
        [grpCheese, grpMeatBeef, saladAddLTOJ, grpSauceSecret],
    );
    const wildMushroom = await mkBurger(
        'Wild Mushroom Smashed',
        999,
        'Smashed beef with wild mushrooms and sauteed onions, a choice of cheese and our special grill sauce',
        [grpCheese, grpMeatBeef, saladAddLTOJ, grpSauceSecret],
    );
    await mkBurger(
        'California Smash',
        1199,
        '2 perfectly smashed grilled beef patties with double cheese, double onion and double sauce',
        [grpCheese, grpMeatPatty, saladAddLTOJ, grpSauceSecret],
    );
    await mkBurger(
        'Saucy Pine Smashed',
        999,
        'A perfectly grilled pineapple with smashed beef, lettuce, fresh onions, tomato and our secret grill sauce',
        [grpCheese, grpMeatBeef, saladRemovePine, grpSauceSecret],
    );
    const oldGold = await mkBurger(
        'Old & Gold Smashed',
        899,
        'Perfectly smashed beef & cheese with fresh lettuce, fresh onions, tomato, pickle and our secret grill sauce',
        [grpCheese, grpMeatBeef, saladRemovePickle, grpSauceSecret],
    );

    // — Crispy chicken burgers (no flavour, no meat multiplier) —
    const crispyBurgers: MenuItem[] = [];
    crispyBurgers.push(
        await mkBurger(
            'Crispy Blaze',
            549,
            'Our best fried chicken with fresh iceberg lettuce and mayo',
            [grpCheese, grpMeatCrispy, saladAddCrispy, grpSauceCrispy],
        ),
    );
    crispyBurgers.push(
        await mkBurger(
            'Spicey Sizzler',
            549,
            'Our special spicy fried chicken with iceberg lettuce and our secret burger sauce',
            [grpCheese, grpMeatCrispy, saladAddCrispy, grpSauceCrispy],
        ),
    );
    crispyBurgers.push(
        await mkBurger(
            'Crisp Tower',
            749,
            'Double the crisp with fresh lettuce and mayo',
            [grpCheese, grpMeatCrispy, saladAddCrispy, grpSauceCrispy],
        ),
    );
    crispyBurgers.push(
        await mkBurger(
            'Sizzler Tower',
            749,
            'Double sizzler with fresh lettuce and our secret burger sauce',
            [grpCheese, grpMeatCrispy, saladAddCrispy, grpSauceCrispy],
        ),
    );
    crispyBurgers.push(
        // Snap Chick: sheet explicitly says "NO EXTRA SALAD OPTION" → no salad group.
        await mkBurger(
            'Snap Chick',
            299,
            'Crispy chicken with lettuce and mayo',
            [grpCheese, grpMeatCrispy, grpSauceCrispy],
        ),
    );

    // — Special supreme —
    await mkBurger(
        'Supreme Smashed',
        1399,
        'A perfectly grilled layer of pineapple with 2 smashed beef patties, wild mushrooms, sauteed onions and pickle, a choice of cheese and our special grill sauce',
        [grpCheese, grpMeatPatty, saladRemoveSupreme, grpSauceSecret],
    );
    await mkBurger(
        'Supreme Combo',
        1099,
        'A special treat of our smashed beef and blend of peri peri grilled chicken together with lettuce, tomatoes, onion, jalapenos and our secret burger sauce',
        [grpCheese, saladRemoveLTOJ, grpSauceSecret],
    );
    await mkBurger(
        'Kiwi Kick',
        1199,
        'A real kiwi flavour of smashed beef with fried egg, cheese, lettuce, tomato, onion, jalapenos and mustard sauce',
        [grpCheese, grpMeatPatty, saladRemoveLTOJ, grpSauceMustard],
    );

    // ===================================================================
    // FIREY WRAPS — all Rs549 except Peperico Special Rs649.
    // ===================================================================
    const wraps: Array<[string, string, number]> = [
        [
            'Chicken Tikka Wrap',
            'Chicken tikka, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Krunchy Chicken',
            'Krunchy chicken, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Peri Peri Chicken Wrap',
            'Peri peri chicken, lettuce, onion, cucumber and peri peri mayo',
            549,
        ],
        [
            'Chicken and Pepperoni',
            'Chicken & pepperoni, lettuce, onion, cucumber and mayo',
            549,
        ],
        [
            'Peperico Special',
            'Chicken fajita, kebab, sausage, lettuce, onion, cucumber and mayo',
            649,
        ],
    ];
    for (const [name, desc, price] of wraps) {
        const it = await mkItem({
            category: catWraps,
            name,
            description: desc,
            basePrice: price,
        });
        await linkGroups(it, [
            grpWrapRemove,
            grpWrapSauce,
            grpSimpleMeal,
            grpMealDrinkSoda,
        ]);
    }

    // ===================================================================
    // WINGS & STRIPS
    // (Peperico Special Salad withdrawn in the 2026 sheet → deactivated below.)
    // ===================================================================
    const wings = await mkItem({
        category: catWings,
        name: 'Peri Peri Wings',
        description:
            'Peri peri chicken wings grilled in a choice of 5 flavours',
        basePrice: 699,
        sizes: [
            { name: '5 Pcs', sizeKey: '5', price: 699, isDefault: true },
            { name: '10 Pcs', sizeKey: '10', price: 1299 },
        ],
    });
    await linkGroups(wings, [grpFlavour]);
    const strips = await mkItem({
        category: catWings,
        name: 'Peri Peri Strips',
        description:
            '100% chicken breast strips, grilled in our special flavours, available in a choice of 5 flavours',
        basePrice: 699,
        sizes: [
            { name: '5 Pcs', sizeKey: '5', price: 699, isDefault: true },
            { name: '10 Pcs', sizeKey: '10', price: 1299 },
        ],
    });
    await linkGroups(strips, [grpFlavour]);

    // ===================================================================
    // PASTA & RICE (Rs999 each — was Rs949)
    // ===================================================================
    const pastaGroups = [grpFlavour, grpAddDrinksPaid];
    const pasta = await mkItem({
        category: catPasta,
        name: 'Peri Peri Chicken Pasta',
        description:
            'Smooth and creamy pasta with fresh grilled peri peri chicken',
        basePrice: PASTA_RICE_PRICE,
    });
    await linkGroups(pasta, pastaGroups);
    const chickenRice = await mkItem({
        category: catPasta,
        name: 'Peri Peri Chicken Rice (1/4 chicken)',
        description: 'Peri peri rice with grilled peri peri chicken',
        basePrice: PASTA_RICE_PRICE,
    });
    await linkGroups(chickenRice, pastaGroups);

    // ===================================================================
    // CLASSIC SIDES
    // ===================================================================
    const fries = await mkItem({
        category: catSides,
        name: 'Fries',
        description: 'Regular chips',
        basePrice: 225,
        sizes: [
            { name: 'Regular', sizeKey: null, price: 225, isDefault: true },
            { name: 'Large', sizeKey: null, price: 399 },
        ],
    });
    const periFries = await mkItem({
        category: catSides,
        name: 'Peri Peri Fries',
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
    await mkItem({
        category: catSides,
        name: 'Nuggets (6 Pcs)',
        description: '6 pcs chicken nuggets',
        basePrice: 399,
    });
    await mkItem({
        category: catSides,
        name: 'Peri Peri Rice',
        basePrice: 299,
    });
    // Deal-only Large upgrades. À la carte Large is a VARIANT of Fries, but
    // deal-slot surcharges are per-item, so these must be dedicated items.
    // They live in Classic Sides so the platters' side slots offer them too —
    // PAID via the slot surcharges. Never make these normal items: a
    // category-based deal slot would then serve them uncharged.
    const largeFriesDeal = await mkItem({
        category: catSides,
        name: 'Large Fries',
        description: 'Large portion of regular chips',
        basePrice: 399,
        dealOnly: true,
    });
    const largePeriFriesDeal = await mkItem({
        category: catSides,
        name: 'Large Peri Peri Fries',
        description: 'Large portion of chips with our secret spices',
        basePrice: 425,
        dealOnly: true,
    });

    // ===================================================================
    // SPECIAL SIDES
    // ===================================================================
    const dirtyFries = await mkItem({
        category: catSpecialSides,
        name: 'Create Your Dirty Fries',
        description: 'Chips with your choice of flavour and peri peri chicken',
        basePrice: 799,
    });
    await linkGroups(dirtyFries, [grpFlavour]);

    // ===================================================================
    // DIPS
    // ===================================================================
    // NOTE: the sheet's Single Dips description lists "Tomato Ketchup" but the actual option
    // cells list "Chipotle" — we follow the selectable option cells.
    const DIP_OPTIONS = [
        'Ranch',
        'Garlic & Herb',
        'BBQ',
        'Sweet Chilli',
        'Chipotle',
        'Hot Peri-Peri',
    ];
    const grpPick1Dip = await mkGroup(
        'Choose your dip',
        { minSelect: 1, maxSelect: 1 },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const grpPick2Dip = await mkGroup(
        'Choose 2 dips',
        { minSelect: 2, maxSelect: 2 },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const grpPick3Dip = await mkGroup(
        'Choose 3 dips',
        { minSelect: 3, maxSelect: 3 },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const singleDip = await mkItem({
        category: catDips,
        name: 'Single Dip',
        description:
            'Choose from: Ranch, Garlic & Herb, BBQ, Sweet Chilli, Chipotle, Hot Peri-Peri',
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
    // KIDS MEAL (category "Kids Pizza" on the sheet is a mislabel — the item is
    // a burger/nuggets meal)
    // ===================================================================
    const grpKidsMain = await mkGroup(
        'Burger or Nuggets',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Kids Chicken Burger' }, { name: '6 Pcs Nuggets' }],
    );
    const grpKidsJuice = await mkGroup(
        'Choose Drink',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'Apple Juice' },
            { name: 'Orange Juice' },
            { name: 'Mango Juice' },
        ],
    );
    const kidsMeal = await mkItem({
        category: catKids,
        name: 'Kids Meal',
        description:
            'Kids chicken burger with lettuce and mayo (or 6 pcs chicken nuggets), plus a kids juice and regular chips',
        basePrice: 749,
    });
    await linkGroups(kidsMeal, [grpKidsMain, grpKidsJuice]);

    // ===================================================================
    // DESSERTS  (prices come from the description text on the sheet)
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
    for (const s of MILKSHAKES) {
        await mkItem({
            category: catShakes,
            name: `${s} Milkshake`,
            description:
                'Freshly made luscious milkshake with real fresh ingredients',
            basePrice: 499,
        });
    }

    // ===================================================================
    // DRINKS (standalone) — each soda flavour in 345ml / 1L / 1.5L; plus water & juice.
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
    await mkItem({ category: catDrinks, name: 'Water 500ml', basePrice: 75 });
    await mkItem({ category: catDrinks, name: 'Juice 200ml', basePrice: 75 });

    // Milkshake items (already created above) — resolve for deal drink upgrades.
    const milkshakeItems = await itemRepo.find({
        where: { brandId, name: In(MILKSHAKES.map((m) => `${m} Milkshake`)) },
    });

    const sodas345 = SODAS.map((f) => drinkItems[`${f} 345ml`].id);
    const sodas1L = SODAS.map((f) => drinkItems[`${f} 1L`].id);
    const sodas15L = SODAS.map((f) => drinkItems[`${f} 1.5L`].id);

    // ===================================================================
    // DEALS (deal = MenuItem in "Deals" category + deal_components)
    // ===================================================================
    const mkDeal = async (opts: {
        name: string;
        description: string;
        price: number;
        slots: Array<{
            type: 'fixed' | 'choice_category' | 'choice_list';
            sourceMenuItemId?: number | null;
            sourceCategoryId?: number | null;
            sourceMenuItemIds?: number[] | null;
            quantity?: number;
            optional?: boolean;
            allowCustomization?: boolean;
            slotSurcharges?: Record<string, number> | null;
        }>;
    }) => {
        const deal = await mkItem({
            category: catDeals,
            name: opts.name,
            description: opts.description,
            basePrice: opts.price,
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
                    slotSizeKey: null,
                    allowedSizeKeys: null,
                    mirrorSlotIndex: null,
                    mirrorMatchSize: false,
                    mirrorMatchCategory: false,
                }),
            );
        }
        return deal;
    };

    // Optional drink slot for the platters: add any number of drinks (repeats allowed) or none —
    // 345ml +130 / 1L +199 / 1.5L +249 each. Modeled as an OPTIONAL mix&match slot, so "No Drink"
    // needs no sentinel and "multiple / same drinks" works via the steppers.
    const DRINK_MAX = 10;
    const optionalDrinkSlot = () => {
        const surcharges: Record<string, number> = {};
        for (const id of sodas345) surcharges[String(id)] = 130;
        for (const id of sodas1L) surcharges[String(id)] = 199;
        for (const id of sodas15L) surcharges[String(id)] = 249;
        for (const m of milkshakeItems) surcharges[String(m.id)] = 499;
        return {
            type: 'choice_list' as const,
            sourceMenuItemIds: [
                ...sodas345,
                ...sodas1L,
                ...sodas15L,
                ...milkshakeItems.map((m) => m.id),
            ],
            quantity: DRINK_MAX,
            optional: true,
            allowCustomization: false,
            slotSurcharges: surcharges,
        };
    };
    // Classic-side slot: pick N sides but the item itself is NOT customizable (fries stay Regular —
    // no size/large upsell inside these deals). Fries upgrades are purchasable (client-confirmed).
    const sideSlot = (quantity: number) => ({
        type: 'choice_category' as const,
        sourceCategoryId: catSides.id,
        quantity,
        allowCustomization: false,
        slotSurcharges: {
            [String(periFries.id)]: 30,
            [String(largeFriesDeal.id)]: 150,
            [String(largePeriFriesDeal.id)]: 180,
        },
    });
    // Included meal drink slot that ITEMISES the drink: any 345ml soda (free) or any
    // milkshake (+250). Client-confirmed: no water/juice in meal-drink choosers.
    const mealDrinkSlot = (quantity = 1) => {
        const surcharges: Record<string, number> = {};
        for (const m of milkshakeItems)
            surcharges[String(m.id)] = MILKSHAKE_UPGRADE;
        return {
            type: 'choice_list' as const,
            sourceMenuItemIds: [
                ...sodas345,
                ...milkshakeItems.map((m) => m.id),
            ],
            quantity,
            allowCustomization: false,
            slotSurcharges: surcharges,
        };
    };
    // Fries slot for the burger-meal deals — the sheet's "Choose Fries" column:
    // Regular Fries (included) / Peri Peri Fries +30 / Large Fries +150 /
    // Large Peri Peri Fries +180.
    const friesSlot = () => ({
        type: 'choice_list' as const,
        sourceMenuItemIds: [
            fries.id,
            periFries.id,
            largeFriesDeal.id,
            largePeriFriesDeal.id,
        ],
        quantity: 1,
        allowCustomization: false,
        slotSurcharges: {
            [String(periFries.id)]: 30,
            [String(largeFriesDeal.id)]: 150,
            [String(largePeriFriesDeal.id)]: 180,
        },
    });

    // — Peri Peri Chicken Platters (chicken + classic side(s) + optional drink) —
    await mkDeal({
        name: '1/4 Peri Peri Chicken with 1 Classic Side',
        description:
            'Our famous 1/4 peri peri chicken with one classic side. Add a drink at extra charge.',
        price: 949,
        slots: [
            { type: 'fixed', sourceMenuItemId: chickenQuarter.id, quantity: 1 },
            sideSlot(1),
            optionalDrinkSlot(),
        ],
    });
    await mkDeal({
        name: '1/2 Peri Peri Chicken with 2 Classic Sides',
        description:
            'Our famous 1/2 peri peri chicken with two classic sides. Add a drink at extra charge.',
        price: 1799,
        slots: [
            { type: 'fixed', sourceMenuItemId: chickenHalf.id, quantity: 1 },
            sideSlot(2),
            optionalDrinkSlot(),
        ],
    });
    await mkDeal({
        name: 'Full Peri Peri Chicken with 4 Classic Sides',
        description:
            'Our famous full peri peri chicken with four classic sides. Add a drink at extra charge.',
        price: 3499,
        slots: [
            { type: 'fixed', sourceMenuItemId: chickenFull.id, quantity: 1 },
            sideSlot(4),
            optionalDrinkSlot(),
        ],
    });

    // — Peri Peri Chicken Meals (drink included) —
    await mkDeal({
        name: '1/4 Peri Peri Chicken with 1 Classic Side + 345ml Drink',
        description:
            'Our famous 1/4 peri peri chicken with one classic side and a 345ml drink.',
        price: 1079,
        slots: [
            { type: 'fixed', sourceMenuItemId: chickenQuarter.id, quantity: 1 },
            sideSlot(1),
            {
                type: 'choice_list',
                sourceMenuItemIds: sodas345,
                quantity: 1,
                allowCustomization: false,
            },
        ],
    });
    await mkDeal({
        name: '1/2 Peri Peri Chicken with 2 Classic Sides + 1L Drink',
        description:
            'Our famous 1/2 peri peri chicken with two classic sides and a 1L drink.',
        price: 1999,
        slots: [
            { type: 'fixed', sourceMenuItemId: chickenHalf.id, quantity: 1 },
            sideSlot(2),
            {
                type: 'choice_list',
                sourceMenuItemIds: sodas1L,
                quantity: 1,
                allowCustomization: false,
            },
        ],
    });

    // — Peri Peri Chicken and Rice Deal —
    await mkDeal({
        name: 'Peri Peri Chicken and Rice Deal',
        description:
            'Our famous 1/4 peri peri chicken on peri peri rice with a drink.',
        price: 999,
        slots: [
            { type: 'fixed', sourceMenuItemId: chickenRice.id, quantity: 1 },
            mealDrinkSlot(1),
        ],
    });

    // — Boneless Chicken Box (deal-only box items) —
    const friedBox = await mkItem({
        category: catChicken,
        name: 'Fried Chicken Box',
        description:
            'Boneless fried chicken on large fries with choice of sauce',
        basePrice: 0,
        dealOnly: true,
    });
    await linkGroups(friedBox, [grpBoxSauce]);
    const periBox = await mkItem({
        category: catChicken,
        name: 'Peri Peri Chicken Box',
        description:
            'Boneless grilled peri peri chicken on large fries with choice of sauce',
        basePrice: 0,
        dealOnly: true,
    });
    await linkGroups(periBox, [grpFlavour, grpBoxSauce]);
    await mkDeal({
        name: 'Boneless Chicken Box with Chips and Drink',
        description:
            'Choice of boneless fried or grilled peri peri chicken on large fries with a choice of sauce and a drink.',
        price: 999,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: [friedBox.id, periBox.id],
                quantity: 1,
                allowCustomization: true,
            },
            mealDrinkSlot(1),
        ],
    });

    // — "Peri Peri Burger Meal" Rs999 withdrawn in the 2026 sheet →
    //   deactivated below (its à-la-carte burger stays on the menu).

    // — Peri Peri Meal for 2 (two peri burgers + two drinks) —
    // The burger slots are customizable, so the burger's own flavour / meat /
    // cheese / salad / sauce groups still apply — this is where the sheet's
    // blanked "Choose Flavour" cells are restored from.
    await mkDeal({
        name: 'Peri Peri Meal for 2',
        description: '2 peri peri chicken burgers with 2 drinks.',
        price: 1699,
        slots: [
            { type: 'fixed', sourceMenuItemId: periBurger.id, quantity: 1 },
            { type: 'fixed', sourceMenuItemId: periBurger.id, quantity: 1 },
            mealDrinkSlot(1),
            mealDrinkSlot(1),
        ],
    });

    // — Crispy Burger Deal for 2 (two crispy chicken burgers + two drinks) —
    await mkDeal({
        name: 'Crispy Burger Deal for 2',
        description: '2 crispy chicken burgers with 2 drinks.',
        price: 1299,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: crispyBurgers.map((b) => b.id),
                quantity: 1,
                allowCustomization: true,
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: crispyBurgers.map((b) => b.id),
                quantity: 1,
                allowCustomization: true,
            },
            mealDrinkSlot(1),
            mealDrinkSlot(1),
        ],
    });

    // — Wild Mushroom Smashed Deal (smashed burger + fries + drink) —
    await mkDeal({
        name: 'Wild Mushroom Smashed Deal',
        description:
            'Smashed beef with wild mushrooms and sauteed onions, a choice of cheese and our special grill sauce, with fries and a drink.',
        price: 1299,
        slots: [
            { type: 'fixed', sourceMenuItemId: wildMushroom.id, quantity: 1 },
            friesSlot(),
            mealDrinkSlot(1),
        ],
    });

    // — Old & Gold Smashed Deal (smashed burger + fries + drink) —
    await mkDeal({
        name: 'Old & Gold Smashed Deal',
        description:
            'Perfectly smashed beef & cheese with fresh lettuce, onions, tomato, pickle and our secret grill sauce, with fries and a drink.',
        price: 999,
        slots: [
            { type: 'fixed', sourceMenuItemId: oldGold.id, quantity: 1 },
            friesSlot(),
            mealDrinkSlot(1),
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
    console.log('Peperi. Co 2026 menu seeded (non-destructive).');
    console.log(
        `  active: ${touchedItems.size} items across ${touchedCategories.size} categories`,
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
