/**
 * The Pine Avenue flyer menu (Aug 2026) — source of truth for the switch.
 *
 * Transcribed from "Foodies Menu.pdf" (both pages). Where the flyer is silent
 * (option groups, deal internals) the live item's configuration is cloned via
 * `from`; the flyer's explicit statements override it.
 *
 * ASSUMPTIONS (flagged to the client):
 *  - The printed Drinks box (Pepsi / 7Up / Mirinda 345ml Rs130, 1.5L Rs250,
 *    Water 500ml Rs75) is shared by all four brands — only the Wok & Go
 *    column prints it.
 *  - Coffee Hot/Cold is the same price (one price per coffee on the flyer).
 *  - "From the Sea" boxes reuse names from Classic Meals; a suffix is added so
 *    kitchen tickets can tell fish/prawn from chicken.
 *  - Cake slices carry a " Slice" suffix for the same reason.
 */
import type {
    FlyerBrand,
    FlyerCategory,
    FlyerItem,
    GroupOverride,
} from './types';

// ——— Shared drinks (flyer Drinks box) ———
export const SODAS = ['Pepsi', '7Up', 'Mirinda'];
const SODA_345 = SODAS.map((s) => `${s} 345ml`);
const SODA_15L = SODAS.map((s) => `${s} 1.5L`);

const drinksCategory = (): FlyerCategory => ({
    name: 'Drinks',
    items: [
        ...SODAS.map((s) => ({ name: `${s} 345ml`, price: 130, from: null })),
        ...SODAS.map((s) => ({ name: `${s} 1.5L`, price: 250, from: null })),
        { name: 'Water 500ml', price: 75, from: null },
    ],
});

/** Paid drink cross-sell options (pizzas, rice) — the flyer drink list at full price. */
const PAID_DRINK_OPTIONS = [
    ...SODAS.map((s) => ({ name: `${s} 345ml`, price: 130 })),
    ...SODAS.map((s) => ({ name: `${s} 1.5L`, price: 250 })),
    { name: 'Water 500ml', price: 75 },
];
/** Included meal-drink chooser — a 345ml soda, no upcharge. */
const MEAL_DRINK_OPTIONS = SODA_345.map((name) => ({ name }));

const DRINK_GROUP_OVERRIDES: GroupOverride[] = [
    { match: 'Add a drink(s)', modifiers: PAID_DRINK_OPTIONS },
    { match: 'Add a Drink(s)', modifiers: PAID_DRINK_OPTIONS },
    { match: 'Choose your Meal Drink', modifiers: MEAL_DRINK_OPTIONS },
];

// ===================================================================
// FIREAWAY
// ===================================================================
const pizza = (
    name: string,
    price: number,
    description: string,
    from?: string,
): FlyerItem => ({
    name,
    price,
    description,
    from: from ?? name,
    variants: [{ name: '12"', sizeKey: '12', price, isDefault: true }],
    addons: ['Add Fries'],
});

