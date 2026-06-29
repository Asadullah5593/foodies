/**
 * Seed: Peri Peri Co brand and full menu.
 * Structure: categories, addons, modifier groups, menu items (by category), deal items, deal components.
 * All prices 100 pence. Supports addons, variants, modifiers, and deals.
 * Run: npx ts-node src/seed-peri-peri-co.ts (or npm run seed:peri-peri-co)
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Tenant } from './entities/tenant.entity';
import { Brand } from './entities/brand.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuAddon } from './entities/menu-addon.entity';
import { MenuVariant } from './entities/menu-variant.entity';
import { ModifierGroup } from './entities/modifier-group.entity';
import { Modifier } from './entities/modifier.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';
import { DealComponent } from './entities/deal-component.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'peri-peri-co';
const BRAND_NAME = 'Peri Peri Co';
const PRICE = 100; // All items, addons, and deals use 100 pence

const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_DATABASE ?? 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

function slug(name: string, brandSlug: string) {
    return `${name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')}-${brandSlug}`;
}

async function seedPeriPeriCo() {
    await dataSource.initialize();
    const tenantRepo = dataSource.getRepository(Tenant);
    const brandRepo = dataSource.getRepository(Brand);
    const categoryRepo = dataSource.getRepository(MenuCategory);
    const menuItemRepo = dataSource.getRepository(MenuItem);
    const addonRepo = dataSource.getRepository(MenuAddon);
    const variantRepo = dataSource.getRepository(MenuVariant);
    const modifierGroupRepo = dataSource.getRepository(ModifierGroup);
    const modifierRepo = dataSource.getRepository(Modifier);
    const branchMenuItemRepo = dataSource.getRepository(BranchMenuItem);
    const dealComponentRepo = dataSource.getRepository(DealComponent);

    const [tenant] = await tenantRepo.find({ order: { id: 'ASC' }, take: 1 });
    if (!tenant) {
        console.log('No tenant found. Run npm run seed first.');
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
                description: null,
                logoUrl: null,
                isActive: true,
            }),
        );
        console.log(`Created brand: ${brand.name}`);
    } else {
        console.log(`Using existing brand: ${brand.name}`);
    }
    if (!brand) {
        await dataSource.destroy();
        return;
    }

    // ——— 1. CATEGORIES ———
    const categoriesData: { name: string; sortOrder: number }[] = [
        { name: 'Kebab Meals', sortOrder: 0 },
        { name: 'Wraps', sortOrder: 1 },
        { name: 'Loaded Fries', sortOrder: 2 },
        { name: 'Burger Meals', sortOrder: 3 },
        { name: 'Peri Peri Chicken', sortOrder: 4 },
        { name: 'Peri Peri Wings', sortOrder: 5 },
        { name: 'Peri Peri Strips', sortOrder: 6 },
        { name: 'Rice Box Meals', sortOrder: 7 },
        { name: 'Deals', sortOrder: 8 },
        { name: 'Sides', sortOrder: 9 },
        { name: 'Kids Meals', sortOrder: 10 },
        { name: 'Milkshakes', sortOrder: 11 },
        { name: 'Drinks', sortOrder: 12 },
        { name: 'Dips', sortOrder: 13 },
    ];
    const categories: Record<string, MenuCategory> = {};
    for (const c of categoriesData) {
        let cat = await categoryRepo.findOne({
            where: { brandId: brand.id, name: c.name },
        });
        if (!cat) {
            cat = await categoryRepo.save(
                categoryRepo.create({
                    brandId: brand.id,
                    name: c.name,
                    sortOrder: c.sortOrder,
                    isActive: true,
                }),
            );
        }
        categories[c.name] = cat;
    }

    // ——— 2. ADDONS (all price 100) ———
    const addonBacon = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Extra Bacon',
            price: PRICE,
            isActive: true,
            sortOrder: 0,
        }),
    );
    const addonTortilla = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Tortilla Wrap',
            price: PRICE,
            isActive: true,
            sortOrder: 1,
        }),
    );
    const addonExtraDip = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Extra Dip',
            price: PRICE,
            isActive: true,
            sortOrder: 2,
        }),
    );

    // ——— 3. MODIFIER GROUPS + MODIFIERS (all modifier price 0) ———
    const chooseKebabGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Kebab',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Chicken Kebab', 'Donner Kebab', 'Mixed Kebab']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: chooseKebabGroup.id,
                name,
                price: 0,
            }),
        );
    }

    const choosePattyGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Patty',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Double Chicken', 'Beef']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: choosePattyGroup.id,
                name,
                price: 0,
            }),
        );
    }

    const flavourGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Peri Peri Flavour',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of [
        'Lemon & Herb',
        'Mango Lime',
        'Mild',
        'Medium',
        'Hot',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: flavourGroup.id,
                name,
                price: 0,
            }),
        );
    }

    const riceBoxProteinGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Rice Box Protein',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Peri Peri Chicken', 'Chicken Shawarma', 'Mixed']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: riceBoxProteinGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // ——— HELPERS ———
    async function ensureItem(
        name: string,
        description: string | null,
        basePrice: number,
        category: MenuCategory,
        sortOrder: number,
        opts?: {
            linkAddons?: MenuAddon[];
            linkModifierGroups?: ModifierGroup[];
            dealOnly?: boolean;
        },
    ): Promise<MenuItem> {
        const s = slug(name, BRAND_SLUG);
        let item = await menuItemRepo.findOne({
            where: { brandId: brand!.id, slug: s },
        });
        if (!item) {
            item = await menuItemRepo.save(
                menuItemRepo.create({
                    brandId: brand!.id,
                    categoryId: category.id,
                    name,
                    slug: s,
                    description,
                    imageUrl: null,
                    basePrice,
                    isActive: true,
                    sortOrder,
                    dealOnly: opts?.dealOnly ?? false,
                }),
            );
        }
        if (opts?.linkAddons?.length) {
            const withAddons = await menuItemRepo.findOne({
                where: { id: item.id },
                relations: ['addons'],
            });
            if (withAddons) {
                const existing = new Set(
                    (withAddons.addons ?? []).map((a) => a.id),
                );
                for (const a of opts.linkAddons) {
                    if (!existing.has(a.id)) {
                        withAddons.addons = [...(withAddons.addons ?? []), a];
                        existing.add(a.id);
                    }
                }
                await menuItemRepo.save(withAddons);
            }
        }
        if (opts?.linkModifierGroups?.length) {
            const withMod = await menuItemRepo.findOne({
                where: { id: item.id },
                relations: ['modifierGroups'],
            });
            if (withMod) {
                const existing = new Set(
                    (withMod.modifierGroups ?? []).map((g) => g.id),
                );
                for (const g of opts.linkModifierGroups) {
                    if (!existing.has(g.id)) {
                        withMod.modifierGroups = [
                            ...(withMod.modifierGroups ?? []),
                            g,
                        ];
                        existing.add(g.id);
                    }
                }
                await menuItemRepo.save(withMod);
            }
        }
        return item;
    }

    async function ensureVariant(
        menuItemId: number,
        name: string,
        priceModifier: number,
        isDefault: boolean,
    ) {
        const existing = await dataSource.getRepository(MenuVariant).findOne({
            where: { menuItemId, name },
        });
        if (!existing) {
            await variantRepo.save(
                variantRepo.create({
                    menuItemId,
                    name,
                    priceModifier,
                    isDefault,
                }),
            );
        }
    }

    // ——— 4. MENU ITEMS (by category; all basePrice 100, variants modifier 0) ———

    // 1. Kebab Meals
    const kebabItem = await ensureItem(
        'Kebab Meal',
        'Choice of kebab served with lettuce, tomatoes, red onion, red cabbage, house sauce and garlic sauce. Served with fries and a drink.',
        PRICE,
        categories['Kebab Meals'],
        0,
        { linkModifierGroups: [chooseKebabGroup] },
    );
    await ensureVariant(kebabItem.id, 'On its Own', 0, true);
    await ensureVariant(kebabItem.id, 'Meal', 0, false);

    // 2. Wraps
    const wrapItems = [
        {
            name: 'Chicken Shawarma Wrap',
            desc: 'Chicken shawarma wrapped with mixed salad leaves and pickles.',
        },
        {
            name: 'Veggie Supreme Wrap',
            desc: 'Veggie wrap with mixed salad leaves, grilled onion, tomato and pickles.',
        },
        {
            name: 'Fajita Chicken Wrap',
            desc: 'Chicken fajita wrap with mixed salad leaves and grilled onion & pepper mix.',
        },
        {
            name: 'Peri Peri Chicken Wrap',
            desc: 'Grilled peri peri chicken wrap with mixed salad leaves, grilled onion and pickles.',
        },
        {
            name: 'Crispy Chicken Wrap',
            desc: 'Crispy chicken wrap with mixed salad leaves, grilled onion and tomato.',
        },
    ];
    for (let i = 0; i < wrapItems.length; i++) {
        const w = await ensureItem(
            wrapItems[i].name,
            wrapItems[i].desc,
            PRICE,
            categories['Wraps'],
            i,
            { linkAddons: [addonBacon, addonExtraDip] },
        );
        await ensureVariant(w.id, 'Wrap', 0, true);
        await ensureVariant(w.id, 'Meal', 0, false);
    }

    // 3. Loaded Fries
    const loadedFries = [
        'Chicken & Bacon Fries',
        'Salted Chilli Chicken Fries',
        'Taco Mince Fries',
        'Cajun Chicken Fries',
        'Cheesy Garlic & Bacon Fries',
        'Buffalo Chicken Fries',
    ];
    for (let i = 0; i < loadedFries.length; i++) {
        await ensureItem(
            loadedFries[i],
            'Fries topped with shredded mozzarella cheese and specialty toppings.',
            PRICE,
            categories['Loaded Fries'],
            i,
        );
    }

    // 4. Burger Meals
    const burgerItems = [
        {
            name: 'Supreme Burger',
            desc: 'Double chicken or beef burger with lettuce, tomato and onion. Served as a meal with fries and a drink.',
            linkPatty: true,
        },
        {
            name: 'Combo Supreme Burger',
            desc: 'Chicken and beef burger with lettuce, tomato and onion. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Saucy Pine Burger',
            desc: 'Beef burger with grilled pineapple, lettuce, tomato and onion. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Kiwi Kick Burger',
            desc: 'Beef burger with beetroot, fried egg, cheese, mustard sauce, lettuce, tomato and onion. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Classic Beef Burger',
            desc: 'Beef burger with lettuce, grilled onion and pickles. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Zinger Burger',
            desc: 'Crispy chicken burger with lettuce and mayo. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Wild Buffalo Burger',
            desc: 'Chicken burger with lettuce, tomato and jalapenos. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Hot Dynamite Burger',
            desc: 'Chicken burger with lettuce, red onion and jalapenos. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Veggie Burger',
            desc: 'Veggie patty with lettuce, tomato, grilled onion and pickles. Served with fries and a drink.',
            linkPatty: false,
        },
        {
            name: 'Peri Peri Chicken Burger',
            desc: 'Grilled peri-peri chicken with lettuce, tomatoes, red onion and peri-peri sauce. Served with fries and a drink.',
            linkPatty: false,
        },
    ];
    const burgerItemRefs: MenuItem[] = [];
    for (let i = 0; i < burgerItems.length; i++) {
        const b = burgerItems[i];
        const item = await ensureItem(
            b.name,
            b.desc,
            PRICE,
            categories['Burger Meals'],
            i,
            {
                linkAddons: [addonBacon, addonExtraDip],
                linkModifierGroups: b.linkPatty
                    ? [choosePattyGroup]
                    : undefined,
            },
        );
        burgerItemRefs.push(item);
    }

    // 5. Peri Peri Chicken
    const periItem = await ensureItem(
        'Peri Peri Chicken',
        'Half or full grilled peri-peri chicken.',
        PRICE,
        categories['Peri Peri Chicken'],
        0,
        { linkModifierGroups: [flavourGroup] },
    );
    await ensureVariant(periItem.id, '1/2 Chicken', 0, false);
    await ensureVariant(periItem.id, 'Full Chicken', 0, true);

    // 6. Peri Peri Wings
    const wings6 = await ensureItem(
        'Peri Peri Wings 6 pcs',
        'Grilled peri peri chicken wings.',
        PRICE,
        categories['Peri Peri Wings'],
        0,
    );
    await ensureVariant(wings6.id, 'Own', 0, true);
    await ensureVariant(wings6.id, 'Meal', 0, false);
    const wings12 = await ensureItem(
        'Peri Peri Wings 12 pcs',
        'Grilled peri peri chicken wings.',
        PRICE,
        categories['Peri Peri Wings'],
        1,
    );
    await ensureVariant(wings12.id, 'Own', 0, true);
    await ensureVariant(wings12.id, 'Meal', 0, false);
    const wings18 = await ensureItem(
        'Peri Peri Wings 18 pcs',
        'Grilled peri peri chicken wings.',
        PRICE,
        categories['Peri Peri Wings'],
        2,
    );
    await ensureVariant(wings18.id, 'Own', 0, true);
    await ensureVariant(wings18.id, 'Meal', 0, false);

    // 7. Peri Peri Strips
    const strips6 = await ensureItem(
        'Peri Peri Chicken Strips 6 pcs',
        'Grilled peri peri chicken strips.',
        PRICE,
        categories['Peri Peri Strips'],
        0,
    );
    await ensureVariant(strips6.id, 'Own', 0, true);
    await ensureVariant(strips6.id, 'Meal', 0, false);
    const strips12 = await ensureItem(
        'Peri Peri Chicken Strips 12 pcs',
        'Grilled peri peri chicken strips.',
        PRICE,
        categories['Peri Peri Strips'],
        1,
    );
    await ensureVariant(strips12.id, 'Own', 0, true);
    await ensureVariant(strips12.id, 'Meal', 0, false);
    const strips18 = await ensureItem(
        'Peri Peri Chicken Strips 18 pcs',
        'Grilled peri peri chicken strips.',
        PRICE,
        categories['Peri Peri Strips'],
        2,
    );
    await ensureVariant(strips18.id, 'Own', 0, true);
    await ensureVariant(strips18.id, 'Meal', 0, false);

    // 8. Rice Box Meals
    const riceBoxMealItem = await ensureItem(
        'Rice Box Meal',
        'Rice box served with salad, fries and a drink. Choose protein: Peri Peri Chicken, Chicken Shawarma, or Mixed.',
        PRICE,
        categories['Rice Box Meals'],
        0,
        { linkModifierGroups: [riceBoxProteinGroup] },
    );

    // 9. Deals — deal menu items created below after we have IDs for choice_list

    // 10. Sides
    await ensureItem('Fries', null, PRICE, categories['Sides'], 0);
    await ensureItem('Peri Peri Fries', null, PRICE, categories['Sides'], 1);
    await ensureItem('Curry Chips', null, PRICE, categories['Sides'], 2);
    await ensureItem('Gravy Chips', null, PRICE, categories['Sides'], 3);
    await ensureItem('Peri Peri Rice Box', null, PRICE, categories['Sides'], 4);

    // 11. Kids Meals
    await ensureItem(
        'Kids Chicken Burger',
        null,
        PRICE,
        categories['Kids Meals'],
        0,
    );
    await ensureItem(
        'Kids Chicken Wrap',
        null,
        PRICE,
        categories['Kids Meals'],
        1,
    );
    await ensureItem(
        'Kids Chicken Goujons',
        null,
        PRICE,
        categories['Kids Meals'],
        2,
    );
    await ensureItem(
        'Kids Chicken Nuggets (4 pieces)',
        null,
        PRICE,
        categories['Kids Meals'],
        3,
    );

    // 12. Milkshakes
    const milkshakes = [
        'Vanilla',
        'Chocolate',
        'Strawberry',
        'Oreo',
        'Biscoff',
    ];
    for (let i = 0; i < milkshakes.length; i++) {
        await ensureItem(
            `${milkshakes[i]} Milkshake`,
            null,
            PRICE,
            categories['Milkshakes'],
            i,
        );
    }

    // 13. Drinks
    await ensureItem('Coca Cola 330ml', null, PRICE, categories['Drinks'], 0);
    await ensureItem('Coke Zero', null, PRICE, categories['Drinks'], 1);
    await ensureItem('Diet Coke', null, PRICE, categories['Drinks'], 2);
    await ensureItem('Fanta Orange', null, PRICE, categories['Drinks'], 3);
    await ensureItem('Fanta Lemon', null, PRICE, categories['Drinks'], 4);
    await ensureItem('Sprite', null, PRICE, categories['Drinks'], 5);

    // 14. Dips
    const dips = [
        'Garlic Mayo',
        'Peri Peri Mayo',
        'BBQ Sauce',
        'Hot Chilli Sauce',
        'Sweet Chilli Sauce',
    ];
    for (let i = 0; i < dips.length; i++) {
        await ensureItem(dips[i], null, PRICE, categories['Dips'], i);
    }

    // Resolve items needed for deal components
    const friesItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Fries' },
    });
    const periRiceItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Peri Peri Rice Box' },
    });
    const zingerBurger = burgerItemRefs.find((b) => b.name === 'Zinger Burger');
    const wrapItemRefs = await menuItemRepo.find({
        where: { brandId: brand.id, categoryId: categories['Wraps'].id },
        order: { sortOrder: 'ASC' },
    });

    // ——— 5. DEAL MENU ITEMS (all fixed price 100) ———
    const burgerBoxDealItem = await ensureItem(
        'Burger Box Deal',
        'Any burger, wrap or rice box served with 3 peri peri wings, fries and a drink.',
        PRICE,
        categories['Deals'],
        0,
    );
    const lunchDealItem = await ensureItem(
        'Lunch Deal',
        'Half peri peri chicken served with fries and a drink. Available between 12PM – 4PM only.',
        PRICE,
        categories['Deals'],
        1,
        { linkModifierGroups: [flavourGroup] },
    );
    const familyMealDealItem = await ensureItem(
        'Family Meal Deal',
        'Four chicken zinger burgers served with four fries and four drinks.',
        PRICE,
        categories['Deals'],
        2,
    );
    const fullChickenMealItem = await ensureItem(
        'Full Chicken Meal',
        'One full peri peri chicken served with choice of two sides and two drinks. Add tortilla wrap optional.',
        PRICE,
        categories['Deals'],
        3,
        { linkAddons: [addonTortilla], linkModifierGroups: [flavourGroup] },
    );

    // ——— 6. DEAL COMPONENTS ———

    // Burger Box Deal: 1× choice (any burger + wrap + rice box), 3× wings, 1× fries, 1× drink
    const burgerBoxChoiceIds = [
        ...burgerItemRefs.map((b) => b.id),
        ...wrapItemRefs.map((w) => w.id),
        riceBoxMealItem.id,
    ];
    if (
        (await dealComponentRepo.count({
            where: { menuItemId: burgerBoxDealItem.id },
        })) === 0 &&
        friesItem &&
        wings6
    ) {
        await dealComponentRepo.save([
            dealComponentRepo.create({
                menuItemId: burgerBoxDealItem.id,
                slotIndex: 0,
                type: 'choice_list',
                sourceMenuItemIds: burgerBoxChoiceIds,
                quantity: 1,
                allowCustomization: true,
            }),
            dealComponentRepo.create({
                menuItemId: burgerBoxDealItem.id,
                slotIndex: 1,
                type: 'fixed',
                sourceMenuItemId: wings6.id,
                quantity: 3,
                allowCustomization: true,
            }),
            dealComponentRepo.create({
                menuItemId: burgerBoxDealItem.id,
                slotIndex: 2,
                type: 'fixed',
                sourceMenuItemId: friesItem.id,
                quantity: 1,
                allowCustomization: false,
            }),
            dealComponentRepo.create({
                menuItemId: burgerBoxDealItem.id,
                slotIndex: 3,
                type: 'choice_category',
                sourceCategoryId: categories['Drinks'].id,
                quantity: 1,
                allowCustomization: false,
            }),
        ]);
        console.log('Burger Box Deal: 4 slots; fixed price 100.');
    }

    // Lunch Deal: 1× half peri chicken, 1× fries, 1× drink
    if (
        (await dealComponentRepo.count({
            where: { menuItemId: lunchDealItem.id },
        })) === 0 &&
        friesItem
    ) {
        await dealComponentRepo.save([
            dealComponentRepo.create({
                menuItemId: lunchDealItem.id,
                slotIndex: 0,
                type: 'fixed',
                sourceMenuItemId: periItem.id,
                quantity: 1,
                allowCustomization: true,
            }),
            dealComponentRepo.create({
                menuItemId: lunchDealItem.id,
                slotIndex: 1,
                type: 'fixed',
                sourceMenuItemId: friesItem.id,
                quantity: 1,
                allowCustomization: false,
            }),
            dealComponentRepo.create({
                menuItemId: lunchDealItem.id,
                slotIndex: 2,
                type: 'choice_category',
                sourceCategoryId: categories['Drinks'].id,
                quantity: 1,
                allowCustomization: false,
            }),
        ]);
        console.log('Lunch Deal: 3 slots; fixed price 100.');
    }

    // Family Meal Deal: 4× Zinger Burger, 4× fries, 4× drinks
    if (
        (await dealComponentRepo.count({
            where: { menuItemId: familyMealDealItem.id },
        })) === 0 &&
        zingerBurger &&
        friesItem
    ) {
        await dealComponentRepo.save([
            dealComponentRepo.create({
                menuItemId: familyMealDealItem.id,
                slotIndex: 0,
                type: 'fixed',
                sourceMenuItemId: zingerBurger.id,
                quantity: 4,
                allowCustomization: true,
            }),
            dealComponentRepo.create({
                menuItemId: familyMealDealItem.id,
                slotIndex: 1,
                type: 'fixed',
                sourceMenuItemId: friesItem.id,
                quantity: 4,
                allowCustomization: false,
            }),
            dealComponentRepo.create({
                menuItemId: familyMealDealItem.id,
                slotIndex: 2,
                type: 'choice_category',
                sourceCategoryId: categories['Drinks'].id,
                quantity: 4,
                allowCustomization: false,
            }),
        ]);
        console.log(
            'Family Meal Deal: 4 Zinger burgers, 4 fries, 4 drinks; fixed price 100.',
        );
    }

    // Full Chicken Meal: 1× full peri chicken, 2× sides (chips or rice), 2× drink
    if (
        (await dealComponentRepo.count({
            where: { menuItemId: fullChickenMealItem.id },
        })) === 0 &&
        friesItem &&
        periRiceItem
    ) {
        await dealComponentRepo.save([
            dealComponentRepo.create({
                menuItemId: fullChickenMealItem.id,
                slotIndex: 0,
                type: 'fixed',
                sourceMenuItemId: periItem.id,
                quantity: 1,
                allowCustomization: true,
            }),
            dealComponentRepo.create({
                menuItemId: fullChickenMealItem.id,
                slotIndex: 1,
                type: 'choice_list',
                sourceMenuItemIds: [friesItem.id, periRiceItem.id],
                quantity: 2,
                allowCustomization: false,
            }),
            dealComponentRepo.create({
                menuItemId: fullChickenMealItem.id,
                slotIndex: 2,
                type: 'choice_category',
                sourceCategoryId: categories['Drinks'].id,
                quantity: 2,
                allowCustomization: false,
            }),
        ]);
        console.log('Full Chicken Meal: 3 slots; fixed price 100.');
    }

    // ——— 7. BRANCH LINKING ———
    const branchId = process.env.BRANCH_ID
        ? parseInt(process.env.BRANCH_ID, 10)
        : null;
    if (branchId != null && Number.isFinite(branchId)) {
        const allItems = await menuItemRepo.find({
            where: { brandId: brand.id },
        });
        for (const item of allItems) {
            const exists = await branchMenuItemRepo.findOne({
                where: { branchId, menuItemId: item.id },
            });
            if (!exists) {
                await branchMenuItemRepo.save(
                    branchMenuItemRepo.create({
                        branchId,
                        menuItemId: item.id,
                        priceOverride: null,
                        isAvailable: true,
                        isHiddenOnline: false,
                    }),
                );
            }
        }
        console.log(`Linked items to branch ${branchId}`);
    }

    console.log(
        `Peri Peri Co: ${categoriesData.length} categories, addons, modifier groups, menu items, deals. All prices ${PRICE} pence.`,
    );
    await dataSource.destroy();
}

seedPeriPeriCo().catch((e) => {
    console.error(e);
    process.exit(1);
});
