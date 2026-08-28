/**
 * Menu switch — data model for the flyer menu.
 *
 * A FlyerBrand describes the NEW menu exactly as printed on the Pine Avenue
 * flyer. Items carry only what the flyer states (name, price, description,
 * sizes); their option groups are CLONED from the live item named in `from`
 * (default: the same name), with `groupOverrides` applied where the flyer
 * says something different. Nothing here references database ids.
 */
export type FlyerVariant = {
    name: string;
    sizeKey?: string | null;
    price: number;
    isDefault?: boolean;
};

export type FlyerModifier = { name: string; price?: number };

export type GroupOverride = {
    /** Exact live group name this override applies to (per brand). */
    match: string;
    /** Replace the option list entirely. */
    modifiers?: FlyerModifier[];
    /** Override group settings. */
    cfg?: Partial<{
        minSelect: number;
        maxSelect: number;
        includedQuantity: number;
        allowQuantity: boolean;
        hideInDeals: boolean;
    }>;
    /** Rename the group heading. */
    rename?: string;
};

export type FlyerSlot = {
    type: 'fixed' | 'choice_category' | 'choice_list';
    /** New-menu item name (fixed). */
    item?: string;
    /** New-menu category name (choice_category). */
    category?: string;
    /** New-menu item names (choice_list). */
    items?: string[];
    qty?: number;
    optional?: boolean;
    customize?: boolean;
    /** New-menu item name → surcharge. */
    surcharges?: Record<string, number>;
    sizeKey?: string | null;
};

export type FlyerItem = {
    name: string;
    price: number;
    description?: string;
    /**
     * Live item (same brand) whose option groups are cloned onto this item.
     * undefined → live item with the same name (if any); null → no groups.
     */
    from?: string | null;
    variants?: FlyerVariant[];
    /** Live group names NOT to clone. */
    excludeGroups?: string[];
    /** Brand-level addon names to attach. */
    addons?: string[];
    /** Hidden from the menu; only reachable through a deal slot. */
    dealOnly?: boolean;
    label?: string;
    /** Present ⇒ this item is a deal. */
    slots?: FlyerSlot[];
};

export type FlyerCategory = {
    name: string;
    description?: string;
    items: FlyerItem[];
};

export type FlyerBrand = {
    slug: string;
    name: string;
    categories: FlyerCategory[];
    addons?: Array<{ name: string; price: number }>;
    groupOverrides?: GroupOverride[];
};