const FIREAWAY: FlyerBrand = {
    slug: 'fireaway',
    name: 'Fireaway',
    addons: [{ name: 'Add Fries', price: 199 }],
    groupOverrides: DRINK_GROUP_OVERRIDES,
    categories: [
        {
            name: 'Classic',
            description: '12" Rs. 1749',
            items: [
                pizza(
                    'Twisted Hawaii Pizza',
                    1749,
                    'Tomato base, Mozzarella, Chicken, Pineapple',
                    'Twisted Hawaiian Pizza',
                ),
                pizza(
                    'Veggie Supreme Pizza',
                    1749,
                    'Tomato base, Mozzarella, Onions, Mixed peppers, Sweetcorn, Mushrooms, Olives.',
                ),
                pizza(
                    'Fiery Chicken Pizza',
                    1749,
                    'Spicy Tomato base, Mozzarella, Chicken Tikka, Peri Peri Chicken, Red Onions, Mushrooms',
                    'Fireaway Special Pizza',
                ),
                pizza(
                    'Chicken Tikka Pizza',
                    1749,
                    'Tomato base, Mozzarella, Chicken Tikka, Peppers, Onions, Jalapeños',
                ),
                pizza(
                    'Chicken Mughlai Pizza',
                    1749,
                    'Tomato base, Mozzarella, Chicken Mughlai, Chicken Fajita, Onions, Jalapeños.',
                    'Chicken Muglai Pizza',
                ),
                pizza(
                    'Margherita',
                    1499,
                    'Tomato base and Mozzarella',
                    'Margherita Pizza',
                ),
            ],
        },
        {
            name: 'Signature',
            description: '12" Rs. 1949',
            items: [
                pizza(
                    'Fireaway Special Pizza',
                    1949,
                    'BBQ base, Mozzarella, Red Onions, Peppers, Sweetcorn, Jalapeños, Fajita Chicken.',
                ),
                pizza(
                    'King Pepperoni Pizza',
                    1949,
                    'Tomato base, Mozzarella, loaded with Pepperoni.',
                ),
                pizza(
                    'Chicken Pesto Manifesto',
                    1949,
                    'Pesto base sauce, Chicken with Herbs, Peppers, Onions, Sun-dried Tomatoes',
                    'Chicken Pesto Menifesto',
                ),
                pizza(
                    'Meat Heaven Pizza',
                    1949,
                    'Tomato base, Mozzarella, Chicken Fajita, Sausages, Chicken Pepperoni, Onions, Green Peppers',
                ),
                pizza(
                    'Sausage Special Pizza',
                    1949,
                    'Tomato base, Mozzarella, Sausages, Onions, Jalapeños, Mushrooms',
                ),
                pizza(
                    'Peri Peri Special',
                    1949,
                    'Peri Peri Tomato base, Mozzarella, Peri Peri Chicken, Jalapeños, Chillies',
                ),
            ],
        },
        {
            name: 'Sides',
            items: [
                { name: 'Plain Fries', price: 299, from: null },
                { name: 'Garlic Cheese Fries', price: 499, from: null },
                { name: 'Spicy Fries', price: 349, from: null },
            ],
        },
        drinksCategory(),
    ],
};

// ===================================================================
// PEPERI.CO
// ===================================================================
const burger = (
    name: string,
    price: number,
    description: string,
    from?: string,
): FlyerItem => ({
    name,
    price,
    description,
    from: from ?? name,
});

