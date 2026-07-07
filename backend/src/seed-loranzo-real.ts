/**
 * Seed: REAL Loranzo (Pakistan) menu — transcribed from the client's
 * "Foodies Master Menu Loranzo .xlsx" → sheet "Loranznzo (Epos+App)".
 *
 * NOTE on the workbook: like the Fireaway / WOK&GO / Peperico files, this .xlsx is another copy
 * of the Fireaway master template; ONLY the sheet "Loranznzo (Epos+App)" (Country: Pakistan, Rs
 * prices) is real Loranzo content. Every other sheet (UK/Scotland/Ireland/NL/Portugal/Turkey,
 * "Additional Offers", "Offers", "Offer Buttons", "Inputs") is leftover Fireaway template data
 * and is ignored — the "Offers"/"Additional Offers" tabs still read "FIREAWAY APP & E-Pos ONLY".
 *
 * Loranzo is a dessert / patisserie / specialty-coffee brand, so this seeder is a lean subset of
 * seed-wok-and-go-real.ts's capabilities:
 *  - individual priced items (Classic Cakes, Coffee & Tea)
 *  - flat-priced sections (Iced Coffees / Iced Teas & Refreshers / Frappe Specials Rs799,
 *    Milkshakes Rs499)
 *  - single-select flavour choosers for the desserts (cookie / brownie / sundae / doughnut …)
 *  - size variants for the fizzy drinks (345ml / 1L / 1.5L)
 *  No deals, no per-size selection limits, no meal upsells, no add-ons — none appear on the sheet.
 *
 * Interpretation notes (documented for the client report):
 *  - "Classic Cakes": the sheet lists them under one "Select your cake / Multiple Selections"
 *    builder, but the margin note says "PLZ CHECK LAYERS @ FOOD PANDA for set up individual cakes
 *    and all of rest in Foodies App" — i.e. in the app each cake is its OWN item at its OWN price.
 *    Seeded as 13 individual cake items (this is also the only way to carry a per-cake price).
 *  - the dessert flavour choosers are tagged "(Multiple Choice)" on the sheet, but each item is
 *    priced "for each cookie / per portion" — one flavour per unit — so they are single-select
 *    (min 1 / max 1), matching how the identical desserts are modelled in seed-wok-and-go-real.ts.
 *  - the Muffins chooser header reads "Choose your Cookie Flavour" (template carry-over); the
 *    options are muffins, so it is seeded as "Choose your Flavour".
 *  - obvious sheet spelling slips in customer-facing names are normalised (Frerrero→Ferrero,
 *    Claasic→Classic, Coffe→Coffee, Macha→Matcha, Valvet→Velvet, Dounut→Doughnut, Plian→Plain);
 *    prices and item set are kept verbatim.
 *  - fizzy drinks: 345ml sodas are Rs130 (Coke/Diet/Zero/Fanta/Sprite), each also offered as 1L
 *    (Rs199) and 1.5L (Rs249) per "1 L / 1.5 L — all above options"; Water 500ml & Juice 200ml
 *    are single-size at Rs75. Modelled as size variants (no deals reference them, unlike WOK&GO).
 *  - Kcal / Allergens columns are present but BLANK on the sheet → left null.
 *
 * Because Loranzo is a brand-new brand, the seeder also LINKS it to the branches that already host
 * this tenant's other brands (so it appears at Emporium alongside Peperi/Fireaway/WOK&GO). The
 * "-real" sibling seeders skip this because their brands were already linked.
 *
 * Idempotent: clears this brand's existing menu (categories/items/groups/addons), recreates it.
 * Run: npm run seed:loranzo-real   (requires `npm run seed` first for a tenant + branch)
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
import { MenuVariant } from './entities/menu-variant.entity';
import { ModifierGroup } from './entities/modifier-group.entity';
import { MenuItemModifierGroupPosition } from './entities/menu-item-modifier-group-position.entity';
import { Modifier } from './entities/modifier.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'loranzo';
const BRAND_NAME = 'Loranzo';

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

    let brand = await brandRepo.findOne({ where: { slug: BRAND_SLUG } });
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
        console.log(`Created brand: ${brand.name}`);
    } else {
        console.log(`Using existing brand: ${brand.name} (#${brand.id})`);
    }
    const brandId = brand.id;

    // ——— Idempotency: clear this brand's menu (FK cascades handle children) ———
    // Safe on a brand whose orders are demo data: order_items.menu_item_id is ON DELETE CASCADE,
    // so re-running this on a brand with LIVE sales would remove those orders' line items —
    // reseed only after archiving/exporting history.
    console.log('Clearing existing Loranzo menu for a clean re-seed…');
    await itemRepo.delete({ brandId }); // cascades variants, m2m links, order_items
    await groupRepo.delete({ brandId }); // cascades modifiers
    await dataSource.query('DELETE FROM menu_addons WHERE brand_id = $1', [
        brandId,
    ]);
    await categoryRepo.delete({ brandId });

    // ===================================================================
    // Helpers
    // ===================================================================
    let catSort = 0;
    const mkCategory = async (name: string, description?: string) =>
        categoryRepo.save(
            categoryRepo.create({
                brandId,
                name,
                description: description ?? null,
                imageUrl: null,
                sortOrder: catSort++,
                isActive: true,
            }),
        );

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
        const item = await itemRepo.save(
            itemRepo.create({
                brandId,
                categoryId: opts.category.id,
                name: opts.name,
                slug: slugify(opts.name),
                description: opts.description ?? null,
                imageUrl: null,
                basePrice: opts.basePrice,
                isActive: true,
                sortOrder: itemSort++,
                dealOnly: false,
                // Allergens & calories columns are present but BLANK in the sheet → left null.
                allergens: null,
                calories: null,
            }),
        );
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

    // Seed a whole section of same-priced, choice-less items (Iced Coffees, Refreshers, …).
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
    // ===================================================================
    const catCakes = await mkCategory(
        'Classic Cakes',
        'Choose from our classic fresh cakes — made with care and love to make every moment a celebration.',
    );
    const catDesserts = await mkCategory('Desserts');
    const catCoffeeTea = await mkCategory('Coffee & Tea');
    const catIcedCoffees = await mkCategory('Iced Coffees');
    const catRefreshers = await mkCategory('Iced Teas & Refreshers');
    const catFrappes = await mkCategory('Loranzo Frappe Specials');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    // ===================================================================
    // CLASSIC CAKES — each cake is its own item at its own price (see header note).
    // ===================================================================
    const cakeDefs: Array<[string, number]> = [
        ['Ferrero Rocher Cake', 2999],
        ['Lotus Cake', 2599],
        ['Three Milk Cake', 2199],
        ['Ferrero Classic Cake', 2199],
        ['Red Velvet Cake', 2199],
        ['Lotus Three Milk Cake', 2899],
        ['Milky Mart Cake', 1899],
        ['German Fudge Cake', 2199],
        ['Chocolate Mousse Cake', 2199],
        ['Nutella Cake', 2199],
        ['Honey Cake', 2499],
        ['Pistachio Three Milk Cake', 2499],
        ['Classic Coffee Cake', 2099],
    ];
    for (const [name, price] of cakeDefs) {
        await mkItem({ category: catCakes, name, basePrice: price });
    }

    // ===================================================================
    // DESSERTS — each item + its single-select flavour chooser.
    // ===================================================================
    const cookie = await mkItem({
        category: catDesserts,
        name: 'Homemade Cookie',
        description: 'Choose from our special flavours (Rs 349 for each cookie).',
        basePrice: 349,
    });
    await linkGroups(cookie, [
        await mkFlavourGroup('Choose Your Flavour', [
            'Chocolate Cookies',
            'Triple Chocolate',
            'Pistachio',
            'Lotus',
            'Red Velvet',
            'Nutella Filled',
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
        await mkFlavourGroup('Choose Your Flavour', [
            'Plain Glazed Doughnut',
            'Boston Cream',
            'Oreo',
            'Lotus',
            'Plain Chocolate',
            'Ferrero Rocher',
            'Nutella',
            'Orange Cream',
            'Red Velvet',
        ]),
    ]);

    // ===================================================================
    // COFFEE & TEA — individually priced hot drinks.
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
    // ICED COFFEES — flat Rs799.
    // ===================================================================
    await mkFlatSection(catIcedCoffees, 799, [
        ['Iced Latte'],
        ['Caramel Iced Latte'],
        ['Strawberry Iced Latte'],
        ['Oreo Iced Coffee'],
        ['Biscoff Iced Coffee'],
        ['Orange Iced Coffee'],
    ]);

    // ===================================================================
    // ICED TEAS & REFRESHERS — flat Rs799.
    // ===================================================================
    await mkFlatSection(catRefreshers, 799, [
        ['Mint Blue Magic'],
        ['Honey Lime Matcha'],
        ['Peach & Lemon Iced Tea'],
        ['Honey & Apple Soda'],
        ['Honey & Lemon Soda'],
        ['Coconut Mint Soda'],
        ['Berry Breeze Soda'],
        ['Lychee Purple Matcha Soda'],
    ]);

    // ===================================================================
    // LORANZO FRAPPE SPECIALS — flat Rs799, with ingredient descriptions.
    // ===================================================================
    await mkFlatSection(catFrappes, 799, [
        ['Frappuccino', 'Milk, ice cream & double espresso.'],
        ['Biscoff Frappe', 'Milk, ice cream, Biscoff & double espresso.'],
        ['Oreo Frappe', 'Milk, ice cream, Oreo & double espresso.'],
        ['Matcha Frappe', 'Milk, ice cream, matcha & double espresso.'],
        [
            'Caramel Cream Frappe',
            'Milk, ice cream, caramel & double espresso.',
        ],
        ['Pistachio Frappe', 'Milk, ice cream, pistachio & double espresso.'],
    ]);

    // ===================================================================
    // MILKSHAKES — flat Rs499.
    // ===================================================================
    const MILKSHAKES = [
        'Vanilla',
        'Oreo',
        'Nutella',
        'Lotus Biscoff',
        'Banana',
        'Strawberry',
        'Bubble-gum',
        'Raspberry',
        'Chocolate',
        'Pistachio',
        'Mango',
    ];
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
    // DRINKS — fizzy sodas in 345ml / 1L / 1.5L; water & juice single-size.
    // ===================================================================
    const SODAS = ['Coca-Cola', 'Diet Coke', 'Coca-Cola Zero', 'Fanta Orange', 'Sprite'];
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
    await mkItem({ category: catDrinks, name: 'Juice 200ml', basePrice: 75 });

    // ===================================================================
    // Make the brand available at this tenant's branches (Loranzo is brand-new, so unlike the
    // sibling "-real" seeders it has no branch_brands links yet). Link it to every branch that
    // already hosts one of this tenant's other brands, open for online orders. Idempotent.
    // ===================================================================
    await dataSource.query(
        `INSERT INTO branch_brands (branch_id, brand_id, is_open)
         SELECT DISTINCT bb.branch_id, $1::int, true
           FROM branch_brands bb
           JOIN brands br ON br.id = bb.brand_id
          WHERE br.tenant_id = $2
         ON CONFLICT (branch_id, brand_id) DO NOTHING`,
        [brandId, tenant.id],
    );

    // ——— Make every item available at the brand's branches ———
    const branches = await branchRepo
        .createQueryBuilder('b')
        .innerJoin('branch_brands', 'bb', 'bb.branch_id = b.id')
        .where('bb.brand_id = :brandId', { brandId })
        .getMany();
    const allItems = await itemRepo.find({ where: { brandId } });
    for (const b of branches) {
        for (const it of allItems) {
            const existing = await bmiRepo.findOne({
                where: { branchId: b.id, menuItemId: it.id },
            });
            if (!existing) {
                await bmiRepo.save(
                    bmiRepo.create({
                        branchId: b.id,
                        menuItemId: it.id,
                        priceOverride: null,
                        isAvailable: true,
                        isHiddenOnline: false,
                    }),
                );
            }
        }
    }

    console.log(
        `Seeded Loranzo real menu: ${allItems.length} items across 8 categories, ` +
            `linked to ${branches.length} branch(es).`,
    );
    await dataSource.destroy();
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
