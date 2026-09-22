/**
 * Seed: Lunch Deals — Peperi. Co · Fireaway · Wok & Go.
 *
 * Adds the client's lunch-deal set, live 13:00–17:00 every day.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NON-DESTRUCTIVE — safe to run on production.
 * ───────────────────────────────────────────────────────────────────────────
 * This script touches ONLY the deals named in DEALS below. It never reads,
 * rewrites or deactivates the rest of the menu, unlike the per-brand
 * `seed-<brand>-2026.ts` seeders (which rebuild a whole brand).
 *
 *   menu_items        → the deal root is upserted BY NAME within the brand, so
 *                       re-running renames/reprices in place and the id (and
 *                       its order history) survives. Never deleted.
 *   deal_components   → rebuilt for these deals only. FKs are ON DELETE SET
 *                       NULL and order rows carry name/price snapshots, so
 *                       past orders stay readable.
 *   branch_menu_items → missing rows added for the brand's branches. Existing
 *                       price overrides / availability flags are never touched.
 *
 * Nothing else in the database is written.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * USAGE
 * ───────────────────────────────────────────────────────────────────────────
 *   npm run seed:lunch-deals              # DRY RUN — resolves, reports, rolls back
 *   npm run seed:lunch-deals -- --commit  # actually writes
 *
 * The dry run executes every write inside a transaction and then rolls back,
 * so it exercises the real code path (constraints included) without leaving a
 * trace. Always dry-run against production first and read the plan.
 *
 * Resolution is BY NAME against the live database. If any item, category or
 * label in the config below does not resolve, the script prints exactly what
 * is missing and exits WITHOUT writing anything. That is the intended way to
 * discover naming drift between environments — fix the names in CONFIG and
 * re-run.
 *
 * Prices are whole Rupees.
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource, EntityManager, In } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Brand } from './entities/brand.entity';
import { Branch } from './entities/branch.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { MenuVariant } from './entities/menu-variant.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';
import { DealComponent } from './entities/deal-component.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

// ===========================================================================
// CONFIG — everything the client asked for. Edit here, nowhere else.
// ===========================================================================

/** "01:00 Pm to 05:00 Pm", in the BRANCH timezone (enforced server-side). */
const LUNCH_START = '13:00';
const LUNCH_END = '17:00';

/** null = every day. Set to [1,2,3,4,5] for Mon–Fri. */
const LUNCH_DAYS: number[] | null = null;

/**
 * Sale channels these deals may be sold on: 'pos' | 'app' | 'web' | 'kiosk'.
 * null = every channel. Fireaway's existing lunch deals are ['pos','app']
 * ("FIREAWAY APP & E-Pos ONLY") — set that here if these must match.
 */
const DEAL_CHANNELS: string[] | null = null;

/**
 * The category every deal root is filed under. Confirmed to exist on all three
 * brands in production. The script NEVER creates a category — if this is
 * missing on a brand it aborts rather than inventing one.
 */
const LUNCH_DEAL_CATEGORY = 'Lunch Deal';

/**
 * Whether to make the deals sellable at the brand's branches by creating the
 * missing `branch_menu_items` rows.
 *
 * FALSE (the default) means the deals are created but attached to NO branch.
 * A menu item with no branch_menu_items row does not appear on that branch's
 * menu at all — `getMenuForBranch` builds the menu from that table — so the
 * deals will be invisible on POS, app and web until someone attaches them,
 * either by switching this to true and re-running, or per branch in the admin.
 * That is deliberate: it lets the deals be staged and reviewed before they go
 * live anywhere.
 */
const ATTACH_TO_BRANCHES = false;

/**
 * A category, by name — or by `{ id }` when the name is not unique. Production
 * carries TWO categories called "Deals" under Peperi Co (ids 432 and 477), and
 * resolving that by name would file the deals into whichever row the database
 * happened to return first. The script refuses to guess; pin the id instead.
 */
type CategoryRef = string | { id: number };

