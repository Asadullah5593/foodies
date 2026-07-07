/**
 * Seed: REAL Fireaway (Pakistan) menu — transcribed verbatim from the client's
 * "Foodies Master Menu Fireaway .xlsx" → sheet "Fireaway (App & EPOS)".
 *
 * Exercises every Phase 0–5 capability:
 *  - per-size topping pricing (modifier.priceBySize) + size_key on variants
 *  - "first N included free" allowances (modifier_group included counts)
 *  - time-restricted lunch deals (menu_item recurring availability window)
 *  - deal-slot paid upsell (deal_component.slotSurcharges — wrap upgrade +Rs100)
 *  - BUY-ONE-GET-ONE as a dynamic-priced DEAL (deal_pricing_mode='bogo', mirror slots)
 *  - allergens/calories columns (blank in the sheet → left null, faithfully)
 *
 * Idempotent: clears this brand's existing menu (categories/items/groups/addons/deals)
 * and the BOGO discount, then recreates everything.
 *
 * Run: npm run seed:fireaway-real   (requires `npm run seed` first for a tenant + branch)
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
import { Discount } from './entities/discount.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'fireaway';
const BRAND_NAME = 'Fireaway';
const BOGO_NAME = 'Buy One Get One Half Price';

// ——— Per-size pricing constants (straight from the sheet) ———
const MEAT_PRICE_BY_SIZE = { '7': 99, '9': 149, '12': 199, '14': 299 };
const VEG_PRICE_BY_SIZE = { '7': 49, '9': 69, '12': 89, '14': 99 };
const CHEESE_PRICE_BY_SIZE = { '7': 99, '9': 149, '12': 249, '14': 349 };
const INCLUDED_BY_SIZE = { '7': 2, '9': 2, '12': 3, '14': 3 }; // free meats/veg per size
// "Each topping can be selected multiple times at an additional charge" → effectively no cap.
const REPEAT_MAX = 99;
const LUNCH_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const LUNCH_START = '12:00';
const LUNCH_END = '16:00';
const COLLECTION_ONLY = ['pickup', 'dine_in']; // "Collection / In-store"

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
const DIPS = [
    'Ranch',
    'Garlic & Herb',
    'BBQ',
    'Sweet Chilli',
    'Tomato Ketchup',
    'Hot Peri-Peri',
];
const MILKSHAKE_FLAVOURS = [
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
const SOFT_DRINKS = [
    'Coca-Cola',
    'Diet Coke',
    'Coca-Cola Zero',
    'Fanta Orange',
    'Sprite',
];
// "Add a dip(s)" on a pizza/calzone: free allowance by size, then a tiered bundle price
// for the extras. Sheet rule: "ONLY 1 Dip is free with 7\", 10\", 12\". With 14\" 3 free Dips".
const DIP_PRICE_TIERS = { '1': 99, '2': 169, '3': 249 };
const DIP_INCLUDED_BY_SIZE = { '7': 1, '9': 1, '12': 1, '14': 3 };
const WING_FLAVOURS = [
    'Plain',
    'BBQ Crunch',
    'Chilli Honey',
    'Garlic Parmesan',
    'Heat Extreme',
    'Peri Peri',
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
    const discountRepo = dataSource.getRepository(Discount);

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

    // ——— Idempotency: clear this brand's menu (FK cascades handle children) ———
    console.log('Clearing existing Fireaway menu for a clean re-seed…');
    // Campaigns may pin this brand's items/deals (FK SET NULL violates the kind-consistency
    // CHECK), so drop those campaign entries before wiping the menu.
    await dataSource.query(
        'DELETE FROM campaign_items WHERE deal_menu_item_id IN (SELECT id FROM menu_items WHERE brand_id = $1)',
        [brandId],
    );
    await itemRepo.delete({ brandId }); // cascades variants, deal_components, m2m links
    await groupRepo.delete({ brandId }); // cascades modifiers
    await addonRepo.delete({ brandId });
    await categoryRepo.delete({ brandId });
    await discountRepo.delete({ tenantId: tenant.id, name: BOGO_NAME });

    // ——— Helpers ———
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
        dealOnly?: boolean;
        channels?: string[] | null;
        label?: string | null;
        availableTimeStart?: string | null;
        availableTimeEnd?: string | null;
        availableDaysOfWeek?: number[] | null;
        dealPricingMode?: string | null;
        dealBogoBuyQuantity?: number | null;
        dealBogoGetQuantity?: number | null;
        dealBogoGetPercent?: number | null;
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
                dealOnly: opts.dealOnly ?? false,
                availableForOrderTypes: opts.channels ?? null,
                label: opts.label ?? null,
                // Allergens & calories columns are present but BLANK in the sheet → left null.
                allergens: null,
                calories: null,
                availableTimeStart: opts.availableTimeStart ?? null,
                availableTimeEnd: opts.availableTimeEnd ?? null,
                availableDaysOfWeek: opts.availableDaysOfWeek ?? null,
                dealPricingMode: opts.dealPricingMode ?? null,
                dealBogoBuyQuantity: opts.dealBogoBuyQuantity ?? null,
                dealBogoGetQuantity: opts.dealBogoGetQuantity ?? null,
                dealBogoGetPercent: opts.dealBogoGetPercent ?? null,
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

    const positionRepo = dataSource.getRepository(
        MenuItemModifierGroupPosition,
    );
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
        await dataSource
            .createQueryBuilder()
            .relation(MenuItem, 'addons')
            .of(item.id)
            .add(addons.map((a) => a.id));
    };

    // ===================================================================
    // SHARED MODIFIER GROUPS (reused across items via M2M)
    // ===================================================================
    // Crust: required, single choice. 7" pizzas are Regular only (Thin available 10"/12"/14").
    const grpCrust = await mkGroup(
        'Choose your Crust',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'Thin Crust', availableForSizes: ['9', '12', '14'] },
            { name: 'Regular Crust' },
        ],
    );
    const grpBase = await mkGroup(
        'Choose Your Base',
        { minSelect: 1, maxSelect: 1 },
        BASE_SAUCES.map((b) => ({ name: b })),
    );
    // BYO cheese: Mozzarella included; Extra Cheese priced per size.
    const grpCheeseBYO = await mkGroup(
        'Choose Your Cheese',
        { minSelect: 1, maxSelect: 2 },
        [
            { name: 'Mozzarella' },
            {
                name: 'Extra Cheese',
                price: CHEESE_PRICE_BY_SIZE['7'],
                priceBySize: CHEESE_PRICE_BY_SIZE,
            },
        ],
    );
    // Classic/Signature cheese: As It Comes / No Cheese / Extra Cheese (per size).
    const grpCheeseSig = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 }, // required, exactly one (auto-selects "As It Comes")
        [
            { name: 'As It Comes' },
            { name: 'No Cheese On The Pizza' },
            {
                name: 'Extra Cheese',
                price: CHEESE_PRICE_BY_SIZE['7'],
                priceBySize: CHEESE_PRICE_BY_SIZE,
            },
        ],
    );
    // BYO meats: 2 free on 7"/10", 3 free on 12"/14"; extras charged per size.
    const grpMeatBYO = await mkGroup(
        'Choose Your Meat',
        {
            minSelect: 0,
            maxSelect: REPEAT_MAX,
            includedBySize: INCLUDED_BY_SIZE,
        },
        MEATS.map((m) => ({
            name: m,
            price: MEAT_PRICE_BY_SIZE['7'],
            priceBySize: MEAT_PRICE_BY_SIZE,
        })),
    );
    const grpVegBYO = await mkGroup(
        'Choose Your Veggies',
        {
            minSelect: 0,
            maxSelect: REPEAT_MAX,
            includedBySize: INCLUDED_BY_SIZE,
        },
        VEGGIES.map((v) => ({
            name: v,
            price: VEG_PRICE_BY_SIZE['7'],
            priceBySize: VEG_PRICE_BY_SIZE,
        })),
    );
    const grpTopItOff = await mkGroup(
        'Top It Off',
        { minSelect: 0, maxSelect: 1 },
        TOP_IT_OFF.map((t) => ({ name: t })),
    );
    // Signature/Classic extra toppings: meats + veg in one list, no free allowance. Each repeatable.
    const grpSigToppings = await mkGroup(
        'Add Extra Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            ...MEATS.map((m) => ({
                name: `Extra ${m}`,
                price: MEAT_PRICE_BY_SIZE['7'],
                priceBySize: MEAT_PRICE_BY_SIZE,
            })),
            ...VEGGIES.map((v) => ({
                name: `Extra ${v}`,
                price: VEG_PRICE_BY_SIZE['7'],
                priceBySize: VEG_PRICE_BY_SIZE,
            })),
        ],
    );
    // Medium-deal pizza toppings: same option set as Signature, but 2 are INCLUDED free at the
    // Medium (9") size (deal spec "choose 2 toppings"); capped at 2 units TOTAL — the sheet
    // grants exactly 2 (two different, or the same twice) with NO surcharge, so no charged
    // extras are offered. Free at both lunch-deal sizes (7" small offer / 10" medium offer).
    const grpDealToppings = await mkGroup(
        'Choose 2 Toppings',
        { minSelect: 0, maxSelect: 2, includedBySize: { '7': 2, '9': 2 } },
        [
            ...MEATS.map((m) => ({
                name: m,
                price: MEAT_PRICE_BY_SIZE['7'],
                priceBySize: MEAT_PRICE_BY_SIZE,
            })),
            ...VEGGIES.map((v) => ({
                name: v,
                price: VEG_PRICE_BY_SIZE['7'],
                priceBySize: VEG_PRICE_BY_SIZE,
            })),
        ],
    );
    const grpPizzaOrCalzone = await mkGroup(
        'Pizza or Calzone',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Pizza' }, { name: 'Calzone' }],
    );
    // Dips on a pizza/calzone: free allowance by size (1 free on 7"/10"/12", 3 free on 14"),
    // then a tiered bundle price (1=99, 2=169, 3=249) for the extras. Available inside deals
    // too — the deal supplies drinks (its own slot), not dips, so the same allowance applies.
    const grpAddDips = await mkGroup(
        'Add a dip(s)',
        {
            minSelect: 0,
            maxSelect: 6,
            includedQuantity: 1,
            includedBySize: DIP_INCLUDED_BY_SIZE,
            priceTiers: DIP_PRICE_TIERS,
        },
        DIPS.map((d) => ({ name: d })),
    );
    // Drinks as a paid up-sell. 1L/1.5L are per-flavour so the customer picks which soft drink.
    // Cross-sell — hidden inside deals (deals provide drinks via their own slot).
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
    const catWings = await mkCategory('Wings, Strips & Salads');
    const catDips = await mkCategory('Dips');
    const catWraps = await mkCategory(
        'Firey Wraps',
        'All wraps come with lettuce, onion, cucumber and mayo',
    );
    const catDesserts = await mkCategory('Desserts');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    const pizzaSizes = (
        p7: number,
        p10: number,
        p12: number,
        p14: number,
    ): SizeDef[] => [
        { name: 'Small 7"', sizeKey: '7', price: p7, isDefault: true },
        { name: 'Medium 9"', sizeKey: '9', price: p10 },
        { name: 'Large 12"', sizeKey: '12', price: p12 },
        { name: 'Extra Large 14"', sizeKey: '14', price: p14 },
    ];

    // ——— BUILD YOUR OWN ———
    const byo = await mkItem({
        category: catBYO,
        name: 'Build Your Own Pizza',
        description:
            'Choose your base and throw on as many toppings as you like! 12" & 14": up to 7 toppings (3 meats, 3 veg, 1 top it off). 7" & 10": up to 5 toppings (2 meats, 2 veg, 1 top it off).',
        basePrice: 699,
        sizes: pizzaSizes(699, 1449, 1949, 2849),
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
    const classicSizes = () => pizzaSizes(659, 1289, 1749, 2749);
    const signatureSizes = () => pizzaSizes(699, 1449, 1949, 2849);
    const pizzaGroups = [
        grpPizzaOrCalzone,
        grpCrust,
        grpCheeseSig,
        grpSigToppings,
        grpAddDips,
        grpAddDrinks,
    ];

    const classicPizzas: MenuItem[] = []; // for Classic-only deals (e.g. Large Pizza Lunch Offer)
    const classics: Array<[string, string]> = [
        [
            'Twisted Hawaiian Pizza',
            'Tomato base, mozzarella, chicken and pineapple',
        ],
        [
            'Veggie Supreme Pizza',
            'Tomato base, mozzarella, onions, mixed peppers, sweetcorn, mushrooms and green olives',
        ],
        [
            'BBQ Chicken Pizza',
            'BBQ base, mozzarella, red onions, sweetcorn and BBQ chicken',
        ],
        [
            'Chicken Special Pizza',
            'Tomato base, mozzarella, chicken tikka, chicken pepperoni, jalapeno, sweetcorn',
        ],
        [
            'Chicken Tikka Pizza',
            'Tomato base, mozzarella, chicken tikka, mixed peppers, onions and jalapeños',
        ],
    ];
    for (const [name, desc] of classics) {
        const it = await mkItem({
            category: catPizza,
            name,
            description: desc,
            basePrice: 659,
            sizes: classicSizes(),
            label: 'Classic',
        });
        await linkGroups(it, pizzaGroups);
        classicPizzas.push(it);
    }
    const signatures: Array<[string, string]> = [
        [
            'Fireaway Special Pizza',
            'Spicy tomato base, mozzarella, chicken muglai, chicken, peri peri chicken, red onions, mushrooms, onions',
        ],
        [
            'King Pepperoni Pizza',
            'Tomato base, mozzarella and loaded with pepperoni',
        ],
        [
            'Chicken Muglai Pizza',
            'Tomato base, mozzarella, chicken muglai, chicken fajita, onion and jalapeños',
        ],
        [
            'Wild Beef Pizza',
            'Tomato base, sausages, beef pepperoni, onion, jalapenos',
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
    const signaturePizzas: MenuItem[] = []; // for BOGO eligible pool
    for (const [name, desc] of signatures) {
        const it = await mkItem({
            category: catPizza,
            name,
            description: desc,
            basePrice: 699,
            sizes: signatureSizes(),
            label: 'Signature',
        });
        await linkGroups(it, pizzaGroups);
        signaturePizzas.push(it);
    }
    // Margherita — its own price ladder.
    const margherita = await mkItem({
        category: catPizza,
        name: 'Margherita Pizza',
        description: 'Tomato base and mozzarella',
        basePrice: 599,
        sizes: pizzaSizes(599, 999, 1299, 1999),
        label: 'Classic',
    });
    await linkGroups(margherita, pizzaGroups);
    classicPizzas.push(margherita);

    // ——— KIDS PIZZA ———
    // Single size; given size_key '7' so the shared per-size toppings price at 7" rates.
    const kids = await mkItem({
        category: catKids,
        name: 'Kids Pizza Meal',
        description:
            'Margherita pizza for kids in a smiley bear shape: tomato base, mozzarella and fresh basil. Includes a juice drink.',
        basePrice: 899,
        sizes: [{ name: 'Regular', sizeKey: '7', price: 899, isDefault: true }],
    });
    const grpKidsCheese = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'As It Comes' }, { name: 'No Cheese On The Pizza' }],
    );
    // The kids meal always includes a juice drink → let the customer pick which one (free).
    const grpKidsJuice = await mkGroup(
        'Choose your Juice',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Orange Juice' }, { name: 'Mango Juice' }],
    );
    await linkGroups(kids, [grpKidsCheese, grpKidsJuice, grpSigToppings]);
    const addonKidsFries = await addonRepo.save(
        addonRepo.create({
            brandId,
            categoryId: catKids.id,
            name: 'Add Fries',
            price: 199,
            isActive: true,
            sortOrder: 0,
        }),
    );
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
    // Cheesy garlic bread toppings: single size → flat extra meat Rs149 / veg Rs69.
    const grpSideToppings = await mkGroup(
        'Add Extra Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            ...MEATS.map((m) => ({ name: `Extra ${m}`, price: 149 })),
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
        { minSelect: 0, maxSelect: 2, includedQuantity: 2 }, // 2 meats included (same or different)
        MEATS.map((m) => ({ name: m })),
    );
    const dirtyFries = await mkItem({
        category: catSides,
        name: 'Create Your Dirty Fries',
        description: 'Chips with your choice of cheese and 2 meats',
        basePrice: 899,
    });
    await linkGroups(dirtyFries, [grpDirtyCheese, grpDirtyMeat]);

    // ——— WINGS, STRIPS & SALADS ———
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
    const grpSaladMeat = await mkGroup(
        'Choose Your Meat',
        { minSelect: 0, maxSelect: 4, includedQuantity: 2 }, // up to 2 included, extra meat +149
        [
            'Chicken Muglai',
            'Chicken Fajita',
            'Chicken Tikka',
            'Peri Peri Chicken',
        ].map((m) => ({ name: m, price: 149 })),
    );
    const grpSaladVeg = await mkGroup(
        'Choose Your Veggies',
        { minSelect: 0, maxSelect: 6, includedQuantity: 4 }, // up to 4 included, extra veg +29
        [
            'Black Olives',
            'Onion',
            'Sweet Corn',
            'Jalapeños',
            'Tomato',
            'Mixed Peppers',
        ].map((v) => ({ name: v, price: 29 })),
    );
    const salad = await mkItem({
        category: catWings,
        name: 'Fireaway Special Salad',
        description:
            'Oven baked chicken strips or any meat of your choice on a bed of mixed salad, with pineapple, tomatoes, jalapenos, red onion, drizzled with choice of dressing',
        basePrice: 899,
    });
    await linkGroups(salad, [grpSaladMeat, grpSaladVeg]);

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
    // Free, but the same sauce can be added multiple times (extra BBQ ×2) → allowQuantity.
    const grpAddSauce = await mkGroup(
        'Add a Sauce',
        { minSelect: 0, maxSelect: REPEAT_MAX, allowQuantity: true },
        ['Mayo', 'BBQ', 'Ketchup', 'Sweet Chilli'].map((s) => ({ name: s })),
    );
    // "Make it a meal" as a modifier group (not a flat addon) so the customer picks WHICH drink.
    // Hidden inside deals (the deal supplies fries + drink via its own slots).
    const grpWrapMeal = await mkGroup(
        'Make it a Meal?',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'Wrap Only' },
            { name: 'Make it a Meal (Reg Fries + 345ml Drink)', price: 350 },
        ],
    );
    // Conditional drink chooser — only shown once the paid meal option above is selected.
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
    const allWraps: MenuItem[] = [];
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
        allWraps.push(it);
        if (name === 'Firey Special Wrap') firySpecialWrap = it;
    }

    // ——— DESSERTS ———
    const grpChocCrust = await mkGroup(
        'Crust',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Thin Crust' }, { name: 'Regular' }],
    );
    const grpChocToppings = await mkGroup(
        'Additional Toppings',
        { minSelect: 0, maxSelect: REPEAT_MAX },
        [
            { name: 'Bananas', price: 149 },
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
            'Chocolate Cookies',
            'Triple Chocolate',
            'Pistachio',
            'Lotus',
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
    const grpSpread = await mkGroup(
        'Choose Your Flavour',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'With Chocolate Spread' },
            { name: 'Without Chocolate Spread' },
        ],
    );
    const brownie = await mkItem({
        category: catDesserts,
        name: 'Chocolate Brownie',
        description: 'Chocolate brownie with chocolate spread (1 per portion)',
        basePrice: 299,
    });
    await linkGroups(brownie, [grpSpread]);
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
            'Plain Glazed Doughnut',
            'Boston Cream',
            'Oreo',
            'Lotus',
            'Plain Chocolate',
            'Ferrero Rocher',
            'Nutella',
            'Orange Cream',
            'Red Velvet',
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
    // Each soft-drink flavour is sold in 345ml (Rs130), 1L (Rs199) and 1.5L (Rs249) —
    // the sheet's "1 L / 1.5 L - all above options" applies every flavour to those sizes.
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
    await mkItem({
        category: catDrinks,
        name: 'Orange Juice 200ml',
        basePrice: 75,
    });
    await mkItem({
        category: catDrinks,
        name: 'Mango Juice 200ml',
        basePrice: 75,
    });

    // Deal-only 250ml drinks (used by lunch deal drink slots; hidden from standalone menu).
    const deal250Drinks: MenuItem[] = [];
    for (const n of [
        'Coca-Cola 250ml',
        'Diet Coke 250ml',
        'Coca-Cola Zero 250ml',
        'Fanta Orange 250ml',
        'Sprite 250ml',
        'Still Water 250ml',
    ]) {
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
    // Every deal drink chooser also offers the 11 milkshakes at +Rs250.
    const shakeItemIds = shakeItems.map((it) => it.id);
    const shakeUpgradeSurcharges = Object.fromEntries(
        shakeItemIds.map((id) => [String(id), 250]),
    );

    // Small Pizza Lunch Offer — a DEAL-ONLY 7" BYO pizza (2 free toppings TOTAL, free cheese)
    // + 250ml drink. Mon–Fri 12–16, collection. The à-la-carte BYO item is NOT reused here:
    // its meat/veg groups each include 2 free per size (up to 4 free + charged extras), far
    // beyond the deal's "2 toppings (1 meat & 1 veg)" grant.
    const byoSmallDeal = await mkItem({
        category: catBYO,
        name: 'Build Your Own Pizza (Small Deal)',
        description: 'Your 7" pizza: choose a base, cheese and 2 toppings.',
        basePrice: 699,
        sizes: pizzaSizes(699, 1449, 1949, 2849), // ladder so the 7" variant exists
        dealOnly: true,
    });
    await linkGroups(byoSmallDeal, [
        grpCrust,
        grpBase,
        grpCheeseBYO, // Extra Cheese charged per size (client-confirmed)
        grpDealToppings, // "Choose 2 Toppings" (both included at 7", no charged extras)
    ]);
    await mkDeal({
        name: 'Small Pizza Lunch Offer',
        description:
            '7" pizza with 2 toppings (1 meat & 1 veg) and 1 soft drink (250ml) for only Rs 549. Monday–Friday 12–4pm.',
        price: 549,
        lunch: true,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: [byoSmallDeal.id],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '7',
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

    // Large Pizza Lunch Offer — any 12" Classic pizza for Rs999.
    await mkDeal({
        name: 'Large Pizza Lunch Offer',
        description:
            'Any Large 12" Classic pizza for only Rs 999! Monday–Friday 12–4pm.',
        price: 999,
        lunch: true,
        slots: [
            {
                // "All 12\" Classic Pizza options" — Classic pizzas only (no Signature).
                type: 'choice_list',
                sourceMenuItemIds: classicPizzas.map((p) => p.id),
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '12',
            },
        ],
    });

    // Medium Pizza/Pasta Lunch Offer — choose EITHER a build-your-own 9" (Medium 9") pizza
    // (base + cheese + 2 included toppings) OR a Pasta, flat Rs 899. Modeled as one choice_list
    // slot over [the deal-only BYO pizza + the pastas]; each choice carries its own groups, so
    // the pizza shows base/cheese/toppings and pasta shows its own options.
    const byoMediumDeal = await mkItem({
        category: catBYO,
        name: 'Build Your Own Pizza (Medium Deal)',
        description:
            'Your 9" pizza, built your way: choose a base, cheese and 2 toppings.',
        basePrice: 699,
        sizes: pizzaSizes(699, 1449, 1949, 2849), // ladder so the Medium 9" variant exists
        dealOnly: true, // used only inside this deal — hidden from the à-la-carte menu
    });
    await linkGroups(byoMediumDeal, [
        grpCrust,
        grpBase,
        grpCheeseBYO, // Extra Cheese charged per size (client-confirmed)
        grpDealToppings, // "Choose 2 Toppings" (2 included at 9", any/same twice, no extras)
    ]);
    await mkDeal({
        name: 'Medium Pizza, Pasta Lunch Offer',
        description:
            '9" build-your-own pizza (base, cheese & 2 toppings) or a pasta for only Rs 899. Monday–Friday 12–4pm.',
        price: 899,
        lunch: true,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: [
                    byoMediumDeal.id,
                    ...pastaItems.map((p) => p.id),
                ],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '9', // pizza pins to Medium 9"; pasta is sizeless (lock is a no-op)
            },
        ],
    });

    // Fireaway Wrap Lunch Deal — any wrap + 250ml drink Rs549; upgrade to Firey Special +Rs100.
    await mkDeal({
        name: 'Fireaway Wrap Lunch Deal',
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
    // Snack Special Rs1299 — Cheesy Garlic Bread (auto) + 5 wings or strips + 2 dips.
    await mkDeal({
        name: 'Snack Special',
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

    // Small Pizza Deal Rs725 — any small Classic/Signature pizza + 345ml drink.
    await mkDeal({
        name: 'Small Pizza Deal',
        description:
            '1 any Small (7") Classic or Signature pizza, 1 soft drink (345ml).',
        price: 725,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPizza.id,
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '7',
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

    // Medium Pizza Deal Rs1399 — any medium pizza + 2 × 345ml drink.
    await mkDeal({
        name: 'Medium Pizza Deal',
        description:
            '1 any Medium (9") Classic or Signature pizza, 2 soft drinks (345ml).',
        price: 1399,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPizza.id,
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '9',
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

    // Large Pizza Deal Rs1899 — any large pizza + 1L drink.
    await mkDeal({
        name: 'Large Pizza Deal',
        description:
            '1 any Large (12") Classic or Signature pizza, 1 soft drink (1L).',
        price: 1899,
        slots: [
            {
                type: 'choice_category',
                sourceCategoryId: catPizza.id,
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: '12',
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

    // Firestarter for 2 Rs2499 — large pizza + (garlic bread or 5 wings or 5 strips) + 2×345ml.
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
                slotSizeKey: '12',
            },
            {
                // "Cheesy Garlic Bread or 5 wings or 5 strips" — lock wings/strips to 5 pcs
                // (garlic bread has no size variants, so the lock is a no-op for it).
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

    // Pasta Deal Rs1049 — 1 pasta + 345ml drink.
    await mkDeal({
        name: 'Pasta Deal',
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

    // Pasta Basta Special Rs1499 — 1 pasta + cheesy garlic bread + 345ml drink.
    await mkDeal({
        name: 'Pasta Basta Special',
        description:
            '1 pasta, 1 Cheesy Garlic Bread, and 1 soft drink (345ml).',
        price: 1499,
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

    // Heaven Treat for 2 Rs2699 — large pizza + chocolate pizza + 2×345ml.
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
                slotSizeKey: '12',
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
    // Modeled as a deal so it NEVER bleeds onto other deals: the half-price is computed
    // inside the deal's own two pizza slots, not by the order-wide discount engine.
    // Dynamic pricing: full price of pizza 1 + the CHEAPER pizza at 50% off. The 2nd pizza
    // must be the SAME SIZE and SAME (strict) CATEGORY as the 1st — Classic↔Classic,
    // Signature↔Signature, Build-Your-Own↔Build-Your-Own. Large 12" / XLarge 14" only
    // (7"/10" excluded by allowedSizeKeys). Available all day, every day.
    const bogoPizzaIds = [
        ...classicPizzas.map((p) => p.id), // includes Margherita (label 'Classic')
        ...signaturePizzas.map((p) => p.id),
        byo.id,
    ];
    await mkDeal({
        name: BOGO_NAME,
        description:
            'Buy any Large 12" or XLarge 14" pizza and get a 2nd pizza of the same size and same category (Classic, Signature or Build Your Own) at HALF PRICE. Available all day, every day.',
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
                allowedSizeKeys: ['12', '14'],
            },
            {
                type: 'choice_list',
                sourceMenuItemIds: bogoPizzaIds,
                quantity: 1,
                allowCustomization: true,
                allowedSizeKeys: ['12', '14'],
                mirrorSlotIndex: 0,
                mirrorMatchSize: true,
                mirrorMatchCategory: true,
            },
        ],
    });

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
        `Seeded Fireaway real menu: ${allItems.length} items across 12 categories, ` +
            `linked to ${branches.length} branch(es). BOGO + lunch deals + wrap upsell included.`,
    );
    await dataSource.destroy();
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