const PEPERICO: FlyerBrand = {
    slug: 'peperi-co',
    name: 'Peperi Co',
    groupOverrides: [
        ...DRINK_GROUP_OVERRIDES,
        // Flyer: "Add Fries & drink to any deal for only Rs. 350" — one upsell, one price.
        {
            match: 'Make it a Meal?',
            modifiers: [
                { name: 'As it is' },
                { name: 'Add Fries & Drink', price: 350 },
            ],
        },
        // Flyer: "Wraps come with lettuce, onion, tomatos, jalapeno, chipotle sauce."
        {
            match: 'Remove a Filling',
            modifiers: [
                'Lettuce',
                'Onion',
                'Tomato',
                'Jalapeno',
                'Chipotle Sauce',
            ].map((name) => ({ name })),
            cfg: { minSelect: 0, maxSelect: 5 },
        },
    ],
    categories: [
        {
            name: 'Deals',
            items: [
                {
                    name: '1/4 Chicken + 1 Classic Side + 1 Drink',
                    price: 1099,
                    description:
                        'Our famous juicy grilled chicken with secret herbs & special blend of sauces, with a classic side and a drink.',
                    from: null,
                    slots: [
                        {
                            type: 'fixed',
                            item: '1/4 Peri Peri Chicken',
                            qty: 1,
                        },
                        {
                            type: 'choice_category',
                            category: 'Classic Sides',
                            qty: 1,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 1,
                            customize: false,
                        },
                    ],
                },
                {
                    name: '1/2 Chicken + 2 Classic Sides + 2 Drinks',
                    price: 1999,
                    description:
                        'Our famous juicy grilled chicken with secret herbs & special blend of sauces, with two classic sides and two drinks.',
                    from: null,
                    slots: [
                        {
                            type: 'fixed',
                            item: '1/2 Peri Peri Chicken',
                            qty: 1,
                        },
                        {
                            type: 'choice_category',
                            category: 'Classic Sides',
                            qty: 2,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 2,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Full Chicken + 4 Classic Sides + 1.5 Ltr Drink',
                    price: 3499,
                    description:
                        'Our famous juicy grilled chicken with secret herbs & special blend of sauces, with four classic sides and a 1.5 litre drink.',
                    from: null,
                    slots: [
                        {
                            type: 'fixed',
                            item: 'Full Peri Peri Chicken',
                            qty: 1,
                        },
                        {
                            type: 'choice_category',
                            category: 'Classic Sides',
                            qty: 4,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_15L,
                            qty: 1,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Peri Peri Chicken & Rice Deal',
                    price: 1099,
                    description:
                        '1/4 Peri Peri Chicken on peri peri rice, with a drink.',
                    from: null,
                    slots: [
                        {
                            type: 'fixed',
                            item: 'Peri Peri Chicken Rice (1/4 chicken)',
                            qty: 1,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 1,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Boneless Chicken Box with Chips and Drink',
                    price: 999,
                    description:
                        '5 Pieces of boneless fried chicken with large fries, with choice of sauce and a drink.',
                    from: null,
                    slots: [
                        { type: 'fixed', item: 'Fried Chicken Box', qty: 1 },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 1,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Peri Peri Burger Meal for 2',
                    price: 1999,
                    description: '2 Peri Peri Burgers, 2 Chips, 2 Drinks',
                    from: null,
                    slots: [
                        {
                            type: 'fixed',
                            item: 'Peperico Special Burger',
                            qty: 1,
                        },
                        {
                            type: 'fixed',
                            item: 'Peperico Special Burger',
                            qty: 1,
                        },
                        {
                            type: 'fixed',
                            item: 'Regular Fries',
                            qty: 2,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 2,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Crispy Burger Deal for 2',
                    price: 1799,
                    description: '2 Crispy Chicken Burgers, 2 Chips + 2 Drinks',
                    from: null,
                    slots: [
                        {
                            type: 'choice_list',
                            items: [
                                'Crispy Blaze',
                                'Spicy Sizzler',
                                'Crispy Tower',
                                'Spicy Sizzler Tower',
                                'Snap Chick',
                            ],
                            qty: 1,
                        },
                        {
                            type: 'choice_list',
                            items: [
                                'Crispy Blaze',
                                'Spicy Sizzler',
                                'Crispy Tower',
                                'Spicy Sizzler Tower',
                                'Snap Chick',
                            ],
                            qty: 1,
                        },
                        {
                            type: 'fixed',
                            item: 'Regular Fries',
                            qty: 2,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 2,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Wild Mushroom Smashed Deal',
                    price: 1399,
                    description:
                        'Wild Mushroom Smashed burger with fries and a drink.',
                    from: null,
                    slots: [
                        {
                            type: 'fixed',
                            item: 'Wild Mushroom Smashed',
                            qty: 1,
                        },
                        {
                            type: 'fixed',
                            item: 'Regular Fries',
                            qty: 1,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 1,
                            customize: false,
                        },
                    ],
                },
                {
                    name: 'Old & Gold Smashed Deal',
                    price: 1249,
                    description:
                        'Old & Gold Smashed burger with fries and a drink.',
                    from: null,
                    slots: [
                        { type: 'fixed', item: 'Old & Gold Smashed', qty: 1 },
                        {
                            type: 'fixed',
                            item: 'Regular Fries',
                            qty: 1,
                            customize: false,
                        },
                        {
                            type: 'choice_list',
                            items: SODA_345,
                            qty: 1,
                            customize: false,
                        },
                    ],
                },
            ],
        },
        {
            name: 'Peri Peri Special',
            items: [
                burger(
                    'Peperico Special Burger',
                    899,
                    'Special blend of peri peri grilled burger with lettuce, tomato, onion, jalapeños and our special burger sauce.',
                ),
            ],
        },
        {
            name: 'Beef Smashed Special',
            items: [
                burger(
                    'Smashed Classic',
                    999,
                    'Juicy beef, cheese, sauteed onion, pickle & our secret sauce',
                ),
                burger(
                    'Wild Mushroom Smashed',
                    1099,
                    'Smashed beef with wild mushrooms, sauteed onions, cheese, our secret sauce',
                ),
                burger(
                    'California Smash',
                    1299,
                    '2 perfectly smashed grilled beef patties with double cheese & double sauteed onion, pickle & double sauce',
                ),
                burger(
                    'Saucy Pine Smashed',
                    1099,
                    'A perfectly grilled pineapple with smashed beef, lettuce, sauteed onions, tomato and our secret burger sauce',
                ),
                burger(
                    'Old & Gold Smashed',
                    999,
                    'Perfectly smashed beef & cheese with fresh lettuce, sauteed onions, tomato, pickle and our secret burger sauce',
                ),
            ],
        },
        {
            name: 'Chicken Burgers',
            items: [
                burger(
                    'Crispy Blaze',
                    699,
                    'Our best fried chicken with iceberg lettuce & mayo',
                ),
                burger(
                    'Spicy Sizzler',
                    699,
                    'Our special spicy fried chicken, lettuce, jalapenos & chipotle sauce',
                ),
                burger(
                    'Crispy Tower',
                    899,
                    'Double the crisp with fresh lettuce and mayo',
                    'Crisp Tower',
                ),
                burger(
                    'Spicy Sizzler Tower',
                    899,
                    'Double the sizzler, lettuce, jalapenos & chipotle sauce',
                    'Sizzler Tower',
                ),
                burger('Snap Chick', 399, 'Chicken with lettuce & mayo'),
            ],
        },
        {
            name: 'Special Supreme Burgers',
            items: [
                burger(
                    'Supreme Smashed',
                    1399,
                    'Grilled pineapple with 2 smashed beef patties, mushrooms, sauteed onions, pickle, cheese and our special sauce',
                ),
                burger(
                    'Supreme Combo',
                    1099,
                    'Smashed beef + peri peri grilled burger with lettuce, tomatoes, fresh onion, jalapenos and our burger sauce',
                ),
                burger(
                    'Kiwi Kick',
                    1199,
                    'Smashed beef with fried egg, cheese, lettuce, tomato, sauteed onion, jalapenos & burger sauce',
                ),
            ],
        },
        {
            name: 'Kids',
            items: [
                {
                    name: 'Kids Meal',
                    price: 799,
                    description:
                        'Kids Chicken Burger or 6 Pcs Nuggets with small fries and drink.',
                },
            ],
        },
        {
            name: 'Wraps',
            description:
                'Wraps come with lettuce, onion, tomatos, jalapeno, chipotle sauce.',
            items: [
                {
                    name: 'Krunchy Chicken',
                    price: 699,
                    description:
                        'Krunchy chicken wrap with lettuce, onion, tomato, jalapeno and chipotle sauce.',
                    from: 'Krunchy Chicken Wrap',
                },
            ],
        },
        {
            name: 'Peri Peri Chicken',
            description:
                'Choose your sauce: Mild, Medium, Hot, Lemon & Herb, Mango & Lime',
            items: [
                {
                    name: '1/4 Peri Peri Chicken',
                    price: 699,
                    description: 'Quarter Flame Grilled Peri Peri Chicken',
                },
                {
                    name: '1/2 Peri Peri Chicken',
                    price: 1299,
                    description: 'Half Flame Grilled Peri Peri Chicken',
                },
                {
                    name: 'Full Peri Peri Chicken',
                    price: 2499,
                    description: 'Full Flame Grilled Peri Peri Chicken',
                },
                // Deal-only building blocks (not printed as standalone items).
                {
                    name: 'Peri Peri Chicken Rice (1/4 chicken)',
                    price: 999,
                    description: '1/4 Peri Peri Chicken on peri peri rice',
                    dealOnly: true,
                    excludeGroups: ['Add a Drink(s)'],
                },
                {
                    name: 'Fried Chicken Box',
                    price: 0,
                    description:
                        '5 pieces of boneless fried chicken on large fries with choice of sauce',
                    dealOnly: true,
                },
            ],
        },
        {
            name: 'Classic Sides',
            items: [
                { name: 'Regular Fries', price: 299, from: null },
                { name: 'Peri Peri Rice', price: 299, from: null },
            ],
        },
        {
            name: 'Premium Sides',
            items: [
                {
                    name: 'Dirty Fries',
                    price: 799,
                    description:
                        'Chips with grilled peri peri chicken with cheese and peri peri sauce.',
                    from: 'Create Your Dirty Fries',
                },
                {
                    name: 'Peri Peri Fries',
                    price: 349,
                    description: 'Chips with our secret spices',
                    from: null,
                },
                { name: 'Cheesy Garlic Fries', price: 499, from: null },
            ],
        },
        drinksCategory(),
    ],
};

// ===================================================================
// WOK & GO
// ===================================================================
const box = (
    name: string,
    price: number,
    description: string,
    from: string,
    excludeGroups?: string[],
): FlyerItem => ({
    name,
    price,
    description,
    from,
    excludeGroups,
    variants: [{ name: 'Large Box', sizeKey: 'large', price, isDefault: true }],
});

const WOK_AND_GO: FlyerBrand = {
    slug: 'wok-and-go',
    name: 'Wok & Go',
    groupOverrides: DRINK_GROUP_OVERRIDES,
    categories: [
        {
            name: 'Classic Meals',
            description:
                'Large Box Rs. 1,449 — choose your base: Noodles / Egg Fried Rice',
            items: [
                box(
                    'Hot & Spicy',
                    1449,
                    'Chicken, broccoli, secret hot chilli sauce',
                    'Hot and Spicy',
                ),
                box(
                    'Sweet Chilli',
                    1449,
                    'Chicken, broccoli, tomato, pineapple, our secret sweet chilli sauce',
                    'Sweet Chilli Box',
                ),
                box(
                    'Szechuan Special',
                    1449,
                    'Chicken, mixed peppers, onions with our special Szechuan sauce',
                    'Szechuan Special',
                    ['Chicken Or Shrimp'],
                ),
                box(
                    'Pad Thai',
                    1449,
                    'Chicken, broccoli, peanuts, pad thai sauce',
                    'Pad Thai Box',
                ),
                box(
                    'Black Bean',
                    1449,
                    'Crispy chicken, mixed peppers, broccoli, black bean sauce',
                    'Black Bean Box',
                ),
                box(
                    "Sweet 'N' Sour",
                    1449,
                    "Crispy chicken, mixed peppers, broccoli, our secret sweet'n'sour sauce",
                    "Sweet 'N' Sour Box",
                ),
                box(
                    'Green Curry',
                    1449,
                    'Chicken, broccoli, mixed peppers, thai green curry sauce',
                    'Green Curry Box',
                ),
                box(
                    'Hoisin Special',
                    1449,
                    'Crispy chicken, broccoli, spring onions, hoisin sauce',
                    'Hoisin Box',
                ),
                box(
                    'Chicken Teriyaki',
                    1449,
                    'Chicken, broccoli, mixed peppers, our tasty teriyaki sauce',
                    'Chicken Teriyaki',
                ),
            ],
        },
        {
            name: 'From the Sea',
            description: 'Large Box Rs. 1,749',
            items: [
                box(
                    'Spicy Sea Food',
                    1749,
                    'Shrimp, mixed peppers, spicy Malaysian-style sauce',
                    'Spicy Seafood Box',
                ),
                box(
                    'Szechuan Special (Fish)',
                    1749,
                    'Fish, mixed peppers, onions with our special Szechuan sauce',
                    'Spicy Seafood Box',
                ),
                box(
                    'Hot & Spicy (Prawn)',
                    1749,
                    'Prawn, broccoli, secret hot chilli sauce',
                    'Spicy Seafood Box',
                ),
                box(
                    'Hoisin Special (Crispy Fish)',
                    1749,
                    'Crispy fish, broccoli, spring onions, hoisin sauce',
                    'Spicy Seafood Box',
                ),
            ],
        },
        {
            name: 'Street Food',
            items: [
                {
                    name: "Salt'n'Pepper Crispy Shredded Chicken",
                    price: 1449,
                    description:
                        "Egg fried rice, shredded chicken, onions, peppers, spring onions, chilli fried garlic, our salt'n'pepper spice.",
                    from: null,
                },
                {
                    name: 'Peking Loaded Fries',
                    price: 1349,
                    description:
                        'Hoisin chicken, spring onions, fresh chilli, loaded onto our fries.',
                    from: null,
                },
                {
                    name: 'Firecracker Fries (VE)',
                    price: 999,
                    description:
                        'Fries covered in a spicy sauce, coriander, fresh chillies and spring onions.',
                    from: null,
                },
                {
                    name: 'Teriyaki Fries (VE)',
                    price: 1099,
                    description:
                        'Fries, spring onions, sesame seeds with teriyaki sauce.',
                    from: null,
                },
                {
                    name: 'Chicken Chilli Dry',
                    price: 1199,
                    description:
                        'Crispy fried chicken tossed with chips, mixed vegetables and our secret herbs & spices.',
                    from: null,
                },
                {
                    name: 'Chicken Chow Mein Noodles',
                    price: 999,
                    description:
                        'Chicken, noodles, green pepper, onion, white cabbage, carrot',
                    from: null,
                },
            ],
        },
        drinksCategory(),
    ],
};

// ===================================================================
// LORANZO
// ===================================================================
const coffee = (name: string, price: number, from?: string): FlyerItem => ({
    name,
    price,
    from: from ?? name,
});
const flat = (
    name: string,
    price: number,
    from?: string | null,
): FlyerItem => ({ name, price, from: from === undefined ? name : from });

const LORANZO: FlyerBrand = {
    slug: 'loranzo',
    name: 'Loranzo',
    groupOverrides: DRINK_GROUP_OVERRIDES,
    categories: [
        {
            name: 'Coffee',
            description: 'Choose Between Hot or Cold, Always Bold',
            items: [
                coffee('Cortado', 799),
                coffee('Espresso', 699),
                { name: 'Cappuccino', price: 799, description: 'Hot only' },
                coffee('Flat White', 799),
                coffee('Cafe Latte', 799, 'Café Latte'),
                coffee('Affogato', 899),
                coffee('Honey Latte', 899),
                coffee('Caramel Latte', 899),
                coffee('Vanilla Latte', 899),
                coffee('Coconut Latte', 899),
                coffee('Mocha Latte', 899),
                coffee('White Mocha', 899),
                coffee('Spanish Latte', 999),
                coffee('Pistachio Latte', 999),
                { name: 'Hot Chocolate', price: 899 },
                {
                    name: 'Tonic Espresso',
                    price: 999,
                    description: 'Only cold',
                },
                { name: 'Espresso Soda', price: 999, description: 'Only cold' },
            ],
        },
        {
            name: 'Iced Tea',
            items: [
                flat('Peach Ice Tea', 649),
                flat('Strawberry Ice Tea', 649),
                flat('Lemon Ice Tea', 649),
            ],
        },
        {
            name: 'Cake Slices',
            items: [
                flat('Blueberry Cheesecake Slice', 699, 'Cheese Cake Slice'),
                flat('Cadbury Chocolate Slice', 599, 'Cadburry Fudge Slice'),
                flat('Lotus Slice', 599),
            ],
        },
        {
            name: 'Desserts',
            items: [
                {
                    name: 'Brownie',
                    price: 499,
                    description: 'Chocolate / Fudge',
                },
                {
                    name: 'Cookie and Cream',
                    price: 799,
                    description: 'Chocolate / Nutella / Kunafa',
                },
                { name: 'Pistachio Kunafa', price: 799, from: null },
            ],
        },
        {
            name: 'Loranzo Frappe Specials',
            items: [
                flat('Frappuccino', 999),
                flat('Coconut Frappe', 999),
                flat('Hazelnut Frappe', 999),
                flat('Vanilla Frappe', 999),
                flat('Caramel Frappe', 999),
                flat('Mocha Frappe', 999),
                flat('Biscoff Frappe', 999),
                flat('Oreo Frappe', 999),
            ],
        },
        {
            name: 'Milkshakes',
            items: [
                flat('Oreo Milkshake', 899),
                flat('Nutella Milkshake', 899, null),
                flat('Strawberry Milkshake', 899),
                flat('Chocolate Milkshake', 899),
                flat('Pistachio Milkshake', 899),
                flat('Lotus Biscoff Milkshake', 899),
            ],
        },
        {
            name: 'Lemonades',
            items: [
                flat('Sunset Strawberry Lemonade', 599),
                flat('Blue Berry Fizz Lemonade', 599),
                flat('Peach Glow Lemonade', 599),
                flat('Red Berry Burst Lemonade', 599),
            ],
        },
        drinksCategory(),
    ],
};

export const FLYER_MENU: FlyerBrand[] = [
    FIREAWAY,
    PEPERICO,
    WOK_AND_GO,
    LORANZO,
];