type SlotSpec =
    /** Exactly this item, always. */
    | {
          pick: 'item';
          name: string;
          quantity?: number;
          allowCustomization?: boolean;
      }
    /** Any item in this category. New items added to the category join automatically. */
    | {
          pick: 'category';
          category: CategoryRef;
          sizeKey?: string;
          quantity?: number;
          allowCustomization?: boolean;
      }
    /** Any item in this category carrying this `label` (e.g. Classic / Signature). */
    | {
          pick: 'label';
          category: CategoryRef;
          label: string;
          sizeKey?: string;
          quantity?: number;
          allowCustomization?: boolean;
      }
    /** Choose from this explicit list of item names. */
    | {
          pick: 'list';
          names: string[];
          sizeKey?: string;
          quantity?: number;
          allowCustomization?: boolean;
      };

interface DealSpec {
    name: string;
    description: string;
    price: number;
    slots: SlotSpec[];
}

interface BrandSpec {
    brandSlug: string;
    /** Only for the report — the script matches on slug. */
    brandName: string;
    /**
     * Where the deal roots are filed. NOT the same name on every brand: prod
     * has Wok & Go's "Deals" category deactivated and an empty, active
     * "Lunch Deal" category alongside it.
     */
    dealsCategory: CategoryRef;
    deals: DealSpec[];
}

/**
 * Peperi Co 345ml soda range — the "Drinks" included in the chicken & rice
 * deal. These are the four that are ACTIVE on production. Note the spelling:
 * prod has "7Up" (capital U) and "Dew", where dev has "7up" and "Mountain
 * Dew". Diet Pepsi 345ml is switched off on prod, so it is not offered.
 */
const PEPERICO_DRINKS_345 = [
    'Pepsi 345ml',
    '7Up 345ml',
    'Mirinda 345ml',
    'Dew 345ml',
];

/**
 * The "1 Liter drink" in both pizza deals. Pepsi 1L is the ONLY active
 * one-litre product on Fireaway — 7up / Diet Pepsi / Mirinda / Mountain Dew
 * 1L all exist but are switched off, so a chooser would have exactly one
 * entry and cost the till an extra click per order. Modelled as a fixed slot
 * instead (client-confirmed).
 *
 * If more 1L drinks are re-activated later, turn this back into a chooser:
 * swap the two `{ pick: 'item', name: FIREAWAY_DRINK_1L }` slots below for
 * `{ pick: 'list', names: [...], allowCustomization: false }`.
 */
const FIREAWAY_DRINK_1L = 'Pepsi 1L';

/**
 * Fireaway pizzas are single-size. Confirmed on prod: every item in both pizza
 * categories carries exactly one variant with size_key '12'.
 */
const FIREAWAY_PIZZA_SIZE = '12';

/**
 * On PRODUCTION, "Classic" and "Signature" are CATEGORIES (6 active items
 * each), not labels — the `label` column is empty across the whole brand. Dev
 * has it the other way round: one "Classic and Signature Pizza Or Calzone"
 * category with the split carried on `label`. That category still exists on
 * prod but is inactive and empty.
 */
const FIREAWAY_CLASSIC_CATEGORY = 'Classic';
const FIREAWAY_SIGNATURE_CATEGORY = 'Signature';

/**
 * Wok & Go box sizeKey the deals pin to. Confirmed on prod: the three
 * "From the Sea" items each carry exactly one 'large' variant.
 */
const WOK_BOX_SIZE = 'large';

/**
 * Prod calls Wok & Go's classic range "Classic Meals" (9 items). "Classic
 * Boxes" is the DEV name and does not exist on production.
 */
const WOK_CLASSIC_CATEGORY = 'Classic Meals';
/** Prod: 3 items — Hoisin Special (Crispy Fish), Spicy Sea Food (Shrimp), Szechuan Special (Fish). */
const WOK_SEA_CATEGORY = 'From the Sea';

