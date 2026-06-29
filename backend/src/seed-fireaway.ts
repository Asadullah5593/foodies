/**
 * Seed: Fireaway brand and full menu.
 * Structure: categories, addons, modifier groups, menu items (by category), deal items, deal components.
 * All prices 100 pence. Supports addons, variants, modifiers, and deals.
 * Run: npx ts-node src/seed-fireaway.ts (or npm run seed:fireaway)
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

const BRAND_SLUG = 'fireaway';
const BRAND_NAME = 'Fireaway';
const PRICE = 100;

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

async function seedFireaway() {
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
        { name: 'Lunch Offers', sortOrder: 0 },
        { name: 'Promotions', sortOrder: 1 },
        { name: 'Kids Meal Deal', sortOrder: 2 },
        { name: 'Build Your Own Pizza', sortOrder: 3 },
        { name: 'Pasta', sortOrder: 4 },
        { name: 'Signature Pizzas', sortOrder: 5 },
        { name: 'Kids Pizza', sortOrder: 6 },
        { name: 'Dips', sortOrder: 7 },
        { name: 'Wings & Strips', sortOrder: 8 },
        { name: 'Salads', sortOrder: 9 },
        { name: 'Classic Sides', sortOrder: 10 },
        { name: 'Wraps', sortOrder: 11 },
        { name: 'Desserts', sortOrder: 12 },
        { name: 'Drinks', sortOrder: 13 },
        { name: 'Ice Cream', sortOrder: 14 },
        { name: 'Milkshakes', sortOrder: 15 },
        { name: 'Meal Deals', sortOrder: 16 },
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
    const addonExtraTopping = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Add Extra Toppings',
            price: PRICE,
            isActive: true,
            sortOrder: 0,
        }),
    );
    const addonClassicSide = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Add Classic Side',
            price: PRICE,
            isActive: true,
            sortOrder: 1,
        }),
    );
    const addonDrink330 = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Add 330ml Drink',
            price: PRICE,
            isActive: true,
            sortOrder: 2,
        }),
    );
    const addonStrawberries = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Strawberries',
            price: PRICE,
            isActive: true,
            sortOrder: 3,
        }),
    );
    const addonBanana = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Banana',
            price: PRICE,
            isActive: true,
            sortOrder: 4,
        }),
    );
    const addonMarshmallows = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Marshmallows',
            price: PRICE,
            isActive: true,
            sortOrder: 5,
        }),
    );
    const addonChoppedNuts = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Chopped Nuts',
            price: PRICE,
            isActive: true,
            sortOrder: 6,
        }),
    );
    const addonOreos = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Crushed Oreos',
            price: PRICE,
            isActive: true,
            sortOrder: 7,
        }),
    );
    const addonBiscoff = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Lotus Biscoff',
            price: PRICE,
            isActive: true,
            sortOrder: 8,
        }),
    );
    const addonCustardCream = await addonRepo.save(
        addonRepo.create({
            brandId: brand.id,
            categoryId: null,
            name: 'Custard Cream',
            price: PRICE,
            isActive: true,
            sortOrder: 9,
        }),
    );

    // ——— 3. MODIFIER GROUPS + MODIFIERS ———

    // Pizza Toppings (for 7" Lunch: choose 2)
    const pizzaToppingsGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Pizza Toppings (2)',
            minSelect: 2,
            maxSelect: 2,
        }),
    );
    const toppingNames = [
        'Pepperoni',
        'Chicken',
        'Tandoori Chicken',
        'Turkey Ham',
        'Turkey Bacon',
        'Meatballs',
        'Sausage',
        'Tuna',
        'Vegan Pepperoni',
        'Red Onions',
        'Peppers',
        'Cherry Tomatoes',
        'Mushrooms',
        'Black Olives',
        'Green Olives',
        'Sweetcorn',
        'Spinach',
        'Sun-Dried Tomatoes',
        'Chillies',
        'Pineapple',
        'Jalapenos',
        'Basil',
        'Crispy Onions',
        'Garlic',
        'Oregano',
        'Chilli Flakes',
        'Chilli Oil',
        'Hot Honey',
    ];
    for (const name of toppingNames) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: pizzaToppingsGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Choose Size
    const byoSizeGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Size',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['7 inch', '9 inch', '12 inch', '14 inch']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoSizeGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Choose Pizza Base
    const byoBaseGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Pizza Base',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of [
        'Regular Base',
        'Thin Base',
        'Thick Base',
        'Gluten Free Base',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoBaseGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Choose Sauce
    const byoSauceGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Sauce',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of [
        'Tomato Sauce',
        'Spicy Tomato Sauce',
        'Pesto Sauce',
        'BBQ Sauce',
        'Garlic Sauce',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoSauceGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Choose Cheese
    const byoCheeseGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Cheese',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of [
        'Mozzarella',
        'Parmesan',
        'Cheddar',
        'Buffalo Mozzarella',
        'Vegan Cheese',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoCheeseGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Add Meat Toppings (optional)
    const byoMeatGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Add Meat Toppings',
            minSelect: 0,
            maxSelect: 10,
        }),
    );
    for (const name of [
        'Pepperoni',
        'Chicken',
        'Tandoori Chicken',
        'Turkey Ham',
        'Turkey Bacon',
        'Meatballs',
        'Sausage',
        'Tuna',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoMeatGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Add Vegetable Toppings (optional)
    const byoVegGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Add Vegetable Toppings',
            minSelect: 0,
            maxSelect: 15,
        }),
    );
    for (const name of [
        'Vegan Pepperoni',
        'Red Onions',
        'Peppers',
        'Cherry Tomatoes',
        'Mushrooms',
        'Black Olives',
        'Green Olives',
        'Sweetcorn',
        'Spinach',
        'Sun-Dried Tomatoes',
        'Chillies',
        'Pineapple',
        'Jalapenos',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoVegGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // BYO: Add Garnish Toppings (optional)
    const byoGarnishGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Add Garnish Toppings',
            minSelect: 0,
            maxSelect: 7,
        }),
    );
    for (const name of [
        'Basil',
        'Crispy Onions',
        'Garlic',
        'Oregano',
        'Chilli Flakes',
        'Chilli Oil',
        'Hot Honey',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: byoGarnishGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // Signature: Choose Size
    const sigSizeGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Pizza Size',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['7 inch', '9 inch', '12 inch', '14 inch']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: sigSizeGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // Signature: Choose Base
    const sigBaseGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Base',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['Thin', 'Regular', 'Thick', 'Gluten Free (12" only)']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: sigBaseGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // Wings & Strips: Choose Quantity
    const wingsQtyGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Quantity',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of ['6 pieces', '12 pieces', '18 pieces']) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: wingsQtyGroup.id,
                name,
                price: 0,
            }),
        );
    }

    // Wings & Strips: Choose Flavour
    const wingsFlavourGroup = await modifierGroupRepo.save(
        modifierGroupRepo.create({
            brandId: brand.id,
            name: 'Choose Flavour',
            minSelect: 1,
            maxSelect: 1,
        }),
    );
    for (const name of [
        'Plain',
        'BBQ Crunch',
        'Garlic Parmesan',
        'Chilli Honey',
        'Heat Extreme',
        'Blue Cheese & Sriracha',
    ]) {
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: wingsFlavourGroup.id,
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

    // ——— 4. MENU ITEMS (by category; all basePrice 100) ———

    // 1. Lunch Offers
    await ensureItem(
        '7" Pizza Lunch Offer',
        'Any 7-inch pizza with two toppings served with a drink. Available Monday–Friday from 12PM–4PM. Collection or in-store only.',
        PRICE,
        categories['Lunch Offers'],
        0,
        { linkModifierGroups: [pizzaToppingsGroup] },
    );
    await ensureItem(
        '9" Pizza / Pasta / Wrap Lunch Offer',
        'Choice of a 9-inch pizza, pasta, or wrap. Available Monday–Friday from 12PM–4PM. Collection or in-store only.',
        PRICE,
        categories['Lunch Offers'],
        1,
        { linkAddons: [addonClassicSide, addonDrink330] },
    );
    await ensureItem(
        '12" Pizza Lunch Offer',
        'Any 12-inch signature pizza. Available Monday–Friday from 12PM–4PM. Collection or in-store only.',
        PRICE,
        categories['Lunch Offers'],
        2,
    );

    // 2. Promotions
    await ensureItem(
        'Tap The App Offer',
        'Discount applied when ordering through the official app using a promotional code.',
        PRICE,
        categories['Promotions'],
        0,
    );
    await ensureItem(
        '3 for Signature Pizza Offer',
        'Choose any three signature pizzas. Available when ordering through the website or mobile app.',
        PRICE,
        categories['Promotions'],
        1,
        { linkModifierGroups: [sigSizeGroup] },
    );

    // 3. Kids Meal Deal — deal item created later with components
    await ensureItem(
        'Kids Treat',
        'Kids pizza served with chips and a fruit drink.',
        PRICE,
        categories['Kids Meal Deal'],
        0,
    );

    // 4. Build Your Own Pizza
    await ensureItem(
        'Build Your Own Pizza',
        'Custom pizza where customers select base, sauce, cheese and toppings.',
        PRICE,
        categories['Build Your Own Pizza'],
        0,
        {
            linkModifierGroups: [
                byoSizeGroup,
                byoBaseGroup,
                byoSauceGroup,
                byoCheeseGroup,
                byoMeatGroup,
                byoVegGroup,
                byoGarnishGroup,
            ],
        },
    );

    // 5. Pasta
    const pastaItems = [
        {
            name: 'Penne Marinara',
            desc: 'Penne pasta in marinara sauce topped with parmesan and fresh basil.',
        },
        {
            name: 'Creamy Pesto Pasta',
            desc: 'Pasta in creamy pesto sauce topped with parmesan and fresh basil.',
        },
        {
            name: 'Mac & Cheese',
            desc: 'Macaroni pasta in rich cheese sauce topped with parmesan and mozzarella.',
        },
        {
            name: 'Smooth Carbonara',
            desc: 'Pasta in creamy carbonara sauce with turkey rashers and parmesan.',
        },
        {
            name: 'Chicken Arrabiata',
            desc: 'Chicken, mushrooms and tomatoes tossed with pasta in a herb-infused sauce.',
        },
        {
            name: 'Beef Lasagne',
            desc: 'Layers of beef Bolognese, béchamel sauce and lasagne sheets baked until golden.',
        },
        {
            name: 'Veggie Lasagne',
            desc: 'Vegetables layered with dairy-free cheese between lasagne sheets.',
        },
    ];
    for (let i = 0; i < pastaItems.length; i++) {
        await ensureItem(
            pastaItems[i].name,
            pastaItems[i].desc,
            PRICE,
            categories['Pasta'],
            i,
        );
    }

    // 6. Signature Pizzas (size + base + extra topping addon)
    const sigPizzas = [
        { name: 'Margherita', desc: 'Tomato base with mozzarella.' },
        {
            name: 'Meat Head',
            desc: 'Tomato base, mozzarella, chicken, ham and pepperoni.',
        },
        {
            name: 'King Pepperoni',
            desc: 'Tomato base with mozzarella and loaded pepperoni.',
        },
        {
            name: 'BBQ Boss',
            desc: 'BBQ base with mozzarella, red onions, sweetcorn and chicken.',
        },
        {
            name: 'Roma',
            desc: 'Tomato base with mozzarella, pepperoni and jalapenos.',
        },
        {
            name: 'Twisted Hawaiian',
            desc: 'Tomato base with mozzarella, turkey bacon and pineapple.',
        },
        {
            name: 'Fireaway Special',
            desc: 'BBQ base with mozzarella, meatballs, cheddar, onions, mushrooms and crispy onions.',
        },
        {
            name: 'Amalfi',
            desc: 'Tomato base with mozzarella, parmesan, olives and basil.',
        },
        {
            name: 'Meat Heaven',
            desc: 'Tomato base with mozzarella, meatballs, sausage, pepperoni and bacon.',
        },
        {
            name: 'Wild Buffalo',
            desc: 'Tomato base with buffalo mozzarella, sausage and pepperoni.',
        },
        {
            name: 'Asian Fusion',
            desc: 'Tomato base with mozzarella, tandoori chicken, peppers, onions and jalapenos.',
        },
        {
            name: 'Veggie Supreme',
            desc: 'Tomato base with mozzarella, onions, peppers, sweetcorn, mushrooms and olives.',
        },
        {
            name: 'Mexicano',
            desc: 'Tomato base with mozzarella, sausage, onions, jalapenos and mushrooms.',
        },
        {
            name: 'Pesto Manifesto',
            desc: 'Pesto base with mozzarella, mushrooms, spinach, sun-dried tomatoes and olives.',
        },
        {
            name: 'Vegan Pepperoni',
            desc: 'Tomato base with vegan cheese and vegan pepperoni.',
        },
        {
            name: 'Ellis Tuna',
            desc: 'Tomato base with mozzarella, tuna, peppers, onions and olives.',
        },
        {
            name: 'Vegan Supreme',
            desc: 'Tomato base with vegan cheese, onions, peppers, sweetcorn, mushrooms and olives.',
        },
    ];
    for (let i = 0; i < sigPizzas.length; i++) {
        const item = await ensureItem(
            sigPizzas[i].name,
            sigPizzas[i].desc,
            PRICE,
            categories['Signature Pizzas'],
            i,
            {
                linkModifierGroups: [sigSizeGroup, sigBaseGroup],
                linkAddons: [addonExtraTopping],
            },
        );
        await ensureVariant(item.id, '7 inch', 0, false);
        await ensureVariant(item.id, '9 inch', 0, true);
        await ensureVariant(item.id, '12 inch', 0, false);
        await ensureVariant(item.id, '14 inch', 0, false);
    }

    // 7. Kids Pizza
    await ensureItem(
        'Kids Pizza',
        'Classic cheese and tomato pizza shaped for kids.',
        PRICE,
        categories['Kids Pizza'],
        0,
    );

    // 8. Dips
    const dipNames = [
        'Garlic & Herb Dip',
        'Sweet Chilli Dip',
        'BBQ Dip',
        'Tomato Ketchup',
        'Buttermilk Ranch',
        'Hot Peri Peri Dip',
    ];
    for (let i = 0; i < dipNames.length; i++) {
        await ensureItem(dipNames[i], null, PRICE, categories['Dips'], i);
    }

    // 9. Wings & Strips
    await ensureItem(
        'Chicken Wings',
        'Crispy chicken wings.',
        PRICE,
        categories['Wings & Strips'],
        0,
        { linkModifierGroups: [wingsQtyGroup, wingsFlavourGroup] },
    );
    await ensureItem(
        'Crispy Chicken Strips',
        'Chicken breast strips breaded with house seasoning.',
        PRICE,
        categories['Wings & Strips'],
        1,
        { linkModifierGroups: [wingsQtyGroup, wingsFlavourGroup] },
    );
    await ensureItem(
        'Vegan Strips',
        'Plant-based strips coated with house seasoning.',
        PRICE,
        categories['Wings & Strips'],
        2,
        { linkModifierGroups: [wingsFlavourGroup] },
    );

    // 10. Salads
    const saladItems = [
        {
            name: 'Halloumi Salad',
            desc: 'Halloumi with mixed salad, cherry tomatoes, olives and house dressing.',
        },
        {
            name: 'Avocado Salad',
            desc: 'Avocado with mixed salad, cherry tomatoes, onions, olives and dressing.',
        },
        {
            name: 'Buffalo Salad',
            desc: 'Buffalo mozzarella with mixed salad and sun-dried tomatoes.',
        },
        {
            name: 'Chicken Salad',
            desc: 'Chicken strips with mixed salad, pineapple and blue cheese dressing.',
        },
        {
            name: 'Tuna Salad',
            desc: 'Tuna with mixed salad, onions, peppers and sweetcorn.',
        },
    ];
    for (let i = 0; i < saladItems.length; i++) {
        await ensureItem(
            saladItems[i].name,
            saladItems[i].desc,
            PRICE,
            categories['Salads'],
            i,
        );
    }

    // 11. Classic Sides
    const sidesItems = [
        'Garlic Bread',
        'Cheesy Garlic Bread',
        'Homemade Potato Wedges',
        'Jalapeno Cheesy Bites',
        'Fireaway Bites',
        'Onion Rings',
        'Chips',
        'Spicy Fries',
        'Cheesy Garlic Chips',
        'Curry Chips',
        'Dirty Fries',
    ];
    for (let i = 0; i < sidesItems.length; i++) {
        await ensureItem(
            sidesItems[i],
            null,
            PRICE,
            categories['Classic Sides'],
            i,
            sidesItems[i] === 'Cheesy Garlic Bread'
                ? { linkAddons: [addonExtraTopping] }
                : undefined,
        );
    }

    // 12. Wraps
    const wrapItems = [
        {
            name: 'Chicken Supreme Wrap',
            desc: 'Chicken, mixed salad, onions, peppers and mayo.',
        },
        {
            name: 'Chicken & Pepperoni Wrap',
            desc: 'Chicken, pepperoni, salad, onions, peppers and mayo.',
        },
        {
            name: 'Krunchy Chicken Wrap',
            desc: 'Crispy chicken with salad, onions, peppers and mayo.',
        },
        {
            name: 'Chicken & Bacon Wrap',
            desc: 'Chicken, bacon, salad, onions, peppers and mayo.',
        },
        {
            name: 'Fiery Special Wrap',
            desc: 'Chicken, pepperoni, bacon, ham, salad, onions, peppers and mayo.',
        },
    ];
    for (let i = 0; i < wrapItems.length; i++) {
        await ensureItem(
            wrapItems[i].name,
            wrapItems[i].desc,
            PRICE,
            categories['Wraps'],
            i,
        );
    }

    // 13. Desserts
    await ensureItem('Nutella Pizza', null, PRICE, categories['Desserts'], 0, {
        linkAddons: [
            addonStrawberries,
            addonBanana,
            addonMarshmallows,
            addonChoppedNuts,
            addonOreos,
            addonBiscoff,
            addonCustardCream,
        ],
    });
    await ensureItem(
        'Homemade Cookies',
        'Rainbow or Chocolate.',
        PRICE,
        categories['Desserts'],
        1,
    );
    await ensureItem(
        'Cannoli',
        'Hazelnut Chocolate, Pistachio or Lemon.',
        PRICE,
        categories['Desserts'],
        2,
    );
    await ensureItem(
        'Nutella Covered Fruit',
        'Strawberries or Banana.',
        PRICE,
        categories['Desserts'],
        3,
    );
    await ensureItem('Belgian Waffle', null, PRICE, categories['Desserts'], 4);
    await ensureItem(
        'Chocolate Dough Balls',
        null,
        PRICE,
        categories['Desserts'],
        5,
    );
    await ensureItem(
        'Chocolate Brownie',
        null,
        PRICE,
        categories['Desserts'],
        6,
    );
    await ensureItem(
        'Mini Doughnuts',
        'Sugar or Chocolate.',
        PRICE,
        categories['Desserts'],
        7,
    );
    await ensureItem(
        'Churros',
        'Milk Chocolate Dip or Salted Caramel Dip.',
        PRICE,
        categories['Desserts'],
        8,
    );

    // 14. Drinks
    const softDrinks = [
        'Coca-Cola',
        'Diet Coke',
        'Coke Zero',
        'Fanta',
        'Sprite',
    ];
    for (let i = 0; i < softDrinks.length; i++) {
        await ensureItem(softDrinks[i], null, PRICE, categories['Drinks'], i);
    }
    const bottledDrinks = [
        'Coca-Cola Bottle',
        'Diet Coke Bottle',
        'Coke Zero Bottle',
        'Fanta Bottle',
    ];
    for (let i = 0; i < bottledDrinks.length; i++) {
        await ensureItem(
            bottledDrinks[i],
            null,
            PRICE,
            categories['Drinks'],
            softDrinks.length + i,
        );
    }
    const energyDrinks = [
        'Red Bull Original',
        'Red Bull Tropical',
        'Red Bull Sugar Free',
    ];
    for (let i = 0; i < energyDrinks.length; i++) {
        await ensureItem(
            energyDrinks[i],
            null,
            PRICE,
            categories['Drinks'],
            softDrinks.length + bottledDrinks.length + i,
        );
    }
    const premiumDrinks = [
        'San Pellegrino Orange',
        'San Pellegrino Lemon',
        'San Pellegrino Blood Orange',
    ];
    for (let i = 0; i < premiumDrinks.length; i++) {
        await ensureItem(
            premiumDrinks[i],
            null,
            PRICE,
            categories['Drinks'],
            softDrinks.length + bottledDrinks.length + energyDrinks.length + i,
        );
    }
    const italianDrinks = [
        'Polara Arancia Rossa',
        'Polara Aranciata',
        'Polara Chinotto',
        'Polara Limonata',
        'Polara Mandarino',
    ];
    for (let i = 0; i < italianDrinks.length; i++) {
        await ensureItem(
            italianDrinks[i],
            null,
            PRICE,
            categories['Drinks'],
            softDrinks.length +
                bottledDrinks.length +
                energyDrinks.length +
                premiumDrinks.length +
                i,
        );
    }
    await ensureItem(
        'Still Water',
        null,
        PRICE,
        categories['Drinks'],
        softDrinks.length +
            bottledDrinks.length +
            energyDrinks.length +
            premiumDrinks.length +
            italianDrinks.length,
    );
    await ensureItem(
        'Capri Sun',
        null,
        PRICE,
        categories['Drinks'],
        softDrinks.length +
            bottledDrinks.length +
            energyDrinks.length +
            premiumDrinks.length +
            italianDrinks.length +
            1,
    );

    // Deal-only: Fruit Drink (used in Kids Treat)
    const fruitDrinkItem = await ensureItem(
        'Fruit Drink',
        'Fruit drink included in Kids Treat.',
        PRICE,
        categories['Drinks'],
        999,
        { dealOnly: true },
    );

    // 15. Ice Cream
    const iceCreamItem = await ensureItem(
        "Morelli's Ice Cream",
        null,
        PRICE,
        categories['Ice Cream'],
        0,
    );
    await ensureVariant(iceCreamItem.id, 'Chocolate', 0, true);
    await ensureVariant(iceCreamItem.id, 'Vanilla', 0, false);
    await ensureVariant(iceCreamItem.id, 'Strawberry', 0, false);
    await ensureVariant(iceCreamItem.id, 'Cookies & Cream', 0, false);
    await ensureVariant(iceCreamItem.id, 'Honeycomb', 0, false);

    // 16. Milkshakes
    const milkshakeFlavours = [
        'Biscoff',
        'Chocolate',
        'Oreo',
        'Vanilla',
        'Nutella',
        'Bubblegum',
        'Custard Cream',
        'Raspberry',
        'Strawberry',
        'Mango',
        'Banana',
        'Pistachio',
    ];
    for (let i = 0; i < milkshakeFlavours.length; i++) {
        await ensureItem(
            `${milkshakeFlavours[i]} Milkshake`,
            null,
            PRICE,
            categories['Milkshakes'],
            i,
        );
    }

    // 17. Meal Deals (deal menu items)
    const greenMachineItem = await ensureItem(
        'Green Machine',
        'Vegan pizza meal including vegan strips, drink and dips.',
        PRICE,
        categories['Meal Deals'],
        0,
    );
    const doubleBundleItem = await ensureItem(
        'Double Bundle',
        'Two signature pizzas with classic sides and a large drink.',
        PRICE,
        categories['Meal Deals'],
        1,
    );
    const styleItUpItem = await ensureItem(
        'Style It Up',
        'Build your own pizza served with a side and a drink.',
        PRICE,
        categories['Meal Deals'],
        2,
    );
    const fullHouseItem = await ensureItem(
        'Full House',
        'Three signature pizzas served with a side, dessert and large drink.',
        PRICE,
        categories['Meal Deals'],
        3,
    );

    // Resolve IDs for deal components
    const kidsPizzaItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Kids Pizza' },
    });
    const chipsItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Chips' },
    });
    const kidsTreatItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Kids Treat' },
    });
    const byoItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Build Your Own Pizza' },
    });
    const veganStripsItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Vegan Strips' },
    });
    const cocaColaItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Coca-Cola' },
    });
    const dipsFirstItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Garlic & Herb Dip' },
    });
    const bigBottleItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Coca-Cola Bottle' },
    });

    // ——— 5. DEAL COMPONENTS ———

    // Kids Treat: 1 Kids Pizza, 1 Chips, 1 Fruit Drink
    if (kidsTreatItem && kidsPizzaItem && chipsItem && fruitDrinkItem) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: kidsTreatItem.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save([
                dealComponentRepo.create({
                    menuItemId: kidsTreatItem.id,
                    slotIndex: 0,
                    type: 'fixed',
                    sourceMenuItemId: kidsPizzaItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
                dealComponentRepo.create({
                    menuItemId: kidsTreatItem.id,
                    slotIndex: 1,
                    type: 'fixed',
                    sourceMenuItemId: chipsItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
                dealComponentRepo.create({
                    menuItemId: kidsTreatItem.id,
                    slotIndex: 2,
                    type: 'fixed',
                    sourceMenuItemId: fruitDrinkItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
            ]);
            console.log(
                'Kids Treat: added 3 deal components (incl. deal-only Fruit Drink).',
            );
        }
    }

    // 12" Pizza Lunch Offer: 1x choice from Signature Pizzas
    const lunch12Item = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: '12" Pizza Lunch Offer' },
    });
    if (lunch12Item && categories['Signature Pizzas']) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: lunch12Item.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save(
                dealComponentRepo.create({
                    menuItemId: lunch12Item.id,
                    slotIndex: 0,
                    type: 'choice_category',
                    sourceCategoryId: categories['Signature Pizzas'].id,
                    quantity: 1,
                    allowCustomization: true,
                }),
            );
            console.log(
                '12" Pizza Lunch Offer: added 1 deal component (choice_category Signature Pizzas).',
            );
        }
    }

    // 3 for Signature Pizza Offer: 3x choice from Signature Pizzas
    const threeForItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: '3 for Signature Pizza Offer' },
    });
    if (threeForItem && categories['Signature Pizzas']) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: threeForItem.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save(
                dealComponentRepo.create({
                    menuItemId: threeForItem.id,
                    slotIndex: 0,
                    type: 'choice_category',
                    sourceCategoryId: categories['Signature Pizzas'].id,
                    quantity: 3,
                    allowCustomization: true,
                }),
            );
            console.log('3 for Signature Pizza Offer: added 1 deal component.');
        }
    }

    // Green Machine: 1 Vegan Signature (choice_list: Vegan Pepperoni, Vegan Supreme), 1 Vegan Strips, 1 Drink, 2 Dips
    const veganPepperoniItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Vegan Pepperoni' },
    });
    const veganSupremeItem = await menuItemRepo.findOne({
        where: { brandId: brand.id, name: 'Vegan Supreme' },
    });
    const greenMachineVeganIds = [
        veganPepperoniItem?.id,
        veganSupremeItem?.id,
    ].filter((id): id is number => id != null);
    if (
        greenMachineItem &&
        greenMachineVeganIds.length > 0 &&
        veganStripsItem &&
        cocaColaItem &&
        dipsFirstItem
    ) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: greenMachineItem.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save([
                dealComponentRepo.create({
                    menuItemId: greenMachineItem.id,
                    slotIndex: 0,
                    type: 'choice_list',
                    sourceMenuItemIds: greenMachineVeganIds,
                    quantity: 1,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: greenMachineItem.id,
                    slotIndex: 1,
                    type: 'fixed',
                    sourceMenuItemId: veganStripsItem.id,
                    quantity: 1,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: greenMachineItem.id,
                    slotIndex: 2,
                    type: 'fixed',
                    sourceMenuItemId: cocaColaItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
                dealComponentRepo.create({
                    menuItemId: greenMachineItem.id,
                    slotIndex: 3,
                    type: 'fixed',
                    sourceMenuItemId: dipsFirstItem.id,
                    quantity: 2,
                    allowCustomization: false,
                }),
            ]);
            console.log('Green Machine: added 4 deal components.');
        }
    }

    // Double Bundle: 2 Signature, 2 Classic Sides, 1 Large Drink
    if (
        doubleBundleItem &&
        categories['Signature Pizzas'] &&
        categories['Classic Sides'] &&
        bigBottleItem
    ) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: doubleBundleItem.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save([
                dealComponentRepo.create({
                    menuItemId: doubleBundleItem.id,
                    slotIndex: 0,
                    type: 'choice_category',
                    sourceCategoryId: categories['Signature Pizzas'].id,
                    quantity: 2,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: doubleBundleItem.id,
                    slotIndex: 1,
                    type: 'choice_category',
                    sourceCategoryId: categories['Classic Sides'].id,
                    quantity: 2,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: doubleBundleItem.id,
                    slotIndex: 2,
                    type: 'fixed',
                    sourceMenuItemId: bigBottleItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
            ]);
            console.log('Double Bundle: added 3 deal components.');
        }
    }

    // Style It Up: 1 BYO Pizza, 1 Side, 1 Drink
    if (
        styleItUpItem &&
        byoItem &&
        categories['Classic Sides'] &&
        cocaColaItem
    ) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: styleItUpItem.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save([
                dealComponentRepo.create({
                    menuItemId: styleItUpItem.id,
                    slotIndex: 0,
                    type: 'fixed',
                    sourceMenuItemId: byoItem.id,
                    quantity: 1,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: styleItUpItem.id,
                    slotIndex: 1,
                    type: 'choice_category',
                    sourceCategoryId: categories['Classic Sides'].id,
                    quantity: 1,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: styleItUpItem.id,
                    slotIndex: 2,
                    type: 'fixed',
                    sourceMenuItemId: cocaColaItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
            ]);
            console.log('Style It Up: added 3 deal components.');
        }
    }

    // Full House: 3 Signature, 1 Side, 1 Dessert, 1 Large Drink
    if (
        fullHouseItem &&
        categories['Signature Pizzas'] &&
        categories['Classic Sides'] &&
        categories['Desserts'] &&
        bigBottleItem
    ) {
        const existing = await dealComponentRepo.count({
            where: { menuItemId: fullHouseItem.id },
        });
        if (existing === 0) {
            await dealComponentRepo.save([
                dealComponentRepo.create({
                    menuItemId: fullHouseItem.id,
                    slotIndex: 0,
                    type: 'choice_category',
                    sourceCategoryId: categories['Signature Pizzas'].id,
                    quantity: 3,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: fullHouseItem.id,
                    slotIndex: 1,
                    type: 'choice_category',
                    sourceCategoryId: categories['Classic Sides'].id,
                    quantity: 1,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: fullHouseItem.id,
                    slotIndex: 2,
                    type: 'choice_category',
                    sourceCategoryId: categories['Desserts'].id,
                    quantity: 1,
                    allowCustomization: true,
                }),
                dealComponentRepo.create({
                    menuItemId: fullHouseItem.id,
                    slotIndex: 3,
                    type: 'fixed',
                    sourceMenuItemId: bigBottleItem.id,
                    quantity: 1,
                    allowCustomization: false,
                }),
            ]);
            console.log('Full House: added 4 deal components.');
        }
    }

    // ——— 6. BRANCH LINKING ———
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
        `Fireaway: ${categoriesData.length} categories, addons, modifier groups, menu items, deals. All prices ${PRICE} pence.`,
    );
    await dataSource.destroy();
}

seedFireaway().catch((e) => {
    console.error(e);
    process.exit(1);
});
