/**
 * Seed: import menu items from export_items.csv (Retrograde export).
 *
 * This script "mends" the CSV into OUR schema:
 * - MenuCategory: from CSV "Category"
 * - MenuItem: from CSV Handle/Name/Description/Price
 * - ModifierGroup/Modifier: from CSV "Modifier - ..." flags (creates sensible defaults)
 * - BranchMenuItem: links items to all branches that have the brand
 *
 * Run:
 *   - from /backend: npm run seed:export-items
 *
 * Optional env:
 *   - OWNER_EMAIL: tenant owner email to import under (defaults to haider@demo.com)
 *   - BRAND_NAME: brand name to ensure/import into (defaults to Retrograde)
 *   - BRAND_SLUG: brand slug to ensure/import into (defaults to retrograde)
 *   - BRANCH_COUNT: number of branches to ensure for this brand (defaults to 2)
 *   - BRANCH_CODE_PREFIX: branch code prefix (defaults to RETRO)
 *   - CSV_PATH: path to csv (defaults to ../export_items.csv)
 */
import { config as dotenvConfig } from 'dotenv';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';
import { DataSource, In } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Brand } from './entities/brand.entity';
import { Branch } from './entities/branch.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { BranchBrand } from './entities/branch-brand.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';
import { ModifierGroup } from './entities/modifier-group.entity';
import { Modifier } from './entities/modifier.entity';
import { User } from './entities/user.entity';
import { TenantUser } from './entities/tenant-user.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

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

type CsvRow = Record<string, string>;