const DEALS: BrandSpec[] = [
    // =======================================================================
    {
        brandSlug: 'peperi-co',
        brandName: 'Peperi. Co',
        dealsCategory: LUNCH_DEAL_CATEGORY,
        deals: [
            // Two burgers as TWO slots (not one slot × 2) so the customer can
            // customize each burger independently — different cheese, sauce,
            // salad per burger. One slot with quantity 2 would force both to
            // share a single set of modifiers.
            {
                name: '2 Old & Gold Smashed Burgers',
                description:
                    'Two Old & Gold Smashed burgers for Rs 1899. Available 1pm–5pm.',
                price: 1899,
                slots: [
                    { pick: 'item', name: 'Old & Gold Smashed' },
                    { pick: 'item', name: 'Old & Gold Smashed' },
                ],
            },
            {
                name: '2 Smashed Classic Burgers',
                description:
                    'Two Smashed Classic burgers for Rs 1899. Available 1pm–5pm.',
                price: 1899,
                slots: [
                    { pick: 'item', name: 'Smashed Classic' },
                    { pick: 'item', name: 'Smashed Classic' },
                ],
            },
            {
                name: '2 Quarter Chicken with Rice and Drinks',
                description:
                    'Two 1/4 Peri Peri Chicken, two Peri Peri Rice and two drinks for Rs 1499. Available 1pm–5pm.',
                price: 1499,
                slots: [
                    { pick: 'item', name: '1/4 Peri Peri Chicken' },
                    { pick: 'item', name: '1/4 Peri Peri Chicken' },
                    { pick: 'item', name: 'Peri Peri Rice' },
                    { pick: 'item', name: 'Peri Peri Rice' },
                    {
                        pick: 'list',
                        names: PEPERICO_DRINKS_345,
                        allowCustomization: false,
                    },
                    {
                        pick: 'list',
                        names: PEPERICO_DRINKS_345,
                        allowCustomization: false,
                    },
                ],
            },
        ],
    },
    // =======================================================================
    {
        brandSlug: 'fireaway',
        brandName: 'Fireaway',
        dealsCategory: LUNCH_DEAL_CATEGORY,
        deals: [
            {
                name: 'Classic Pizza and 1L Drink Lunch Deal',
                description:
                    'Any Classic pizza with a 1 litre drink for Rs 1499. Available 1pm–5pm.',
                price: 1499,
                slots: [
                    {
                        pick: 'category',
                        category: FIREAWAY_CLASSIC_CATEGORY,
                        sizeKey: FIREAWAY_PIZZA_SIZE,
                    },
                    {
                        pick: 'item',
                        name: FIREAWAY_DRINK_1L,
                        allowCustomization: false,
                    },
                ],
            },
            {
                name: 'Signature Pizza and 1L Drink Lunch Deal',
                description:
                    'Any Signature pizza with a 1 litre drink for Rs 1599. Available 1pm–5pm.',
                price: 1599,
                slots: [
                    {
                        pick: 'category',
                        category: FIREAWAY_SIGNATURE_CATEGORY,
                        sizeKey: FIREAWAY_PIZZA_SIZE,
                    },
                    {
                        pick: 'item',
                        name: FIREAWAY_DRINK_1L,
                        allowCustomization: false,
                    },
                ],
            },
        ],
    },
    // =======================================================================
    {
        brandSlug: 'wok--go',
        brandName: 'Wok & Go',
        dealsCategory: LUNCH_DEAL_CATEGORY,
        deals: [
            {
                name: 'Any Two Classic Meals',
                description:
                    'Any two meals from our Classic range for Rs 2199. Available 1pm–5pm.',
                price: 2199,
                slots: [
                    {
                        pick: 'category',
                        category: WOK_CLASSIC_CATEGORY,
                        sizeKey: WOK_BOX_SIZE,
                    },
                    {
                        pick: 'category',
                        category: WOK_CLASSIC_CATEGORY,
                        sizeKey: WOK_BOX_SIZE,
                    },
                ],
            },
            {
                // The "From the Sea" category exists on PRODUCTION only — this
                // deal will not resolve against a stale local database. That is
                // deliberate: the script fails loudly rather than seeding a
                // half-built deal. Confirm the exact category name with the
                // discovery query in the runbook before committing.
                name: 'Any Two Meals from the Sea',
                description:
                    'Any two meals from our From the Sea range for Rs 2599. Available 1pm–5pm.',
                price: 2599,
                slots: [
                    {
                        pick: 'category',
                        category: WOK_SEA_CATEGORY,
                        sizeKey: WOK_BOX_SIZE,
                    },
                    {
                        pick: 'category',
                        category: WOK_SEA_CATEGORY,
                        sizeKey: WOK_BOX_SIZE,
                    },
                ],
            },
        ],
    },
];

// ===========================================================================
// Bootstrap
// ===========================================================================

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

const COMMIT = process.argv.includes('--commit');

/** Thrown at the end of a dry run (or on an unresolved config) to roll the transaction back. */
class Rollback extends Error {
    constructor() {
        super('dry-run rollback');
        this.name = 'Rollback';
    }
}

