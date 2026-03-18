/**
 * Seed: Pizza & Pasta brand and full menu including Build Your Own Pizza (modifier groups).
 * Run after main seed. Uses first tenant. Creates brand if not exists.
 * Optional: set BRANCH_ID in env to link all items to that branch.
 * Run: npx ts-node src/seed-pizza-pasta.ts
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

const BRAND_SLUG = 'pizza-pasta';
const BRAND_NAME = 'Pizza & Pasta';

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

async function seedPizzaPasta() {
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

    const categoriesData = [
        { name: 'Build Your Own Pizza', sortOrder: 0 },
        { name: 'Signature Pizzas', sortOrder: 1 },
        { name: 'Classic Sides', sortOrder: 2 },
        { name: 'Pasta', sortOrder: 3 },
        { name: 'Kids Treat', sortOrder: 4 },
    ];
    const categories: MenuCategory[] = [];
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
        categories.push(cat);
    }

    const byoCat = categories[0];
    const sigCat = categories[1];
    const sidesCat = categories[2];
    const pastaCat = categories[3];
    const kidsCat = categories[4];

    const addonGF = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: byoCat.id,
            name: 'Gluten-Free Base',
            price: 2,
            isActive: true,
            sortOrder: 0,
        }),
    );

    const baseGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({ brandId: brand.id, name: 'Base', minSelect: 1, maxSelect: 1 }),
    );
    for (const name of ['Regular', 'Thin']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: baseGroup.id, name, price: 0 }));
    }

    const sauceGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({ brandId: brand.id, name: 'Sauce', minSelect: 1, maxSelect: 1 }),
    );
    for (const name of ['Tomato', 'BBQ', 'Spicy Tomato', 'White Garlic']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: sauceGroup.id, name, price: 0 }));
    }

    const cheeseGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({ brandId: brand.id, name: 'Cheese', minSelect: 1, maxSelect: 1 }),
    );
    await modifierRepo.save(modifierRepo.create({ modifierGroupId: cheeseGroup.id, name: 'Mozzarella', price: 0 }));
    await modifierRepo.save(modifierRepo.create({ modifierGroupId: cheeseGroup.id, name: 'Vegan Cheese', price: 1.5 }));

    const proteinGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({ brandId: brand.id, name: 'Proteins', minSelect: 0, maxSelect: 5 }),
    );
    for (const name of ['Chicken', 'Pepperoni', 'Ham', 'Spicy Beef', 'Bacon']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: proteinGroup.id, name, price: 1 }));
    }

    const vegGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({ brandId: brand.id, name: 'Veggies', minSelect: 0, maxSelect: 8 }),
    );
    for (const name of ['Peppers', 'Mushrooms', 'Olives', 'Sweetcorn', 'Onion', 'Tomatoes', 'Pineapple', 'Jalapeños']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: vegGroup.id, name, price: 0.5 }));
    }

    const drizzleGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({ brandId: brand.id, name: 'Drizzle', minSelect: 0, maxSelect: 1 }),
    );
    for (const name of ['Garlic', 'BBQ', 'Spicy']) {
        await modifierRepo.save(modifierRepo.create({ modifierGroupId: drizzleGroup.id, name, price: 0 }));
    }
    await modifierRepo.save(modifierRepo.create({ modifierGroupId: drizzleGroup.id, name: 'Hot Honey', price: 0.5 }));

    const byoItem = await menuItemRepo.save(
        menuItemRepo.create({
            brandId: brand.id,
            categoryId: byoCat.id,
            name: 'Build Your Own Pizza',
            slug: `build-your-own-pizza-${BRAND_SLUG}`,
            description: 'Choose base, sauce, cheese, proteins, veggies and drizzle.',
            imageUrl: null,
            basePrice: 7,
            isActive: true,
            sortOrder: 0,
        }),
    );
    const byoWithMod = await menuItemRepo.findOne({
        where: { id: byoItem.id },
        relations: ['modifierGroups', 'addons'],
    });
    if (byoWithMod) {
        byoWithMod.modifierGroups = [baseGroup, sauceGroup, cheeseGroup, proteinGroup, vegGroup, drizzleGroup];
        byoWithMod.addons = [addonGF];
        await menuItemRepo.save(byoWithMod);
    }
    await variantRepo.save(variantRepo.create({ menuItemId: byoItem.id, name: '9"', priceModifier: 0, isDefault: true }));
    await variantRepo.save(variantRepo.create({ menuItemId: byoItem.id, name: '12"', priceModifier: 6, isDefault: false }));
    await variantRepo.save(variantRepo.create({ menuItemId: byoItem.id, name: '14"', priceModifier: 9, isDefault: false }));

    const sigItems = [
        { name: 'King Pepperoni', description: 'Pepperoni, mozzarella, tomato', basePrice: 9 },
        { name: 'Meat Feast', description: 'Pepperoni, ham, beef, bacon', basePrice: 10 },
        { name: 'Veggie Supreme', description: 'Peppers, mushrooms, olives, onion', basePrice: 9 },
    ];
    const createdSig: MenuItem[] = [];
    for (let i = 0; i < sigItems.length; i++) {
        const it = sigItems[i];
        const item = await menuItemRepo.save(
            menuItemRepo.create({
                brandId: brand.id,
                categoryId: sigCat.id,
                name: it.name,
                slug: slug(it.name, BRAND_SLUG),
                description: it.description,
                imageUrl: null,
                basePrice: it.basePrice,
                isActive: true,
                sortOrder: i + 1,
            }),
        );
        createdSig.push(item);
        await variantRepo.save(variantRepo.create({ menuItemId: item.id, name: '7"', priceModifier: -3, isDefault: false }));
        await variantRepo.save(variantRepo.create({ menuItemId: item.id, name: '9"', priceModifier: 0, isDefault: true }));
        await variantRepo.save(variantRepo.create({ menuItemId: item.id, name: '12"', priceModifier: 3, isDefault: false }));
    }

    const sidesItems = [
        { name: 'Garlic Bread', basePrice: 3.99 },
        { name: 'Chips', basePrice: 2.99 },
        { name: 'Onion Rings', basePrice: 3.49 },
    ];
    for (let i = 0; i < sidesItems.length; i++) {
        const it = sidesItems[i];
        await menuItemRepo.save(
            menuItemRepo.create({
                brandId: brand.id,
                categoryId: sidesCat.id,
                name: it.name,
                slug: slug(it.name, BRAND_SLUG),
                description: null,
                imageUrl: null,
                basePrice: it.basePrice,
                isActive: true,
                sortOrder: i,
            }),
        );
    }

    const pastaItems = [
        { name: 'Penne Arrabbiata', basePrice: 8.99 },
        { name: 'Creamy Pesto', basePrice: 8.99 },
        { name: 'Mac & Cheese', basePrice: 8.99 },
    ];
    for (let i = 0; i < pastaItems.length; i++) {
        const it = pastaItems[i];
        await menuItemRepo.save(
            menuItemRepo.create({
                brandId: brand.id,
                categoryId: pastaCat.id,
                name: it.name,
                slug: slug(it.name, BRAND_SLUG),
                description: null,
                imageUrl: null,
                basePrice: it.basePrice,
                isActive: true,
                sortOrder: i,
            }),
        );
    }

    const kidsItem = await menuItemRepo.save(
        menuItemRepo.create({
            brandId: brand.id,
            categoryId: kidsCat.id,
            name: 'Kids Treat',
            slug: `kids-treat-${BRAND_SLUG}`,
            description: '1x Kids Pizza, 1x Chips, 1x Fruit Drink',
            imageUrl: null,
            basePrice: 7.99,
            isActive: true,
            sortOrder: 0,
        }),
    );

    const allItems = [byoItem, ...createdSig];
    const sidesCount = sidesItems.length;
    const pastaCount = pastaItems.length;
    const allMenuItems = await menuItemRepo.find({
        where: { brandId: brand.id },
        order: { sortOrder: 'ASC' },
    });

    const branchId = process.env.BRANCH_ID ? parseInt(process.env.BRANCH_ID, 10) : null;
    if (branchId && Number.isFinite(branchId)) {
        for (const item of allMenuItems) {
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
        console.log(`Linked ${allMenuItems.length} items to branch ${branchId}`);
    }

    console.log(`Pizza & Pasta: Build Your Own Pizza (modifier groups), ${createdSig.length} signature pizzas, sides, pasta, kids treat.`);
    await dataSource.destroy();
}

seedPizzaPasta().catch((e) => {
    console.error(e);
    process.exit(1);
});
