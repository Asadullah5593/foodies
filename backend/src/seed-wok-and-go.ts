/**
 * Seed: Wok & Go brand and full menu.
 * Structure: categories, addons, modifier groups, menu items (by category).
 * All prices 100 pence. Supports addons, variants, and modifiers.
 * Run: npx ts-node src/seed-wok-and-go.ts (or npm run seed:wok-and-go)
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

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'wok-and-go';
const BRAND_NAME = 'Wok & Go';
const PRICE = 100;

const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_DATABASE ?? 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

function slug(name: string, brandSlug: string) {
    return `${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${brandSlug}`;
}

async function seedWokAndGo() {
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
        { name: 'Create Your Own', sortOrder: 0 },
        { name: 'Classic Wok Boxes', sortOrder: 1 },
        { name: 'Street Food', sortOrder: 2 },
        { name: 'Vegan Boxes', sortOrder: 3 },
        { name: 'Kids Boxes', sortOrder: 4 },
        { name: 'Sides', sortOrder: 5 },
        { name: 'Fries', sortOrder: 6 },
        { name: 'Noodle / Rice Sides', sortOrder: 7 },
        { name: 'Extra Sauces', sortOrder: 8 },
        { name: 'Drinks', sortOrder: 9 },
        { name: 'Milkshakes', sortOrder: 10 },
    ];
    const categories: Record<string, MenuCategory> = {};
    for (const c of categoriesData) {
        let cat = await categoryRepo.findOne({ where: { brandId: brand!.id, name: c.name } });
        if (!cat) {
            cat = await categoryRepo.save(
                categoryRepo.create({
                    brandId: brand!.id,
                    name: c.name,
                    sortOrder: c.sortOrder,
                    isActive: true,
                }),
            );
        }
        categories[c.name] = cat;
    }

    // ——— 2. ADDONS (extra sauces, price 100) ———
    const extraSauceNames = ['Soy Sauce', 'Sweet Chilli Sauce', 'Hot Chilli Sauce', 'Hoisin Sauce', 'Teriyaki Spicy Mayo'];
    const sauceAddons: MenuAddon[] = [];
    for (let i = 0; i < extraSauceNames.length; i++) {
        let addon = await addonRepo.findOne({ where: { brandId: brand.id, name: extraSauceNames[i] } });
        if (!addon) {
            addon = await addonRepo.save(
                addonRepo.create({
                    brandId: brand.id,
                    categoryId: null,
                    name: extraSauceNames[i],
                    price: PRICE,
                    isActive: true,
                    sortOrder: i,
                }),
            );
        }
        sauceAddons.push(addon);
    }

    // ——— 3. MODIFIER GROUPS + MODIFIERS (price 0) ———
    const riceNoodlesGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Rice or Noodles',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Egg Noodles', 'Vermicelli Noodles', 'Rice Stick Noodles', 'Yaki Soba Noodles', 'Udon Noodles', 'Fried Rice']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: riceNoodlesGroup.id, name, price: 0 }));
    }

    const fillingsGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Your Fillings',
            minSelect: 0,
            maxSelect: 20,
        }),
    );
    const fillingNames = [
        'Chicken', 'Crispy Shredded Chicken', 'Beef', 'Duck', 'Prawn', 'Shrimp', 'Squid', 'Tofu', 'Vegan Duck', 'Vegan Chicken',
        'Extra Asian Vegetables', 'Broccoli', 'Baby Corn', 'Mangetout', 'Mushroom', 'Garden Peas', 'Mixed Peppers', 'Pineapple', 'Tomato', 'Water Chestnuts', 'Bamboo Shoots',
    ];
    for (const name of fillingNames) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: fillingsGroup.id, name, price: 0 }));
    }

    const sauceGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Your Sauce',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Black Bean Sauce', 'Oyster Sauce', 'Hoisin Sauce', 'Hot Chilli Sauce', 'Indonesian Nasi Sauce', 'Pad Thai Sauce', 'Soy Sauce', 'Sweet Chilli Sauce', 'Sweet N Sour Sauce', 'Teriyaki Sauce', 'Thai Green Curry Sauce', 'Katsu Curry Sauce', 'Sing-a Sauce']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: sauceGroup.id, name, price: 0 }));
    }

    const toppingsGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Add Toppings',
            minSelect: 0,
            maxSelect: 6,
        }),
    );
    for (const name of ['Fried Shallots', 'Fried Garlic', 'Coriander', 'Fresh Chillies', 'Mixed Sesame Seeds', 'Crushed Peanuts']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: toppingsGroup.id, name, price: 0 }));
    }

    const chooseRiceGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Rice',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Boiled Rice', 'Fried Rice']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: chooseRiceGroup.id, name, price: 0 }));
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
        let item = await menuItemRepo.findOne({ where: { brandId: brand!.id, slug: s } });
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
            const withAddons = await menuItemRepo.findOne({ where: { id: item.id }, relations: ['addons'] });
            if (withAddons) {
                const existing = new Set((withAddons.addons ?? []).map((a) => a.id));
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
            const withMod = await menuItemRepo.findOne({ where: { id: item.id }, relations: ['modifierGroups'] });
            if (withMod) {
                const existing = new Set((withMod.modifierGroups ?? []).map((g) => g.id));
                for (const g of opts.linkModifierGroups) {
                    if (!existing.has(g.id)) {
                        withMod.modifierGroups = [...(withMod.modifierGroups ?? []), g];
                        existing.add(g.id);
                    }
                }
                await menuItemRepo.save(withMod);
            }
        }
        return item;
    }

    async function ensureVariant(menuItemId: number, name: string, priceModifier: number, isDefault: boolean) {
        const existing = await dataSource.getRepository(MenuVariant).findOne({
            where: { menuItemId, name },
        });
        if (!existing) {
            await variantRepo.save(
                variantRepo.create({ menuItemId, name, priceModifier, isDefault }),
            );
        }
    }

    // ——— 4. MENU ITEMS (by category) ———

    // 1. Create Your Own
    await ensureItem(
        'Create Your Own Box',
        'Custom wok box including wok-tossed carrots, beansprouts, spring onion, onion and egg. Eggs can be removed upon request.',
        PRICE,
        categories['Create Your Own'],
        0,
        {
            linkAddons: sauceAddons,
            linkModifierGroups: [riceNoodlesGroup, fillingsGroup, sauceGroup, toppingsGroup],
        },
    );

    // 2. Classic Wok Boxes (size variants)
    const classicBoxes = [
        { name: 'Hotbox', desc: 'Chicken, beef and broccoli with egg noodles in hot chilli sauce.' },
        { name: 'Sweet Chilli Box', desc: 'Chicken, beef, broccoli, pineapple and tomato with egg noodles in sweet chilli sauce.' },
        { name: 'Combo Box', desc: 'Chicken, beef, shrimp and broccoli with egg noodles in oyster sauce.' },
        { name: 'Pad Thai Box', desc: 'Chicken and broccoli with rice stick noodles in pad thai sauce. Peanuts optional.' },
        { name: 'Black Bean Box', desc: 'Crispy shredded chicken with mixed peppers and broccoli in black bean sauce.' },
        { name: 'Sweet N Sour Box', desc: 'Crispy shredded chicken with mixed peppers and broccoli in sweet and sour sauce.' },
        { name: 'Mee Gee Seafood Box', desc: 'Squid, shrimp and tofu with broccoli in egg noodles with spicy Malaysian style sauce.' },
        { name: 'Green Curry Box', desc: 'Chicken and broccoli with egg noodles in Thai green curry sauce.' },
        { name: 'Nasi Seafood Box', desc: 'Squid, shrimp, mixed peppers, peas and broccoli with fried rice in Indonesian nasi sauce.' },
        { name: 'Hoisin Duck Box', desc: 'Shredded duck with broccoli and spring onion in egg noodles with hoisin sauce.' },
        { name: 'Sing A Box', desc: 'Chicken and broccoli with vermicelli noodles in sing-a curry sauce.' },
        { name: 'Chicken Teriyaki Box', desc: 'Chicken and broccoli with egg noodles in teriyaki sauce.' },
    ];
    for (let i = 0; i < classicBoxes.length; i++) {
        const item = await ensureItem(
            classicBoxes[i].name,
            classicBoxes[i].desc,
            PRICE,
            categories['Classic Wok Boxes'],
            i,
            { linkAddons: sauceAddons },
        );
        await ensureVariant(item.id, 'Small', 0, false);
        await ensureVariant(item.id, 'Regular', 0, true);
        await ensureVariant(item.id, 'Large', 0, false);
    }

    // 3. Street Food
    await ensureItem(
        'Chicken Katsu Curry Box',
        'Katsu chicken served with carrots, pickled cucumber, coriander, boiled rice and katsu curry sauce.',
        PRICE,
        categories['Street Food'],
        0,
        { linkAddons: sauceAddons },
    );
    await ensureItem(
        'Salt N Pepper Crispy Shredded Chicken',
        'Crispy shredded chicken with onions, peppers, spring onion, chilli and fried garlic in salt and pepper spice. Served with boiled or fried rice and soy sauce.',
        PRICE,
        categories['Street Food'],
        1,
        { linkAddons: sauceAddons, linkModifierGroups: [chooseRiceGroup] },
    );
    await ensureItem(
        'Salt N Pepper Squid',
        'Crispy battered squid with onions, peppers, spring onion, chilli and fried garlic in salt and pepper spice. Served with boiled or fried rice and soy sauce.',
        PRICE,
        categories['Street Food'],
        2,
        { linkAddons: sauceAddons, linkModifierGroups: [chooseRiceGroup] },
    );
    await ensureItem(
        'Salt N Pepper Tofu',
        'Tofu with onions, peppers, spring onion, chilli and fried garlic in salt and pepper spice. Served with boiled or fried rice and soy sauce.',
        PRICE,
        categories['Street Food'],
        3,
        { linkAddons: sauceAddons, linkModifierGroups: [chooseRiceGroup] },
    );
    await ensureItem(
        'Peking Loaded Fries',
        'Fries topped with hoisin duck, cucumber, spring onion and fresh chilli.',
        PRICE,
        categories['Street Food'],
        4,
        { linkAddons: sauceAddons },
    );
    await ensureItem(
        'Firecracker Fries',
        'Fries topped with spicy sauce, coriander, fresh chilli and spring onion.',
        PRICE,
        categories['Street Food'],
        5,
        { linkAddons: sauceAddons },
    );
    await ensureItem(
        'Teriyaki Fries',
        'Fries topped with spring onion, sesame seeds and teriyaki sauce.',
        PRICE,
        categories['Street Food'],
        6,
        { linkAddons: sauceAddons },
    );
    await ensureItem(
        'Street Fries',
        'Fries topped with spring onion, coriander and Chinese five spice.',
        PRICE,
        categories['Street Food'],
        7,
        { linkAddons: sauceAddons },
    );

    // 4. Vegan Boxes (size variants)
    const veganBoxes = [
        { name: 'Vegan Sweet N Sour Box', desc: 'Pineapple, mixed peppers and broccoli with yakisoba noodles in sweet and sour sauce.' },
        { name: 'Vegan Teriyaki Box', desc: 'Mangetout, baby corn and broccoli with yakisoba noodles in teriyaki sauce.' },
        { name: 'Tofu Hot Box', desc: 'Tofu with mixed peppers and broccoli with yakisoba noodles in hot chilli sauce.' },
        { name: 'Vegan Thai Green Box', desc: 'Vegan chicken with broccoli and fried rice in Thai green curry sauce.' },
        { name: 'Vegan Katsu Curry Box', desc: 'Boiled rice with vegan chicken and broccoli in katsu curry sauce.' },
        { name: 'Sweet Duck N Chilli Box', desc: 'Rice stick noodles with vegan duck and broccoli in sweet chilli sauce.' },
        { name: 'Vegan Hoisin Duck Box', desc: 'Vegan duck with rice stick noodles and broccoli in hoisin and soy sauce.' },
    ];
    for (let i = 0; i < veganBoxes.length; i++) {
        const item = await ensureItem(
            veganBoxes[i].name,
            veganBoxes[i].desc,
            PRICE,
            categories['Vegan Boxes'],
            i,
            { linkAddons: sauceAddons },
        );
        await ensureVariant(item.id, 'Small', 0, false);
        await ensureVariant(item.id, 'Regular', 0, true);
        await ensureVariant(item.id, 'Large', 0, false);
    }

    // 5. Kids Boxes
    await ensureItem(
        'Mini Combo Box',
        'Chicken, beef and broccoli with egg noodles and oyster sauce.',
        PRICE,
        categories['Kids Boxes'],
        0,
        { linkAddons: sauceAddons },
    );
    await ensureItem(
        'Yasi Yaki Box',
        'Tofu with mixed peppers and broccoli with fried rice and vegan sauce.',
        PRICE,
        categories['Kids Boxes'],
        1,
        { linkAddons: sauceAddons },
    );
    await ensureItem(
        'Mini Sweet N Sour Box',
        'Chicken and broccoli with egg noodles in sweet and sour sauce.',
        PRICE,
        categories['Kids Boxes'],
        2,
        { linkAddons: sauceAddons },
    );

    // 6. Sides
    const sides = [
        { name: 'Vegetable Spring Rolls', desc: 'Crispy vegetable spring rolls served with sweet chilli dip.' },
        { name: 'Vegetable Crispy Dumplings', desc: 'Vegetable dumplings served with hoisin sauce.' },
        { name: 'Panko Prawns', desc: 'King prawns coated in panko breadcrumbs.' },
        { name: 'Firecracker Prawns', desc: 'King prawns in curry sauce wrapped in wonton pastry.' },
        { name: 'Mini Platter', desc: 'Spring roll, crispy dumplings, firecracker prawns and panko prawns.' },
        { name: 'Mixed Platter', desc: 'Spring rolls, crispy dumplings, firecracker prawns and panko prawns.' },
        { name: 'Hot N Kickin Chicken Wings', desc: 'Chicken wings coated in hot and spicy seasoning.' },
        { name: 'Popcorn Chicken', desc: 'Crispy breadcrumb chicken fillet bites served with sweet chilli dip.' },
        { name: 'Sweet N Sour Chicken Balls', desc: 'Battered chicken balls served with sweet and sour dipping sauce.' },
        { name: 'Salt N Pepper Combo Box', desc: 'Fries with onions, peppers, spring onion and chilli with vegetable spring rolls and vegetable dumplings fried in salt and pepper seasoning. Served with chilli sauce.' },
    ];
    for (let i = 0; i < sides.length; i++) {
        await ensureItem(
            sides[i].name,
            sides[i].desc,
            PRICE,
            categories['Sides'],
            i,
            { linkAddons: sauceAddons },
        );
    }

    // 7. Fries
    await ensureItem('Plain Fries', null, PRICE, categories['Fries'], 0, { linkAddons: sauceAddons });
    await ensureItem('Salt N Pepper Fries', null, PRICE, categories['Fries'], 1, { linkAddons: sauceAddons });

    // 8. Noodle / Rice Sides
    await ensureItem('Boiled Rice', null, PRICE, categories['Noodle / Rice Sides'], 0, { linkAddons: sauceAddons });
    await ensureItem('Egg Fried Rice', null, PRICE, categories['Noodle / Rice Sides'], 1, { linkAddons: sauceAddons });
    await ensureItem('Egg Fried Noodles', null, PRICE, categories['Noodle / Rice Sides'], 2, { linkAddons: sauceAddons });

    // 9. Extra Sauces (standalone items)
    for (let i = 0; i < extraSauceNames.length; i++) {
        await ensureItem(extraSauceNames[i], null, PRICE, categories['Extra Sauces'], i);
    }

    // 10. Drinks
    const drinks = ['Coca Cola', 'Diet Coke', 'Coke Zero', 'Fanta', 'Sprite', 'Slushie', 'Water', 'FruitShoot', 'Red Bull', 'Heineken 0%', 'Corona Zero 0%'];
    for (let i = 0; i < drinks.length; i++) {
        await ensureItem(drinks[i], null, PRICE, categories['Drinks'], i);
    }

    // 11. Milkshakes
    const milkshakes = ['Bubblegum Milkshake', 'Vanilla Milkshake', 'Chocolate Milkshake', 'Strawberry Milkshake'];
    for (let i = 0; i < milkshakes.length; i++) {
        await ensureItem(milkshakes[i], null, PRICE, categories['Milkshakes'], i);
    }

    // ——— 5. BRANCH LINKING ———
    const branchId = process.env.BRANCH_ID ? parseInt(process.env.BRANCH_ID, 10) : null;
    if (branchId != null && Number.isFinite(branchId)) {
        const allItems = await menuItemRepo.find({ where: { brandId: brand.id } });
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

    console.log(`Wok & Go: ${categoriesData.length} categories, addons, modifier groups, menu items. All prices ${PRICE} pence.`);
    await dataSource.destroy();
}

seedWokAndGo().catch((e) => {
    console.error(e);
    process.exit(1);
});