function slugify(name: string, brandSlug: string) {
    return `${name
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')}-${brandSlug}`;
}

/** A slot resolved against the live DB, ready to become a deal_components row. */
interface ResolvedSlot {
    type: 'fixed' | 'choice_category' | 'choice_list';
    sourceMenuItemId: number | null;
    sourceCategoryId: number | null;
    sourceMenuItemIds: number[] | null;
    quantity: number;
    allowCustomization: boolean;
    slotSizeKey: string | null;
    /** Human-readable, for the plan. */
    describe: string;
}

interface ResolvedDeal {
    spec: DealSpec;
    slots: ResolvedSlot[];
    /** Existing deal root, if this is a re-run. */
    existing: MenuItem | null;
}

interface ResolvedBrand {
    spec: BrandSpec;
    brand: Brand;
    dealsCategory: MenuCategory;
    deals: ResolvedDeal[];
    branchIds: number[];
}

// ===========================================================================
// Phase 1 — RESOLVE (read-only). Collects every problem before writing.
// ===========================================================================

async function resolve(
    manager: EntityManager,
    problems: string[],
): Promise<ResolvedBrand[]> {
    const brandRepo = manager.getRepository(Brand);
    const categoryRepo = manager.getRepository(MenuCategory);
    const itemRepo = manager.getRepository(MenuItem);
    const variantRepo = manager.getRepository(MenuVariant);

    const out: ResolvedBrand[] = [];

    for (const brandSpec of DEALS) {
        const brand = await brandRepo.findOne({
            where: { slug: brandSpec.brandSlug },
        });
        if (!brand) {
            problems.push(
                `brand "${brandSpec.brandName}" (slug "${brandSpec.brandSlug}") not found`,
            );
            continue;
        }
        const brandId = brand.id;

        /** Set when a category name misses, so we can print what DOES exist. */
        let wantCategoryHint = false;

        /** List the brand's real categories — the fastest way to fix a name typo. */
        async function printCategoryHint() {
            if (!wantCategoryHint) return;
            wantCategoryHint = false;
            const all = await categoryRepo.find({
                where: { brandId },
                order: { name: 'ASC' },
            });
            console.log(
                `  ? ${brandSpec.brandName} categories: ${all
                    .map((c) => `${c.name}${c.isActive ? '' : ' (inactive)'}`)
                    .join(' · ')}`,
            );
        }

        /**
         * Resolve a category by name, or by pinned id. A name that matches more
         * than one row is a hard failure, never an arbitrary pick: prod carries
         * two "Deals" categories under Peperi Co, and silently choosing the
         * wrong one would file the deals somewhere customers never see.
         * Active rows win over inactive ones when both share a name.
         */
        const findCategory = async (
            ref: CategoryRef,
            neededBy: string,
        ): Promise<MenuCategory | null> => {
            if (typeof ref === 'object') {
                const byId = await categoryRepo.findOne({
                    where: { id: ref.id },
                });
                if (!byId || byId.brandId !== brandId) {
                    problems.push(
                        `${brandSpec.brandName}: category id ${ref.id} is not a category of this brand (needed by ${neededBy})`,
                    );
                    return null;
                }
                if (!byId.isActive)
                    console.log(
                        `  ! warning: ${brandSpec.brandName} category "${byId.name}" (id ${byId.id}) is INACTIVE — deals filed under it may stay hidden`,
                    );
                return byId;
            }

            const matches = await categoryRepo.find({
                where: { brandId, name: ref },
            });
            const active = matches.filter((c) => c.isActive);
            const pick = active.length ? active : matches;

            if (pick.length === 1) {
                if (!pick[0].isActive)
                    console.log(
                        `  ! warning: ${brandSpec.brandName} category "${pick[0].name}" (id ${pick[0].id}) is INACTIVE — deals filed under it may stay hidden`,
                    );
                return pick[0];
            }
            if (pick.length > 1) {
                problems.push(
                    `${brandSpec.brandName}: category "${ref}" is AMBIGUOUS — ${pick.length} rows (ids ${pick
                        .map((c) => c.id)
                        .join(
                            ', ',
                        )}). Pin one with { id: <n> } (needed by ${neededBy})`,
                );
                return null;
            }
            problems.push(
                `${brandSpec.brandName}: category "${ref}" not found (needed by ${neededBy})`,
            );
            wantCategoryHint = true;
            return null;
        };

        const dealsCategory = await findCategory(
            brandSpec.dealsCategory,
            'the deal roots',
        );
        if (!dealsCategory) {
            await printCategoryHint();
            continue;
        }

        /** Every item in the brand carrying `name`, active only. */
        const findItem = async (name: string): Promise<MenuItem | null> => {
            const active = await itemRepo.find({
                where: { brandId, name, isActive: true },
            });
            if (active.length === 1) return active[0];
            if (active.length > 1) {
                problems.push(
                    `${brandSpec.brandName}: "${name}" matches ${active.length} active items (ids ${active
                        .map((i) => i.id)
                        .join(', ')}) — name is ambiguous`,
                );
                return null;
            }
            const inactive = await itemRepo.findOne({
                where: { brandId, name },
            });
            problems.push(
                inactive
                    ? `${brandSpec.brandName}: "${name}" exists (id ${inactive.id}) but is INACTIVE`
                    : `${brandSpec.brandName}: item "${name}" not found`,
            );
            return null;
        };

        /** Warn (do not fail) when a pinned sizeKey is missing from the choices. */
        const checkSize = async (
            itemIds: number[],
            sizeKey: string | undefined,
            label: string,
        ) => {
            if (!sizeKey || itemIds.length === 0) return;
            const withSize = await variantRepo.count({
                where: { menuItemId: In(itemIds), sizeKey },
            });
            if (withSize === 0) {
                problems.push(
                    `${brandSpec.brandName}: ${label} pins sizeKey "${sizeKey}" but NONE of its ${itemIds.length} choice(s) have that variant`,
                );
            } else if (withSize < itemIds.length) {
                console.log(
                    `  ! warning: ${label} pins sizeKey "${sizeKey}" — only ${withSize}/${itemIds.length} choices have it; the rest are unpickable`,
                );
            }
        };

        const deals: ResolvedDeal[] = [];
        for (const dealSpec of brandSpec.deals) {
            const slots: ResolvedSlot[] = [];
            let slotFailed = false;

            for (const s of dealSpec.slots) {
                const quantity = s.quantity ?? 1;
                const allowCustomization = s.allowCustomization ?? true;

                if (s.pick === 'item') {
                    const item = await findItem(s.name);
                    if (!item) {
                        slotFailed = true;
                        continue;
                    }
                    slots.push({
                        type: 'fixed',
                        sourceMenuItemId: item.id,
                        sourceCategoryId: null,
                        sourceMenuItemIds: null,
                        quantity,
                        allowCustomization,
                        slotSizeKey: null,
                        describe: `fixed ×${quantity} — ${item.name} (id ${item.id})`,
                    });
                    continue;
                }

                if (s.pick === 'list') {
                    const items: MenuItem[] = [];
                    for (const n of s.names) {
                        const it = await findItem(n);
                        if (it) items.push(it);
                        else slotFailed = true;
                    }
                    if (slotFailed) continue;
                    const ids = items.map((i) => i.id);
                    await checkSize(
                        ids,
                        s.sizeKey,
                        `"${dealSpec.name}" list slot`,
                    );
                    slots.push({
                        type: 'choice_list',
                        sourceMenuItemId: null,
                        sourceCategoryId: null,
                        sourceMenuItemIds: ids,
                        quantity,
                        allowCustomization,
                        slotSizeKey: s.sizeKey ?? null,
                        describe: `choice of ${ids.length} ×${quantity} — ${items
                            .map((i) => i.name)
                            .join(', ')}`,
                    });
                    continue;
                }

                // 'category' and 'label' both need the category.
                const category = await findCategory(
                    s.category,
                    `"${dealSpec.name}"`,
                );
                if (!category) {
                    slotFailed = true;
                    continue;
                }

                if (s.pick === 'category') {
                    const members = await itemRepo.find({
                        where: {
                            brandId,
                            categoryId: category.id,
                            isActive: true,
                        },
                    });
                    if (members.length === 0) {
                        problems.push(
                            `${brandSpec.brandName}: category "${category.name}" (id ${category.id}) has no active items (needed by "${dealSpec.name}")`,
                        );
                        slotFailed = true;
                        continue;
                    }
                    await checkSize(
                        members.map((m) => m.id),
                        s.sizeKey,
                        `"${dealSpec.name}" category slot "${category.name}"`,
                    );
                    slots.push({
                        type: 'choice_category',
                        sourceMenuItemId: null,
                        sourceCategoryId: category.id,
                        sourceMenuItemIds: null,
                        quantity,
                        allowCustomization,
                        slotSizeKey: s.sizeKey ?? null,
                        describe: `any of category "${category.name}" ×${quantity} (${members.length} active items today)`,
                    });
                    continue;
                }

                // s.pick === 'label' — a label filter needs an explicit id list,
                // because choice_category cannot express "only the Classic ones".
                const labelled = await itemRepo.find({
                    where: {
                        brandId,
                        categoryId: category.id,
                        label: s.label,
                        isActive: true,
                    },
                });
                if (labelled.length === 0) {
                    problems.push(
                        `${brandSpec.brandName}: no active items labelled "${s.label}" in category "${category.name}" (needed by "${dealSpec.name}")`,
                    );
                    slotFailed = true;
                    continue;
                }
                const ids = labelled.map((i) => i.id);
                await checkSize(
                    ids,
                    s.sizeKey,
                    `"${dealSpec.name}" ${s.label} slot`,
                );
                slots.push({
                    type: 'choice_list',
                    sourceMenuItemId: null,
                    sourceCategoryId: null,
                    sourceMenuItemIds: ids,
                    quantity,
                    allowCustomization,
                    slotSizeKey: s.sizeKey ?? null,
                    describe: `any "${s.label}" in "${category.name}" ×${quantity} (${ids.length}: ${labelled
                        .map((i) => i.name)
                        .join(', ')})`,
                });
            }

            if (slotFailed) continue;

            const existing = await itemRepo.findOne({
                where: { brandId, name: dealSpec.name },
            });
            deals.push({ spec: dealSpec, slots, existing });
        }

        await printCategoryHint();

        const branches = await manager
            .getRepository(Branch)
            .createQueryBuilder('b')
            .innerJoin('branch_brands', 'bb', 'bb.branch_id = b.id')
            .where('bb.brand_id = :brandId', { brandId })
            .getMany();

        out.push({
            spec: brandSpec,
            brand,
            dealsCategory,
            deals,
            branchIds: branches.map((b) => b.id),
        });
    }

    return out;
}

