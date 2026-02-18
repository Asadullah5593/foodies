/**
 * Seed: menu items, addons, variants per brand.
 * Run after main seed (npm run seed). Uses existing brands and categories.
 * Run: npm run seed:menu
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Brand } from './entities/brand.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuAddon } from './entities/menu-addon.entity';
import { MenuVariant } from './entities/menu-variant.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

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

async function seedMenu() {
    await dataSource.initialize();
    const brandRepo = dataSource.getRepository(Brand);
    const categoryRepo = dataSource.getRepository(MenuCategory);
    const menuItemRepo = dataSource.getRepository(MenuItem);
    const addonRepo = dataSource.getRepository(MenuAddon);
    const variantRepo = dataSource.getRepository(MenuVariant);

    const brands = await brandRepo.find({ order: { id: 'ASC' } });
    if (brands.length === 0) {
        console.log('No brands found. Run npm run seed first.');
        await dataSource.destroy();
        return;
    }

    for (const brand of brands) {
        const existingAddons = await addonRepo.count({
            where: { brandId: brand.id },
        });
        if (existingAddons >= 4) {
            console.log(
                `Brand ${brand.name} already has menu data (${existingAddons} addons), skipping.`,
            );
            continue;
        }
        const categories = await categoryRepo.find({
            where: { brandId: brand.id },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
        if (categories.length === 0) {
            console.log(`Brand ${brand.name} has no categories, skipping.`);
            continue;
        }

        const firstCat = categories[0];
        const secondCat = categories[1] ?? firstCat;

        const addonNames = [
            { name: 'Extra Cheese', price: 1.5, categoryId: firstCat.id },
            { name: 'Bacon', price: 2.0, categoryId: firstCat.id },
            { name: 'Large Size', price: 0.5, categoryId: null },
            { name: 'Extra Shot', price: 0.75, categoryId: secondCat.id },
        ];
        const addons: MenuAddon[] = [];
        for (const a of addonNames) {
            const addon = await addonRepo.save(
                addonRepo.create({
                    brandId: brand.id,
                    categoryId: a.categoryId,
                    name: a.name,
                    price: a.price,
                    isActive: true,
                    sortOrder: addons.length,
                }),
            );
            addons.push(addon);
        }

        const itemsToCreate = [
            {
                categoryId: firstCat.id,
                name: 'Classic Burger',
                basePrice: 11.99,
            },
            { categoryId: firstCat.id, name: 'Chicken Wrap', basePrice: 9.5 },
            { categoryId: secondCat.id, name: 'Iced Coffee', basePrice: 4.5 },
            { categoryId: secondCat.id, name: 'Fresh Juice', basePrice: 5.0 },
        ];
        const createdItems: MenuItem[] = [];
        for (const it of itemsToCreate) {
            const slug = it.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
            const item = await menuItemRepo.save(
                menuItemRepo.create({
                    brandId: brand.id,
                    categoryId: it.categoryId,
                    name: it.name,
                    slug: `${slug}-${brand.slug}`,
                    description: null,
                    imageUrl: null,
                    basePrice: it.basePrice,
                    isActive: true,
                    sortOrder: createdItems.length,
                }),
            );
            createdItems.push(item);
        }

        for (let i = 0; i < Math.min(2, createdItems.length); i++) {
            const item = createdItems[i];
            if (!item) continue;
            await variantRepo.save(
                variantRepo.create({
                    menuItemId: item.id,
                    name: 'Regular',
                    priceModifier: 0,
                    isDefault: true,
                }),
            );
            await variantRepo.save(
                variantRepo.create({
                    menuItemId: item.id,
                    name: 'Large',
                    priceModifier: 2,
                    isDefault: false,
                }),
            );
        }

        for (let i = 0; i < createdItems.length; i++) {
            const item = await menuItemRepo.findOne({
                where: { id: createdItems[i].id },
                relations: ['addons'],
            });
            if (!item) continue;
            const addonsToLink = addons.slice(
                0,
                Math.min(2 + (i % 2), addons.length),
            );
            item.addons = addonsToLink;
            await menuItemRepo.save(item);
        }

        console.log(
            `Brand ${brand.name}: added ${addons.length} addons, ${createdItems.length} items, variants for 2 items.`,
        );
    }

    console.log('Menu seed done.');
    await dataSource.destroy();
}

seedMenu().catch((e) => {
    console.error(e);
    process.exit(1);
});
