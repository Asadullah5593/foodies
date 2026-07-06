/**
 * Seed: REAL WOK&GO (Pakistan) menu — transcribed verbatim from the client's
 * "Foodies Master Menu WOK&GO.xlsx" → sheet "WOK&GO (App & EPOS)".
 *
 * NOTE on the workbook: that .xlsx is another copy of the Fireaway master template; ONLY the
 * (single visible) sheet "WOK&GO (App & EPOS)" (Country: Pakistan, Rs prices) is real WOK&GO
 * content. Every hidden sheet (UK/Scotland/Ireland/NL/Portugal/Turkey, "Additional Offers",
 * "Inputs", "Offer Buttons", "Offers") is leftover template data and is ignored.
 *
 * Uses the same capabilities as seed-fireaway-real.ts / seed-peri-peri-co-real.ts:
 *  - size variants + size_key (box Large/XL, wings & strips 5/10 pc, fries Reg/Large, drink sizes)
 *  - per-size selection limits (min/max_select_by_size): Express Box toppings — exactly 2 on
 *    a Large box, exactly 3 on XL (also correct inside the Large-locked deal slots)
 *  - "Make it Meal?" upsell as a modifier group with the drink ITEMISED via a conditional
 *    "Choose your Meal Drink" group (visible_when_modifier_ids on the paid meal options;
 *    soda = covered by the upgrade price, any milkshake = +Rs250)
 *  - deals (deal_components): choice_list slots with slotSizeKey='large' pinning boxes to Large
 *  - time-restricted Lunch Special (menu_item availability window, Mon–Fri 12:00–16:00)
 *  - hide_in_deals so a box's own "Make it Meal?" / paid drink groups don't double up in deals
 *
 * Faithful gaps (present on the sheet, not exactly expressible) — see the report to the client:
 *  - the sheet prices nothing per-channel ("Collection / In-store & Delivery" share one column);
 *  - Spring Rolls are named "4 Pcs" but described as "5 spring rolls" on the sheet — the name
 *    (4 Pcs) is kept and the count in the description follows the name;
 *  - Single Dip's description says "Ranch…" but the selectable option cells start with "Soy" —
 *    we follow the option cells (same template quirk as the Peperico sheet);
 *  - Kids Meal "Choose your cheese" header actually lists bases (noodles/rice) — template
 *    mislabel; seeded as "Choose your Base";
 *  - Kcal / Allergens columns are blank on the sheet → left null.
 *
 * Idempotent: clears this brand's existing menu (categories/items/groups/addons/deals), recreates it.
 * Run: npm run seed:wok-and-go-real   (requires `npm run seed` first for a tenant + branch)
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
import { DealComponent } from './entities/deal-component.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

const BRAND_SLUG = 'wok-and-go';
const BRAND_NAME = 'Wok & Go';

// ——— Shared option lists (straight from the sheet) ———
const SODAS = [
    'Coca-Cola',
    'Diet Coke',
    'Coca-Cola Zero',
    'Fanta Orange',
    'Sprite',
];
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
const MILKSHAKE_UPGRADE = 250; // "Upgrade to any milkshake - Add Rs 250"
const KIDS_SHAKE_UPGRADE = 200; // "Upgrade to small milkshake - Add Rs 200"
const MEAL_DRINK_345 = 130; // à-la-carte 345ml soda price
const LUNCH_DAYS = [1, 2, 3, 4, 5]; // "Monday to Friday"
const LUNCH_START = '12:00'; // "12:00-16:00 only"
const LUNCH_END = '16:00';

// Wings & strips flavours ("choice of 5 flavours" + Plain).
const WING_FLAVOURS = [
    'Plain',
    'BBQ Crunch',
    'Chilli Honey',
    'Teriyaki',
    'Heat Extreme',
    'Peri Peri',
];
// NOTE: the sheet's Single Dips description lists "Ranch, …, Tomato Ketchup" but the actual
// option cells start with "Soy" — we follow the selectable option cells.
const DIP_OPTIONS = [
    'Soy',
    'Garlic & Herb',
    'BBQ',
    'Sweet Chilli',
    'Tomato Ketchup',
    'Hot Peri-Peri',
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
                    'Fresh wok-tossed noodle & rice boxes and Asian street food.',
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
    console.log('Clearing existing Wok & Go menu for a clean re-seed…');
    await itemRepo.delete({ brandId }); // cascades variants, deal_components, m2m links, order_items
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
        dealOnly?: boolean;
        availableTimeStart?: string | null;
        availableTimeEnd?: string | null;
        availableDaysOfWeek?: number[] | null;
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
                availableTimeStart: opts.availableTimeStart ?? null,
                availableTimeEnd: opts.availableTimeEnd ?? null,
                availableDaysOfWeek: opts.availableDaysOfWeek ?? null,
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

    type ModDef = { name: string; price?: number };
    const mkGroup = async (
        name: string,
        cfg: {
            minSelect?: number;
            maxSelect?: number;
            minSelectBySize?: Record<string, number> | null;
            maxSelectBySize?: Record<string, number> | null;
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
                minSelectBySize: cfg.minSelectBySize ?? null,
                maxSelectBySize: cfg.maxSelectBySize ?? null,
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

    // Conditional visibility helper: return the ids of a group's PAID options, so a follow-up
    // drink chooser appears only once a paid upgrade is picked (not "No Drink" / "Just the Box").
    const paidModifierIds = async (group: ModifierGroup): Promise<number[]> => {
        const mods = await modifierRepo.find({
            where: { modifierGroupId: group.id },
        });
        return mods.filter((m) => Number(m.price) > 0).map((m) => m.id);
    };

    // ===================================================================
    // SHARED MODIFIER GROUPS
    // ===================================================================
    // "Make it Meal?" for Express Box / Pasta / Dirty Fries — mutually-exclusive priced meal
    // variants (sheet lists the same four options on all three). Hidden inside deals (the deal
    // supplies the drink through its own slots). NOTE: the "+Rs250 milkshake" upgrade below is
    // only offered on Express Box and Pasta — the Dirty Fries block has no milkshake line, so
    // Dirty Fries gets a soda-only chooser instead.
    const grpBoxMeal = await mkGroup(
        'Make it Meal?',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'No Drink' },
            { name: 'Meal with Drink', price: MEAL_DRINK_345 },
            { name: 'Meal (Fries + Drink)', price: 350 },
            { name: 'Meal (Spicy Fries + Drink)', price: 380 },
        ],
    );
    // Drink chooser that ITEMISES the meal's included drink. Sodas = free (covered by the meal
    // upgrade above); any milkshake = +Rs250 ("Upgrade to any milkshake - Add Rs 250", flavours
    // from the Milkshakes section). Optional (leave empty = no drink picked yet). Hidden in deals.
    const grpMealDrinkShake = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 0, maxSelect: 1, hideInDeals: true },
        [
            ...SODAS.map((s) => ({ name: `${s} 345ml` })),
            ...MILKSHAKES.map((m) => ({
                name: `${m} Milkshake`,
                price: MILKSHAKE_UPGRADE,
            })),
        ],
    );
    grpMealDrinkShake.visibleWhenModifierIds =
        await paidModifierIds(grpBoxMeal);
    await groupRepo.save(grpMealDrinkShake);
    // Soda-only variant of the above for Dirty Fries (its sheet block lists the four meal
    // options but NO "upgrade to any milkshake" line). Same trigger: grpBoxMeal's paid picks.
    const grpBoxMealDrinkSoda = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 0, maxSelect: 1, hideInDeals: true },
        SODAS.map((s) => ({ name: `${s} 345ml` })),
    );
    grpBoxMealDrinkSoda.visibleWhenModifierIds =
        await paidModifierIds(grpBoxMeal);
    await groupRepo.save(grpBoxMealDrinkSoda);

    // "Make it Meal" for Classic Boxes — "Just the box" or "Add a drink 345ml - Add Rs130".
    const grpClassicMeal = await mkGroup(
        'Make it Meal',
        { minSelect: 1, maxSelect: 1, hideInDeals: true },
        [
            { name: 'Just the Box' },
            { name: 'Add a 345ml Drink', price: MEAL_DRINK_345 },
        ],
    );
    // "(give choices from Drinks section)" — 345ml sodas, itemised, shown only on the paid pick.
    const grpMealDrinkSoda = await mkGroup(
        'Choose your Meal Drink',
        { minSelect: 0, maxSelect: 1, hideInDeals: true },
        SODAS.map((s) => ({ name: `${s} 345ml` })),
    );
    grpMealDrinkSoda.visibleWhenModifierIds =
        await paidModifierIds(grpClassicMeal);
    await groupRepo.save(grpMealDrinkSoda);

    // Paid drink cross-sell (Create Your Own) — "Note: Drink is not free. Every drink needs to
    // [be] charged", "Each drink can be selected multiple times all at an additional charge".
    // The sheet's Selection 8 lists the 345ml sodas +130, Water 500ml +75, and the same soda
    // range as 1L (Rs199) / 1.5L (Rs249).
    const grpAddDrinksPaid = await mkGroup(
        'Add a Drink(s)',
        { minSelect: 0, maxSelect: 12, allowQuantity: true, hideInDeals: true },
        [
            ...SODAS.map((s) => ({
                name: `${s} 345ml`,
                price: MEAL_DRINK_345,
            })),
            { name: 'Water 500ml', price: 75 },
            ...SODAS.map((s) => ({ name: `${s} 1L`, price: 199 })),
            ...SODAS.map((s) => ({ name: `${s} 1.5L`, price: 249 })),
        ],
    );

    // ===================================================================
    // CATEGORIES
    // ===================================================================
    const catDeals = await mkCategory('Deals');
    const catExpress = await mkCategory(
        'WOK&GO Express',
        "In a rush? Don't worry, we have you covered — get served in seconds with authentic dishes with multiple choices.",
    );
    const catBYO = await mkCategory(
        'Build Your Own',
        'All boxes include wok-toasted carrots, beansprouts, spring onions and egg (optional).',
    );
    const catClassics = await mkCategory('Classic Boxes');
    const catStreetFood = await mkCategory('Street Food');
    const catKids = await mkCategory('Kids Meal');
    const catPasta = await mkCategory('Pasta', 'Delicious fresh pastas');
    const catSides = await mkCategory('Classic Sides');
    const catWings = await mkCategory('Wings & Strips');
    const catDips = await mkCategory('Dips');
    const catDesserts = await mkCategory('Desserts');
    const catShakes = await mkCategory('Milkshakes');
    const catDrinks = await mkCategory('Drinks');

    // ===================================================================
    // WOK&GO EXPRESS — one box, two sizes, base + toppings + meal upsell.
    // ===================================================================
    const grpExpressBase = await mkGroup(
        'Choose your Base',
        { minSelect: 1, maxSelect: 1 },
        ['Chow Mein Noodles', 'Egg Fried Rice', 'Plain Rice', 'Fries'].map(
            (b) => ({
                name: b,
            }),
        ),
    );
    // Sheet rule: "Large Box - 2 Toppings / XL Box - 3 Toppings" — enforced exactly via the
    // per-size selection limits (min/max_select_by_size keyed by the box variants' sizeKey).
    // The flat 2–3 stays as the fallback for anything without a size.
    const grpExpressToppings = await mkGroup(
        'Choose your Toppings',
        {
            minSelect: 2,
            maxSelect: 3,
            minSelectBySize: { large: 2, xl: 3 },
            maxSelectBySize: { large: 2, xl: 3 },
        },
        [
            'Salt & Pepper Chicken',
            'Sticky Chilli Wings',
            "Sweet'n'Sour Chicken",
            'Chinese Chicken Curry',
            'Beef Black Bean',
            'Chicken Thai Curry',
            'Chinese Fish Curry',
        ].map((t) => ({ name: t })),
    );
    const expressBox = await mkItem({
        category: catExpress,
        name: 'WOK&GO Express Box',
        description:
            "In a rush? Don't worry, we have you covered — get served in seconds. Choose noodles or egg fried rice with your choice of chicken, beef or fish curries. Large box: 2 toppings · XL box: 3 toppings.",
        basePrice: 999,
        sizes: [
            {
                name: 'Large Box',
                sizeKey: 'large',
                price: 999,
                isDefault: true,
            },
            { name: 'XL Box', sizeKey: 'xl', price: 1199 },
        ],
    });
    await linkGroups(expressBox, [
        grpExpressBase,
        grpExpressToppings,
        grpBoxMeal,
        grpMealDrinkShake,
    ]);

    // ===================================================================
    // BUILD YOUR OWN ("CREATE YOUR OWN") — size + base + meat + veg + sauce + toppings + drinks.
    // ===================================================================
    const grpByoBase = await mkGroup(
        'Noodles or Rice?',
        { minSelect: 1, maxSelect: 1 },
        ['Egg Noodles', 'Vermicelli Noodles', 'Fried Rice', 'Plain Rice'].map(
            (b) => ({
                name: b,
            }),
        ),
    );
    const grpByoMeat = await mkGroup(
        'Choose Your Meat (max 2)',
        { minSelect: 0, maxSelect: 2 },
        ['Regular Chicken', 'Crispy Chicken', 'Beef', 'Prawn', 'Shrimp'].map(
            (m) => ({
                name: m,
            }),
        ),
    );
    const grpByoVeg = await mkGroup(
        'Choose Your Veggies (max 3)',
        { minSelect: 0, maxSelect: 3 },
        [
            'Broccoli',
            'Baby Corn',
            'Mangetout',
            'Mushroom',
            'Garden Peas',
            'Mixed Peppers',
            'Pineapple',
            'Tomato',
            'Extra Asian Veggies',
        ].map((v) => ({ name: v })),
    );
    const grpByoSauce = await mkGroup(
        'Choose Your Sauce (max 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Black Bean',
            'Oyster',
            'Hoisin',
            'Indonesian Nasi',
            'Pad Thai',
            'Soy Sauce',
            'Sweet Chilli',
            "Sweet'n'Sour",
            'Teriyaki',
            'Thai Green Curry',
            'Katsu Curry',
            'Sing-a-Sauce',
        ].map((s) => ({ name: s })),
    );
    const grpByoToppings = await mkGroup(
        'Add Toppings (max 2)',
        { minSelect: 0, maxSelect: 2 },
        [
            'Fried Garlic',
            'Coriander',
            'Fresh Chillies',
            'Mixed Sesame',
            'Crushed Peanuts',
        ].map((t) => ({ name: t })),
    );
    const byoBox = await mkItem({
        category: catBYO,
        name: 'Create Your Own',
        description:
            'Best to experience — create your own to fulfil your taste buds. All boxes include wok-toasted carrots, beansprouts, spring onions and egg (optional).',
        basePrice: 1199,
        sizes: [
            {
                name: 'Large Box',
                sizeKey: 'large',
                price: 1199,
                isDefault: true,
            },
            { name: 'XL Box', sizeKey: 'xl', price: 1399 },
        ],
    });
    await linkGroups(byoBox, [
        grpByoBase,
        grpByoMeat,
        grpByoVeg,
        grpByoSauce,
        grpByoToppings,
        grpAddDrinksPaid,
    ]);

    // ===================================================================
    // CLASSIC BOXES — 12 boxes, all Large Rs999 / XL Rs1199, each with the drink upsell.
    // ===================================================================
    const classicBoxDefs: Array<[string, string]> = [
        [
            'Hot Box',
            'Egg noodles, chicken, beef, broccoli, secret hot chilli sauce',
        ],
        [
            'Sweet Chilli Box',
            'Egg noodles, chicken, beef, broccoli, tomato, pineapple, our secret sweet chilli sauce',
        ],
        [
            'Combo Box',
            'Egg noodles, chicken, beef, shrimp, broccoli, oyster sauce',
        ],
        [
            'Pad Thai Box',
            'Egg noodles, chicken, broccoli, peanuts, pad thai sauce',
        ],
        [
            'Black Bean Box',
            'Egg noodles, crispy chicken, mixed peppers, broccoli, black bean sauce',
        ],
        [
            "Sweet 'N' Sour Box",
            "Egg noodles, crispy chicken, mixed peppers, broccoli, our secret sweet'n'sour sauce",
        ],
        [
            'Mee Gee Seafood Box',
            'Egg noodles, shrimp, mixed peppers, spicy Malaysian style sauce',
        ],
        [
            'Green Curry Box',
            'Egg noodles, chicken, broccoli, mixed peppers, thai green curry sauce',
        ],
        [
            'Nasi Seafood Box',
            'Egg fried rice, shrimp, mixed peppers, peas, broccoli, Indonesian nasi sauce',
        ],
        [
            'Hoisin Box',
            'Egg noodles, crispy chicken, broccoli, spring onions, hoisin sauce',
        ],
        [
            "Sing'A'Box",
            "Vermicelli noodles, chicken, broccoli, our sing'a'curry sauce",
        ],
        [
            'Chicken Teriyaki',
            'Egg noodles, chicken, broccoli, mixed peppers, our tasty teriyaki sauce',
        ],
    ];
    const classicBoxes: MenuItem[] = [];
    for (const [name, desc] of classicBoxDefs) {
        const box = await mkItem({
            category: catClassics,
            name,
            description: desc,
            basePrice: 999,
            sizes: [
                {
                    name: 'Large Box',
                    sizeKey: 'large',
                    price: 999,
                    isDefault: true,
                },
                { name: 'XL Box', sizeKey: 'xl', price: 1199 },
            ],
        });
        await linkGroups(box, [grpClassicMeal, grpMealDrinkSoda]);
        classicBoxes.push(box);
    }

    // ===================================================================
    // STREET FOOD — fixed-price items, no selections on the sheet.
    // ===================================================================
    const streetFoodDefs: Array<[string, string, number]> = [
        [
            'Chicken Katsu Curry Box',
            'Plain rice, katsu chicken, carrots, pickled cucumber, coriander, katsu curry sauce',
            1199,
        ],
        [
            "Salt'n'Pepper Crispy Shredded Chicken",
            "Egg fried rice, shredded chicken, onions, peppers, spring onions, chilli fried garlic, our salt'n'pepper spice, served with a pot of soy",
            1199,
        ],
        [
            'Peking Loaded Fries',
            'Hoisin chicken, cucumber, spring onions, fresh chilli loaded on our fries',
            799,
        ],
        [
            'Firecracker Fries',
            'Fries covered in a spicy sauce, coriander, fresh chillies and spring onions',
            599,
        ],
        [
            'Teriyaki Fries',
            'Fries, spring onions, sesame seeds with teriyaki sauce',
            599,
        ],
        [
            'Chinese Street Fries',
            'Fries, spring onions, coriander and Chinese 5 spice',
            599,
        ],
        [
            'WOK&GO Surprise Bag',
            'Crispy fried chicken tossed with chips, mixed vegetables and our secret herbs & spices',
            999,
        ],
        [
            'Chicken Chilli Dry',
            'Chicken, green peppers, onion, green chilli',
            699,
        ],
        [
            'Chicken Chow Mein Noodles',
            'Chicken, egg noodles, green pepper, onion, white cabbage, carrot',
            999,
        ],
    ];
    for (const [name, desc, price] of streetFoodDefs) {
        await mkItem({
            category: catStreetFood,
            name,
            description: desc,
            basePrice: price,
        });
    }

    // ===================================================================
    // KIDS MEAL — Rs699 mini combo box + fries + drink.
    // ===================================================================
    // Sheet's "Choose your cheese" header is a template mislabel — the options are bases.
    const grpKidsBase = await mkGroup(
        'Choose your Base',
        { minSelect: 1, maxSelect: 1 },
        ['Egg Noodles', 'Fried Rice', 'Plain Rice'].map((b) => ({ name: b })),
    );
    const grpKidsMeat = await mkGroup(
        'Choose your Meat',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Chicken' }, { name: 'Beef' }],
    );
    const grpKidsVeg = await mkGroup(
        'Veg Toppings (max 2)',
        { minSelect: 0, maxSelect: 2 },
        ['Mushroom', 'Mixed Peppers', 'Sweet Corn'].map((v) => ({ name: v })),
    );
    const grpKidsFries = await mkGroup(
        'Fries',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'Regular Fries' }, { name: 'Large Fries', price: 200 }],
    );
    // Included drink, itemised: juices/water free, or upgrade to a small milkshake +Rs200.
    const grpKidsDrink = await mkGroup(
        'Choose your Drink',
        { minSelect: 1, maxSelect: 1 },
        [
            { name: 'Orange Juice' },
            { name: 'Mango Juice' },
            { name: 'Water' },
            ...MILKSHAKES.map((m) => ({
                name: `Small ${m} Milkshake`,
                price: KIDS_SHAKE_UPGRADE,
            })),
        ],
    );
    const kidsMeal = await mkItem({
        category: catKids,
        name: 'Kids Meal',
        description:
            'Kids mini combo box, fries and drink (includes fries + juice drink)',
        basePrice: 699,
    });
    await linkGroups(kidsMeal, [
        grpKidsBase,
        grpKidsMeat,
        grpKidsVeg,
        grpKidsFries,
        grpKidsDrink,
    ]);

    // ===================================================================
    // PASTA — Rs949 each, with the same "Make it Meal?" upsell as the Express Box.
    // ===================================================================
    const pastaDefs: Array<[string, string]> = [
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
            'Pasta tossed with a creamy carbonara sauce, topped with chicken and parmesan.',
        ],
        [
            'Chicken Arrabiata',
            'Tender chicken, earthy mushrooms, and tangy tomatoes tossed with pasta in a flavourful herb-infused sauce.',
        ],
    ];
    for (const [name, desc] of pastaDefs) {
        const pasta = await mkItem({
            category: catPasta,
            name,
            description: desc,
            basePrice: 949,
        });
        await linkGroups(pasta, [grpBoxMeal, grpMealDrinkShake]);
    }

    // ===================================================================
    // CLASSIC SIDES
    // ===================================================================
    await mkItem({
        category: catSides,
        name: 'Spring Rolls (4 Pcs)',
        description: 'Freshly fried spring rolls',
        basePrice: 599,
    });
    await mkItem({
        category: catSides,
        name: "Hot'n'Kickin Chicken Wings",
        description:
            '5 freshly fried chicken wings coated in hot & spicy sauce',
        basePrice: 599,
    });
    await mkItem({
        category: catSides,
        name: "Sweet'n'Sour Chicken Balls",
        description:
            "5 freshly fried boneless chicken balls coated in sweet'n'sour sauce",
        basePrice: 599,
    });
    await mkItem({
        category: catSides,
        name: 'Mini Sides Platter',
        description:
            "Reg fries, 2 spring rolls, 2 hot'n'kickin chicken wings, 2 popcorn chicken balls",
        basePrice: 799,
    });
    await mkItem({
        category: catSides,
        name: 'Mixed Side Platter',
        description:
            "Reg fries, 2 spring rolls, 2 hot'n'kickin chicken wings, 2 popcorn chicken balls, 2 sweet'n'sour chicken balls",
        basePrice: 899,
    });
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

    // Create Your Dirty Fries — cheese + 2 meats (same meat twice allowed) + meal upsell.
    const grpDirtyCheese = await mkGroup(
        'Choose your Cheese',
        { minSelect: 1, maxSelect: 1 },
        [{ name: 'As it Comes' }, { name: 'No Cheese' }],
    );
    // "Customers can select a maximum of 2 toppings, either 2 different or the same topping
    // twice" → choose exactly 2 units, repeats allowed via the qty stepper.
    const grpDirtyMeat = await mkGroup(
        'Choose your Meat (choose 2)',
        { minSelect: 2, maxSelect: 2, allowQuantity: true },
        [
            'Chicken',
            'Beef',
            'Chicken Muglai',
            'Chicken Fajita',
            'Chicken Tikka',
            'Peri Peri Chicken',
        ].map((m) => ({ name: m })),
    );
    const dirtyFries = await mkItem({
        category: catSides,
        name: 'Create Your Dirty Fries',
        description: 'Chips with your choice of cheese and 2 meats',
        basePrice: 899,
    });
    await linkGroups(dirtyFries, [
        grpDirtyCheese,
        grpDirtyMeat,
        grpBoxMeal,
        grpBoxMealDrinkSoda,
    ]);

    // ===================================================================
    // WINGS & STRIPS — 5/10 pc size variants + one flavour.
    // ===================================================================
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

    // ===================================================================
    // DIPS — pick 1 / exactly 2 / exactly 3 (same dip repeatable via qty stepper).
    // ===================================================================
    const grpPick1Dip = await mkGroup(
        'Choose your Dip',
        { minSelect: 1, maxSelect: 1 },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const grpPick2Dip = await mkGroup(
        'Choose 2 Dips',
        { minSelect: 2, maxSelect: 2, allowQuantity: true },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const grpPick3Dip = await mkGroup(
        'Choose 3 Dips',
        { minSelect: 3, maxSelect: 3, allowQuantity: true },
        DIP_OPTIONS.map((d) => ({ name: d })),
    );
    const singleDip = await mkItem({
        category: catDips,
        name: 'Single Dip',
        description:
            'Choose from: Soy, Garlic & Herb, BBQ, Sweet Chilli, Tomato Ketchup, Hot Peri-Peri',
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
    // DESSERTS (prices come from the description text on the sheet)
    // ===================================================================
    const COOKIE_FLAVOURS = [
        'Chocolate Cookies',
        'Triple Chocolate',
        'Pistachio',
        'Lotus',
        'Red Velvet',
    ];
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

    const sodas345 = SODAS.map((f) => drinkItems[`${f} 345ml`].id);

    // ===================================================================
    // DEALS (deal = MenuItem in "Deals" category + deal_components)
    // ===================================================================
    const mkDeal = async (opts: {
        name: string;
        description: string;
        price: number;
        lunch?: boolean;
        slots: Array<{
            type: 'fixed' | 'choice_category' | 'choice_list';
            sourceMenuItemId?: number | null;
            sourceCategoryId?: number | null;
            sourceMenuItemIds?: number[] | null;
            quantity?: number;
            optional?: boolean;
            allowCustomization?: boolean;
            slotSurcharges?: Record<string, number> | null;
            slotSizeKey?: string | null;
        }>;
    }) => {
        const deal = await mkItem({
            category: catDeals,
            name: opts.name,
            description: opts.description,
            basePrice: opts.price,
            availableTimeStart: opts.lunch ? LUNCH_START : null,
            availableTimeEnd: opts.lunch ? LUNCH_END : null,
            availableDaysOfWeek: opts.lunch ? LUNCH_DAYS : null,
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
                    slotSizeKey: s.slotSizeKey ?? null,
                    allowedSizeKeys: null,
                    mirrorSlotIndex: null,
                    mirrorMatchSize: false,
                    mirrorMatchCategory: false,
                }),
            );
        }
        return deal;
    };

    // "Choose your box … from any large Classic Box or … WOK&GO Express Boxes" — one slot
    // over Classics + Express, pinned to the Large variant. Customization keeps the Express
    // base/toppings choosers (its meal groups are hidden via hideInDeals).
    const largeBoxSlot = () => ({
        type: 'choice_list' as const,
        sourceMenuItemIds: [...classicBoxes.map((b) => b.id), expressBox.id],
        quantity: 1,
        allowCustomization: true,
        slotSizeKey: 'large',
    });
    // "Choose your drink — give options of 345ml drinks from drinks section" (included).
    const drink345Slot = () => ({
        type: 'choice_list' as const,
        sourceMenuItemIds: sodas345,
        quantity: 1,
        allowCustomization: false,
    });

    await mkDeal({
        name: 'Any Large Box with Drink',
        description:
            'Get any of our large boxes from our Classic range or our Express boxes with a 345ml drink.',
        price: 1099,
        slots: [largeBoxSlot(), drink345Slot()],
    });

    await mkDeal({
        name: 'Deal for 2 — Two Large Boxes and 2 Drinks',
        description:
            'Get two of our large boxes from our Classic range or our Express boxes with two 345ml drinks.',
        price: 1999,
        slots: [largeBoxSlot(), largeBoxSlot(), drink345Slot(), drink345Slot()],
    });

    // Lunch Special — Express Large box + 345ml drink, Mon–Fri 12:00–16:00 only.
    await mkDeal({
        name: 'Lunch Special',
        description:
            'Get a large box from our tasty WOK&GO Express menu with a 345ml drink. Monday to Friday, 12:00–16:00 only.',
        price: 999,
        lunch: true,
        slots: [
            {
                type: 'choice_list',
                sourceMenuItemIds: [expressBox.id],
                quantity: 1,
                allowCustomization: true,
                slotSizeKey: 'large', // "Only one Large box."
            },
            drink345Slot(),
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
        `Seeded Wok & Go real menu: ${allItems.length} items across 13 categories, ` +
            `linked to ${branches.length} branch(es). 3 deals (incl. time-windowed Lunch Special) ` +
            `+ itemised meal-drink upsells included.`,
    );
    await dataSource.destroy();
}

seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
});