function slugify(input: string) {
    return input
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function parseBoolY(input: string | undefined) {
    return (input ?? '').trim().toUpperCase() === 'Y';
}

function parsePrice(input: string | undefined) {
    const raw = (input ?? '').trim();
    if (!raw) return { value: 0, ok: false };
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return { value: 0, ok: false };
    return { value: n, ok: true };
}

// Minimal CSV parser that supports commas + quoted values with escaped quotes ("").
function parseCsv(content: string): CsvRow[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const ch = content[i] ?? '';

        if (inQuotes) {
            if (ch === '"') {
                const next = content[i + 1];
                if (next === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            continue;
        }
        if (ch === ',') {
            row.push(cell);
            cell = '';
            continue;
        }
        if (ch === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }
        if (ch === '\r') continue;

        cell += ch;
    }
    // last cell
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    const header = rows.shift();
    if (!header?.length) return [];

    return rows
        .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
        .map((r) => {
            const obj: CsvRow = {};
            for (let i = 0; i < header.length; i++) {
                obj[String(header[i] ?? '').trim()] = String(r[i] ?? '').trim();
            }
            return obj;
        });
}

const DEFAULT_MODIFIERS: Record<string, string[]> = {
    Beans: ['Regular', 'Decaf'],
    Flavours: ['Vanilla', 'Caramel', 'Hazelnut'],
    Sauce: ['None', 'Chocolate', 'Caramel'],
    'Hot or Iced': ['Hot', 'Iced'],
    'Water Temp': ['Hot', 'Warm'],
};

function envInt(name: string, fallback: number) {
    const raw = (process.env[name] ?? '').trim();
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}

async function ensureModifierGroup(
    brandId: number,
    name: string,
    opts?: {
        minSelect?: number;
        maxSelect?: number;
        defaultModifiers?: string[];
    },
) {
    const modifierGroupRepo = dataSource.getRepository(ModifierGroup);
    const modifierRepo = dataSource.getRepository(Modifier);

    let group = await modifierGroupRepo.findOne({ where: { brandId, name } });
    if (!group) {
        group = await modifierGroupRepo.save(
            modifierGroupRepo.create({
                brandId,
                name,
                minSelect: opts?.minSelect ?? 0,
                maxSelect: opts?.maxSelect ?? 1,
            }),
        );
    }

    const names = opts?.defaultModifiers ??
        DEFAULT_MODIFIERS[name] ?? ['Standard'];
    const existing = await modifierRepo.find({
        where: { modifierGroupId: group.id },
        select: ['id', 'name'],
    });
    const existingNames = new Set(existing.map((m) => m.name));
    for (const n of names) {
        if (existingNames.has(n)) continue;
        await modifierRepo.save(
            modifierRepo.create({
                modifierGroupId: group.id,
                name: n,
                price: 0,
            }),
        );
    }

    return group;
}

async function ensureBranchesForBrand(brandId: number, brandSlug: string) {
    const branchRepo = dataSource.getRepository(Branch);
    const branchBrandRepo = dataSource.getRepository(BranchBrand);

    const desiredCount = envInt('BRANCH_COUNT', 2);
    const codePrefix = (process.env.BRANCH_CODE_PREFIX ?? 'RETRO')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 12);

    const existingLinks = await branchBrandRepo.find({
        where: { brandId },
        select: ['branchId'],
    });
    const linkedBranchIds = existingLinks.map((l) => l.branchId);
    const linkedBranches = linkedBranchIds.length
        ? await branchRepo.find({ where: { id: In(linkedBranchIds) } })
        : [];

    // If we already have enough, keep them.
    if (linkedBranches.length >= desiredCount) {
        return linkedBranches.slice(0, desiredCount);
    }

    const branches: Branch[] = [...linkedBranches];

    async function makeUniqueCode(base: string) {
        let code = base;
        let i = 1;
        for (;;) {
            const exists = await branchRepo.findOne({ where: { code } });
            if (!exists) return code;
            i++;
            code = `${base}-${i}`;
        }
    }

    for (let i = branches.length; i < desiredCount; i++) {
        const n = i + 1;
        const name = `Retrograde Branch ${n}`;
        const baseCode = `${codePrefix}-${slugify(brandSlug)
            .toUpperCase()
            .slice(0, 6)}-${n}`;
        const code = await makeUniqueCode(baseCode);

        const branch = await branchRepo.save(
            branchRepo.create({
                name,
                code,
                address: null,
                phone: null,
                email: null,
                timezone: 'Asia/Karachi',
                operatingHours: null,
                supportsDineIn: true,
                supportsTakeaway: true,
                supportsPickup: true,
                supportsDelivery: false,
                deliveryFlatFee: 0,
                isActive: true,
                status: 'active',
                settings: null,
                latitude: null,
                longitude: null,
            }),
        );
        await branchBrandRepo.save(
            branchBrandRepo.create({ branchId: branch.id, brandId }),
        );
        branches.push(branch);
    }

    return branches;
}

async function seedExportItems() {
    await dataSource.initialize();

    const brandRepo = dataSource.getRepository(Brand);
    const userRepo = dataSource.getRepository(User);
    const tenantUserRepo = dataSource.getRepository(TenantUser);
    const categoryRepo = dataSource.getRepository(MenuCategory);
    const menuItemRepo = dataSource.getRepository(MenuItem);
    const branchMenuItemRepo = dataSource.getRepository(BranchMenuItem);

    const csvPath = resolve(
        process.env.CSV_PATH ?? join(process.cwd(), '..', 'export_items.csv'),
    );

    const ownerEmail = (process.env.OWNER_EMAIL ?? 'haider@demo.com')
        .trim()
        .toLowerCase();
    const desiredBrandName =
        (process.env.BRAND_NAME ?? 'Retrograde').trim() || 'Retrograde';
    const desiredBrandSlug =
        slugify(process.env.BRAND_SLUG ?? 'retrograde') || 'retrograde';

    const owner = await userRepo.findOne({ where: { email: ownerEmail } });
    if (!owner) {
        console.log(
            `Owner user not found for email: ${ownerEmail}. Create this user (and tenant_users) first, then rerun.`,
        );
        await dataSource.destroy();
        return;
    }
    const tenantUser = await tenantUserRepo.findOne({
        where: { userId: owner.id },
        order: { id: 'ASC' },
    });
    if (!tenantUser) {
        console.log(
            `No tenant_users row found for ${ownerEmail}. This user isn't attached to a tenant in our system.`,
        );
        await dataSource.destroy();
        return;
    }

    // Ensure brand exists under this tenant.
    let brand = await brandRepo.findOne({
        where: { tenantId: tenantUser.tenantId, slug: desiredBrandSlug },
    });
    if (!brand) {
        brand = await brandRepo.save(
            brandRepo.create({
                tenantId: tenantUser.tenantId,
                name: desiredBrandName,
                slug: desiredBrandSlug,
                description: null,
                logoUrl: null,
                isActive: true,
            }),
        );
    }

    // Ensure 2 branches linked to this brand.
    const ensuredBranches = await ensureBranchesForBrand(brand.id, brand.slug);

    const csv = readFileSync(csvPath, 'utf8');
    const rows = parseCsv(csv);
    if (rows.length === 0) {
        console.log(`No rows found in CSV at ${csvPath}`);
        await dataSource.destroy();
        return;
    }

    // Branches that carry this brand (so items show up on POS/consumer).
    const branchIds = ensuredBranches.map((b) => b.id);

    const modifierFlagCols = Object.keys(rows[0] ?? {}).filter((k) =>
        k.toLowerCase().startsWith('modifier - '),
    );

    const modifierGroupsByCol: Record<string, ModifierGroup> = {};
    for (const col of modifierFlagCols) {
        // Example header: Modifier - "Beans"
        const m = col.match(/modifier\s*-\s*"?(.+?)"?$/i);
        const groupName = (m?.[1] ?? col)
            .replace(/^"+|"+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        modifierGroupsByCol[col] = await ensureModifierGroup(
            brand.id,
            groupName,
            {
                minSelect: 0,
                maxSelect: 1,
            },
        );
    }

    const categoryByName = new Map<string, MenuCategory>();
    const existingCategories = await categoryRepo.find({
        where: { brandId: brand.id },
        order: { sortOrder: 'ASC', id: 'ASC' },
    });
    for (const c of existingCategories) {
        categoryByName.set(c.name.toLowerCase(), c);
    }

    let createdCategories = 0;
    let createdItems = 0;
    let updatedItems = 0;
    let branchLinksCreated = 0;
    let modifierLinksCreated = 0;
    let skippedNoPrice = 0;

    for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        if (!r) continue;

        const handle = (r['Handle'] ?? '').trim();
        const name = (r['Name'] ?? '').trim();
        const categoryName =
            (r['Category'] ?? 'Uncategorized').trim() || 'Uncategorized';
        const description = (r['Description'] ?? '').trim() || null;
        const priceCell = r['Price [Retrograde]'] ?? r['Price'] ?? '';
        const price = parsePrice(priceCell);

        if (!name) continue;

        let category = categoryByName.get(categoryName.toLowerCase());
        if (!category) {
            category = await categoryRepo.save(
                categoryRepo.create({
                    brandId: brand.id,
                    name: categoryName,
                    sortOrder: existingCategories.length + createdCategories,
                    isActive: true,
                }),
            );
            categoryByName.set(categoryName.toLowerCase(), category);
            createdCategories++;
        }

        const baseSlug = handle ? slugify(handle) : slugify(name);
        const slug = `${baseSlug}-${brand.slug}`;

        const existing = await menuItemRepo.findOne({
            where: { brandId: brand.id, slug },
        });

        const isActive = price.ok && price.value > 0;
        if (!price.ok) skippedNoPrice++;

        let item: MenuItem;
        if (!existing) {
            item = await menuItemRepo.save(
                menuItemRepo.create({
                    brandId: brand.id,
                    categoryId: category.id,
                    name,
                    slug,
                    description,
                    imageUrl: null,
                    basePrice: price.value,
                    isActive,
                    sortOrder: idx,
                    dealOnly: false,
                }),
            );
            createdItems++;
        } else {
            const shouldUpdate =
                existing.name !== name ||
                existing.categoryId !== category.id ||
                existing.description !== description ||
                Number(existing.basePrice) !== price.value ||
                existing.isActive !== isActive;
            if (shouldUpdate) {
                existing.name = name;
                existing.categoryId = category.id;
                existing.description = description;
                existing.basePrice = price.value;
                existing.isActive = isActive;
                existing.sortOrder = idx;
                item = await menuItemRepo.save(existing);
                updatedItems++;
            } else {
                item = existing;
            }
        }

        // Link to branches (availability control lives in branch_menu_items).
        if (branchIds.length) {
            const existingLinks = await branchMenuItemRepo.find({
                where: { menuItemId: item.id, branchId: In(branchIds) },
                select: ['branchId'],
            });
            const existingSet = new Set(existingLinks.map((l) => l.branchId));
            for (const branchId of branchIds) {
                if (existingSet.has(branchId)) continue;
                await branchMenuItemRepo.save(
                    branchMenuItemRepo.create({
                        branchId,
                        menuItemId: item.id,
                        priceOverride: null,
                        isAvailable: true,
                        isHiddenOnline: false,
                    }),
                );
                branchLinksCreated++;
            }
        }

        // Link modifier groups based on Y/N flags in CSV.
        const wantsGroups = modifierFlagCols.filter((col) =>
            parseBoolY(r[col]),
        );
        if (wantsGroups.length) {
            const withMods = await menuItemRepo.findOne({
                where: { id: item.id },
                relations: ['modifierGroups'],
            });
            if (withMods) {
                const existingGroupIds = new Set(
                    (withMods.modifierGroups ?? []).map((g) => g.id),
                );
                const toAdd = wantsGroups
                    .map((col) => modifierGroupsByCol[col])
                    .filter((g): g is ModifierGroup => Boolean(g))
                    .filter((g) => !existingGroupIds.has(g.id));
                if (toAdd.length) {
                    withMods.modifierGroups = [
                        ...(withMods.modifierGroups ?? []),
                        ...toAdd,
                    ];
                    await menuItemRepo.save(withMods);
                    modifierLinksCreated += toAdd.length;
                }
            }
        }
    }

    console.log(
        [
            `Imported CSV → tenant_user: ${ownerEmail} (tenant_id: ${tenantUser.tenantId})`,
            `Brand: "${brand.name}" (slug: ${brand.slug}, id: ${brand.id})`,
            `Branches linked (${branchIds.length}): ${ensuredBranches
                .map((b) => `${b.name} [${b.code}]`)
                .join(', ')}`,
            `CSV: ${csvPath}`,
            `Categories created: ${createdCategories}`,
            `Items created: ${createdItems}`,
            `Items updated: ${updatedItems}`,
            `Branch links created: ${branchLinksCreated}`,
            `Modifier group links created: ${modifierLinksCreated}`,
            `Rows with missing/unparseable price: ${skippedNoPrice} (imported as inactive / price 0)`,
        ].join('\n'),
    );

    await dataSource.destroy();
}

seedExportItems().catch((e) => {
    console.error(e);
    process.exit(1);
});