// ===========================================================================
// Phase 2 — WRITE
// ===========================================================================

async function write(manager: EntityManager, resolved: ResolvedBrand[]) {
    const itemRepo = manager.getRepository(MenuItem);
    const dealComponentRepo = manager.getRepository(DealComponent);
    const bmiRepo = manager.getRepository(BranchMenuItem);

    let created = 0;
    let updated = 0;
    let bmiCreated = 0;

    for (const rb of resolved) {
        for (const rd of rb.deals) {
            const { spec } = rd;
            let deal = rd.existing;

            if (deal) {
                updated++;
            } else {
                deal = itemRepo.create({
                    brandId: rb.brand.id,
                    slug: slugify(spec.name, rb.spec.brandSlug),
                });
                created++;
            }

            deal.categoryId = rb.dealsCategory.id;
            deal.name = spec.name;
            deal.description = spec.description;
            // The deal root's price IS the deal price: fixed-mode deals are
            // priced from getEffectiveUnitPrice(branch, dealRootId).
            deal.basePrice = spec.price;
            deal.isActive = true;
            deal.dealOnly = false;
            deal.dealPricingMode = null;
            deal.availableTimeStart = LUNCH_START;
            deal.availableTimeEnd = LUNCH_END;
            deal.availableDaysOfWeek = LUNCH_DAYS;
            deal.availableChannels = DEAL_CHANNELS;
            deal = await itemRepo.save(deal);

            // Rebuild this deal's slots only.
            await dealComponentRepo.delete({ menuItemId: deal.id });
            let slotIndex = 0;
            for (const s of rd.slots) {
                await dealComponentRepo.save(
                    dealComponentRepo.create({
                        menuItemId: deal.id,
                        slotIndex: slotIndex++,
                        type: s.type,
                        sourceMenuItemId: s.sourceMenuItemId,
                        sourceCategoryId: s.sourceCategoryId,
                        sourceMenuItemIds: s.sourceMenuItemIds,
                        quantity: s.quantity,
                        allowCustomization: s.allowCustomization,
                        optional: false,
                        slotSurcharges: null,
                        slotSizeKey: s.slotSizeKey,
                        allowedSizeKeys: null,
                        mirrorSlotIndex: null,
                        mirrorMatchSize: false,
                        mirrorMatchCategory: false,
                    }),
                );
            }

            // Make the deal orderable at every branch selling this brand.
            // Existing rows are left alone — overrides are the branch's business.
            if (!ATTACH_TO_BRANCHES) continue;
            for (const branchId of rb.branchIds) {
                const existingBmi = await bmiRepo.findOne({
                    where: { branchId, menuItemId: deal.id },
                });
                if (!existingBmi) {
                    await bmiRepo.save(
                        bmiRepo.create({
                            branchId,
                            menuItemId: deal.id,
                            priceOverride: null,
                            isAvailable: true,
                            isHiddenOnline: false,
                        }),
                    );
                    bmiCreated++;
                }
            }
        }
    }

    return { created, updated, bmiCreated };
}

