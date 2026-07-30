/**
 * Seed: Loranzo (Pakistan) menu — 2026 refresh.
 *
 * Source: "new updated menu/Foodies Master Menu Loranzo .xlsx" → sheet
 * "Loranznzo (Epos+App)", plus the client answers recorded below.
 *
 * This file REPLACES seed-loranzo-real.ts as the current menu definition.
 * seed-loranzo-real.ts is left untouched as the historical (pre-2026) record.
 *
 * NOTE on the workbook: the .xlsx is another copy of the Fireaway master
 * template; ONLY the sheet "Loranznzo (Epos+App)" (Country: Pakistan, Rs
 * prices) is real Loranzo content.
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
 *   menu_variants · modifier_groups · modifiers · m2m links → rebuilt. Their
 *       order-history FKs are ON DELETE SET NULL and every row carries
 *       name_snapshot / price_snapshot, so past orders stay readable.
 *   branch_menu_items                           → missing rows added only;
 *       existing price overrides / availability flags are never touched.
 *
 * Preflight: aborts if any recipe points at this brand's modifiers or variants
 * (recipes.modifier_id / recipes.variant_id are ON DELETE CASCADE, so the
 * rebuild would destroy them). Override with LORANZO_SEED_FORCE=1.
 *
 * Modifier-group names are NOT unique per brand, and must not be made unique:
 * the name is the heading the customer sees in the customize modal, and this
 * seeder rebuilds every group each run, so duplicates cost nothing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED vs the previous menu
 * ───────────────────────────────────────────────────────────────────────────
 *  1. Classic Cakes 13 → 8: +Cadbury Chocolate 2199, +Belgian Chocolate 2199,
 *     +Chocolate Heaven 2299; Lotus Three Milk repriced 2899 → 2599;
 *     −Ferrero Rocher, −Three Milk, −Milky Mart, −German Fudge,
 *     −Chocolate Mousse, −Honey, −Pistachio Three Milk, −Classic Coffee.
 *  2. Categories: Iced Coffees (6 items) and Iced Teas & Refreshers (8 items)
 *     withdrawn entirely; NEW "Iced Specials" — 4 lemonades at Rs 499
 *     (Sunset Strawberry, Blue Berry Fizz, Peach Glow, Red Berry Burst).
 *  3. Milkshakes cut 11 → 6 (the flavours listed in the new sheet).
 *  4. Coca-Cola range → Pepsi range (Pepsi, Diet Pepsi, 7up, Mirinda,
 *     Mountain Dew — as 345ml/1L/1.5L VARIANTS, Loranzo's house style).
 *     Juice 200ml withdrawn; Water 500ml stays.
 *  5. Doughnuts 9 → 6 (Plain Glazed, Double Chocolate, Cotton Candy, Lotus,
 *     Nutella, Ferrero Rocher).
 *  6. Homemade Cookie loses only "Nutella Filled" (6 → 5 flavours).
 *
 * Client-confirmed: Loranzo KEEPS the old cookie flavours (Chocolate Cookies /
 * Triple Chocolate / Pistachio) and the brownie's With/Without Chocolate
 * Spread choice — unlike the other three brands' 2026 sheets. "If client sent
 * it, this is final." The cakes' "PLZ CHECK LAYERS @ FOOD PANDA" margin note
 * is a client-side to-do, not a seeding instruction (client: ignore).
 *
 * Unchanged: Coffee & Tea (9), Frappe Specials (6), Muffins, Sundaes,
 * Cookie and Cream.
 *
 * Run: npm run seed:loranzo-2026   (requires `npm run seed` first)
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

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'loranzo';
const BRAND_NAME = 'Loranzo';

const MILKSHAKES = [
    'Oreo',
    'Nutella',
    'Lotus Biscoff',
    'Strawberry',
    'Chocolate',
    'Pistachio',
];
const SODAS = ['Pepsi', 'Diet Pepsi', '7up', 'Mirinda', 'Mountain Dew'];

// Applied before anything else so the row (and its id / order history) survives.
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
    const positionRepo = dataSource.getRepository(
        MenuItemModifierGroupPosition,
    );

    const [tenant] = await tenantRepo.find({ order: { id: 'ASC' }, take: 1 });
    if (!tenant) {
        console.log('No tenant found. Run `npm run seed` first.');
        await dataSource.destroy();
        return;
    }

    // Resolve by slug, then by name — editing a brand in the admin UI
    // regenerates its slug from the name, which would otherwise orphan this
    // lookup and make the seeder create a SECOND brand.
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
                    'Artisan cakes, gourmet desserts, specialty coffee, refreshers and freshly made milkshakes.',
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
    if (recipeRefs > 0 && process.env.LORANZO_SEED_FORCE !== '1') {
        console.error(
            `ABORTING: ${recipeRefs} recipe row(s) reference this brand's modifiers/variants.\n` +
                `Rebuilding them would cascade-delete those recipes. Review them first, then\n` +
                `re-run with LORANZO_SEED_FORCE=1 if you accept the loss.`,
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
        item.dealOnly = false;
        item.availableForOrderTypes = null;
        item.availableChannels = null;
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

    // A simple single-select flavour chooser (min 1 / max 1, all options free).
    const mkFlavourGroup = async (
        name: string,
        flavours: string[],
    ): Promise<ModifierGroup> => {
        const group = await groupRepo.save(
            groupRepo.create({
                brandId,
                name,
                minSelect: 1,
                maxSelect: 1,
                minSelectBySize: null,
                maxSelectBySize: null,
                includedQuantity: 0,
                includedBySize: null,
                allowQuantity: false,
                priceTiers: null,
                hideInDeals: false,
                visibleWhenModifierIds: null,
            }),
        );
        for (const f of flavours) {
            await modifierRepo.save(
                modifierRepo.create({
                    modifierGroupId: group.id,
                    name: f,
                    price: 0,
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

    // Seed a whole section of same-priced, choice-less items.
    const mkFlatSection = async (
        category: MenuCategory,
        price: number,
        items: Array<[string, string?]>,
    ) => {
        for (const [name, description] of items) {
            await mkItem({ category, name, description, basePrice: price });
        }
    };

    // ===================================================================
    // CATEGORIES
    // (Iced Coffees and Iced Teas & Refreshers are NOT touched here — the
    // deactivation sweep below retires them along with their items.)
    // ===================================================================
    const catCakes = await mkCategory(
        'Classic Cakes',
        'Choose from our classic fresh cakes — made with care and love to make every moment a celebration.',
    );
    const catDesserts = await mkCategory('Desserts');
    const catCoffeeTea = await mkCategory('Coffee & Tea');
    const catIcedSpecials = await mkCategory(
        'Iced Specials',
        'Freshly made lemonades.',
    );
    const catFrappes = await mkCategory('Loranzo Frappe Specials');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    // ===================================================================
    // CLASSIC CAKES — each cake is its own item at its own price. 2026: 8
    // cakes. "Cake" suffix follows the existing naming convention
    // (client-confirmed). Lotus Three Milk repriced 2899 → 2599.
    // ===================================================================
    const cakeDefs: Array<[string, number]> = [
        ['Lotus Three Milk Cake', 2599],
        ['Lotus Cake', 2599],
        ['Cadbury Chocolate Cake', 2199],
        ['Ferrero Classic Cake', 2199],
        ['Red Velvet Cake', 2199],
        ['Belgian Chocolate Cake', 2199],
        ['Nutella Cake', 2199],
        ['Chocolate Heaven Cake', 2299],
    ];
    for (const [name, price] of cakeDefs) {
        await mkItem({ category: catCakes, name, basePrice: price });
    }

    // ===================================================================
    // DESSERTS — each item + its single-select flavour chooser.
    // Loranzo's new sheet KEEPS the old cookie flavours and the brownie
    // spread choice (client: "if client sent it, this is final").
    // ===================================================================
    const cookie = await mkItem({
        category: catDesserts,
        name: 'Homemade Cookie',
        description:
            'Choose from our special flavours (Rs 349 for each cookie).',
        basePrice: 349,
    });
    await linkGroups(cookie, [
        // "Nutella Filled" withdrawn in the 2026 sheet.
        await mkFlavourGroup('Choose Your Flavour', [
            'Chocolate Cookies',
            'Triple Chocolate',
            'Pistachio',
            'Lotus',
            'Red Velvet',
        ]),
    ]);

    const brownie = await mkItem({
        category: catDesserts,
        name: 'Chocolate Brownie',
        description: 'Chocolate brownie with chocolate spread (1 per portion).',
        basePrice: 299,
    });
    await linkGroups(brownie, [
        await mkFlavourGroup('Choose Your Flavour', [
            'With Chocolate Spread',
            'Without Chocolate Spread',
        ]),
    ]);

    const cookieCream = await mkItem({
        category: catDesserts,
        name: 'Cookie and Cream',
        description: 'Choose from our special cookie flavours.',
        basePrice: 499,
    });
    await linkGroups(cookieCream, [
        await mkFlavourGroup('Choose your Cookie Flavour', [
            'Chocolate Cookies',
            'Triple Chocolate',
            'Pistachio',
            'Lotus',
            'Red Velvet',
        ]),
    ]);

    const muffin = await mkItem({
        category: catDesserts,
        name: 'Muffins',
        description: 'Choose from our special muffin flavours.',
        basePrice: 249,
    });
    await linkGroups(muffin, [
        // Sheet header "Choose your Cookie Flavour" is a template carry-over; these are muffins.
        await mkFlavourGroup('Choose your Flavour', [
            'Chocolate Muffin',
            'Triple Chocolate',
            'Oreo',
            'Lotus',
            'Red Velvet',
        ]),
    ]);

    const sundae = await mkItem({
        category: catDesserts,
        name: 'Special Sundaes',
        description: 'Choose any of our special sundaes.',
        basePrice: 449,
    });
    await linkGroups(sundae, [
        await mkFlavourGroup('Choose Flavour', [
            'Nutella Sundae',
            'Galaxy Sundae',
            'Three Milk Sundae',
            'Red Velvet Sundae',
            'Salted Caramel Sundae',
        ]),
    ]);

    const doughnut = await mkItem({
        category: catDesserts,
        name: 'Doughnut',
        description:
            'Our special selection of doughnuts (Rs 249 for each doughnut).',
        basePrice: 249,
    });
    await linkGroups(doughnut, [
        // 2026: 9 → 6 flavours.
        await mkFlavourGroup('Choose Your Flavour', [
            'Plain Glazed Doughnut',
            'Double Chocolate',
            'Cotton Candy',
            'Lotus',
            'Nutella',
            'Ferrero Rocher',
        ]),
    ]);

    // ===================================================================
    // COFFEE & TEA — unchanged in the 2026 sheet.
    // ===================================================================
    const coffeeTeaDefs: Array<[string, number]> = [
        ['Classic Americano', 599],
        ['Cappuccino', 799],
        ['Café Latte', 799],
        ['Hazelnut Latte', 899],
        ['Matcha Latte', 999],
        ['Chai Latte', 799],
        ['Flat White', 799],
        ['Tea with Milk', 399],
        ['Cinnamon Tea', 499],
    ];
    for (const [name, price] of coffeeTeaDefs) {
        await mkItem({ category: catCoffeeTea, name, basePrice: price });
    }

    // ===================================================================
    // ICED SPECIALS — NEW in 2026: 4 lemonades, flat Rs 499. Replaces the
    // withdrawn Iced Coffees and Iced Teas & Refreshers categories.
    // ("Brust" on the sheet normalised to "Burst".)
    // ===================================================================
    await mkFlatSection(catIcedSpecials, 499, [
        ['Sunset Strawberry Lemonade'],
        ['Blue Berry Fizz Lemonade'],
        ['Peach Glow Lemonade'],
        ['Red Berry Burst Lemonade'],
    ]);

    // ===================================================================
    // LORANZO FRAPPE SPECIALS — unchanged, flat Rs799.
    // ===================================================================
    await mkFlatSection(catFrappes, 799, [
        ['Frappuccino', 'Milk, ice cream & double espresso.'],
        ['Biscoff Frappe', 'Milk, ice cream, Biscoff & double espresso.'],
        ['Oreo Frappe', 'Milk, ice cream, Oreo & double espresso.'],
        ['Matcha Frappe', 'Milk, ice cream, matcha & double espresso.'],
        ['Caramel Cream Frappe', 'Milk, ice cream, caramel & double espresso.'],
        ['Pistachio Frappe', 'Milk, ice cream, pistachio & double espresso.'],
    ]);

    // ===================================================================
    // MILKSHAKES — flat Rs499. 2026: 11 → 6 flavours.
    // ===================================================================
    for (const s of MILKSHAKES) {
        await mkItem({
            category: catShakes,
            name: `${s} Milkshake`,
            description:
                'Freshly made luscious milkshake with real fresh ingredients.',
            basePrice: 499,
        });
    }

    // ===================================================================
    // DRINKS — Pepsi-range sodas in 345ml / 1L / 1.5L variants (Loranzo's
    // house style — single item per flavour); Water 500ml single-size.
    // Juice 200ml withdrawn.
    // ===================================================================
    for (const flavour of SODAS) {
        await mkItem({
            category: catDrinks,
            name: flavour,
            basePrice: 130,
            sizes: [
                { name: '345ml', sizeKey: null, price: 130, isDefault: true },
                { name: '1L', sizeKey: null, price: 199 },
                { name: '1.5L', sizeKey: null, price: 249 },
            ],
        });
    }
    await mkItem({ category: catDrinks, name: 'Water 500ml', basePrice: 75 });

    // ===================================================================
    // WITHDRAW what is no longer on the menu — deactivate, never delete.
    // (Retires the old cakes, milkshakes, Coke-range drinks, Juice 200ml,
    // and the whole Iced Coffees / Iced Teas & Refreshers categories.)
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
    // Loranzo has no addons, but keep the sweep for future refreshes.
    const allBrandAddons = await addonRepo.find({ where: { brandId } });
    const retiredAddonNames: string[] = [];
    for (const a of allBrandAddons) {
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
    console.log('Loranzo 2026 menu seeded (non-destructive).');
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