// ===========================================================================

async function main() {
    await dataSource.initialize();

    console.log('');
    console.log(
        COMMIT
            ? '=== LUNCH DEALS — COMMIT (writes will be kept) ==='
            : '=== LUNCH DEALS — DRY RUN (nothing will be kept) ===',
    );
    console.log(
        `    window ${LUNCH_START}–${LUNCH_END} · days ${
            LUNCH_DAYS ? LUNCH_DAYS.join(',') : 'every day'
        } · channels ${DEAL_CHANNELS ? DEAL_CHANNELS.join(',') : 'all'}`,
    );
    console.log(
        `    category "${LUNCH_DEAL_CATEGORY}" · branches ${
            ATTACH_TO_BRANCHES
                ? 'ATTACHED (deals go live)'
                : 'NOT attached (deals stay invisible until attached)'
        }`,
    );
    console.log(
        `    db ${process.env.DB_DATABASE ?? 'foodies'} @ ${process.env.DB_HOST ?? '127.0.0.1'}`,
    );
    console.log('');

    let summary: { created: number; updated: number; bmiCreated: number } = {
        created: 0,
        updated: 0,
        bmiCreated: 0,
    };
    let aborted = false;

    try {
        await dataSource.transaction(async (manager) => {
            const problems: string[] = [];
            const resolved = await resolve(manager, problems);

            // ——— The plan ———
            for (const rb of resolved) {
                console.log(
                    `${rb.spec.brandName}  (brand id ${rb.brand.id}, ${rb.branchIds.length} branch(es))`,
                );
                for (const rd of rb.deals) {
                    const verb = rd.existing
                        ? `UPDATE id ${rd.existing.id}`
                        : 'CREATE';
                    console.log(
                        `  ${verb}  "${rd.spec.name}"  Rs ${rd.spec.price}`,
                    );
                    rd.slots.forEach((s, i) =>
                        console.log(`      slot ${i}: ${s.describe}`),
                    );
                }
                console.log('');
            }

            if (problems.length) {
                console.log('UNRESOLVED — nothing was written:');
                // Identical slots (e.g. the two halves of a "two of X" deal)
                // report the same problem twice — say it once.
                for (const p of [...new Set(problems)]) console.log(`  ✗ ${p}`);
                console.log('');
                console.log(
                    'Fix the names in the CONFIG block at the top of this file and re-run.',
                );
                aborted = true;
                throw new Rollback();
            }

            summary = await write(manager, resolved);

            if (!COMMIT) throw new Rollback();
        });
    } catch (err) {
        if (!(err instanceof Rollback)) throw err;
    }

    if (!aborted) {
        console.log(
            `deals created: ${summary.created} · updated: ${summary.updated} · new branch_menu_items rows: ${summary.bmiCreated}`,
        );
        if (!ATTACH_TO_BRANCHES)
            console.log(
                'branches were NOT attached: these deals are on no branch menu yet, so they will not show on POS/app/web.',
            );
        console.log(
            COMMIT
                ? 'Committed. Nothing was deleted; order history is intact.'
                : 'Dry run complete — transaction rolled back. Re-run with `-- --commit` to apply.',
        );
    }

    await dataSource.destroy();
    if (aborted) process.exit(1);
}

main().catch(async (err) => {
    console.error('Lunch-deal seed failed:', err);
    if (dataSource.isInitialized) await dataSource.destroy();
    process.exit(1);
});
