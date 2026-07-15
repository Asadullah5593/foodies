/**
 * Seed: four starter invoice templates for every tenant — all thermal receipt
 * styles, since receipts print on a thermal roll and are handed to the customer.
 *
 *  1. "Bordered Bill"   (bill_bordered)   — dine-in bill: tabular header + a
 *     fully bordered Item/Qty/Rate/Amount table. Tenant default when none set.
 *  2. "Logo Receipt"    (receipt_logo)    — takeaway: oversized brand logo, big
 *     Order # band, underlined columns, thank-you footer.
 *  3. "Modern Minimal"  (thermal_modern)  — clean, airy, uppercase labels.
 *  4. "Classic Mono"    (thermal_classic) — monospace, double/dashed rules.
 *
 * All are tenant-wide (brand_id NULL) so every brand prints them with ITS OWN
 * logo (the renderer resolves the order's brand logo → platform fallback; there
 * is no per-template logo override). Discounts are itemized so a receipt shows
 * exactly which savings applied (promotional / order / coupon / card).
 *
 * These are MANAGED starters: re-running refreshes each template's layout+config
 * to the latest (so design iterations propagate) while preserving is_default /
 * is_active — an admin-chosen default is never stolen. Run: npm run seed:invoice-templates
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource, IsNull } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Tenant } from './entities/tenant.entity';
import { InvoiceTemplate } from './entities/invoice-template.entity';
import type { InvoiceTemplateConfig } from './invoices/invoice-template-config';

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

/** Itemize the discount stages so every applied saving prints as its own line. */
const ITEMIZED_DISCOUNTS: Partial<InvoiceTemplateConfig> = {
    showDiscountTotal: false,
    showPromoDiscount: true,
    showOrderDiscount: true,
    showCouponDiscount: true,
    showCardDiscount: true,
};

/** Names from earlier versions of this seed, retired by the current set. */
const LEGACY_NAMES = ['Dine-in Bill — Bordered', 'Counter Receipt — Logo'];

const STARTER_TEMPLATES: Array<{
    name: string;
    layout: string;
    config: Partial<InvoiceTemplateConfig>;
    preferredDefault: boolean;
}> = [
    {
        name: 'Bordered Bill',
        layout: 'bill_bordered',
        config: { ...ITEMIZED_DISCOUNTS, showCashier: true, showTaxRate: true },
        preferredDefault: true,
    },
    {
        name: 'Logo Receipt',
        layout: 'receipt_logo',
        config: {
            ...ITEMIZED_DISCOUNTS,
            showCashier: true,
            footerText: 'Thank you for choosing us.\nSee you soon!',
        },
        preferredDefault: false,
    },
    {
        name: 'Bordered Logo Receipt',
        layout: 'receipt_bordered_logo',
        config: {
            ...ITEMIZED_DISCOUNTS,
            showCashier: true,
            showTaxRate: true,
            footerText: 'Thank you for choosing us.\nSee you soon!',
        },
        preferredDefault: false,
    },
    {
        name: 'Modern Minimal',
        layout: 'thermal_modern',
        config: {
            ...ITEMIZED_DISCOUNTS,
            showCashier: true,
            footerText: 'Thank you — see you again soon.',
        },
        preferredDefault: false,
    },
    {
        name: 'Classic Mono',
        layout: 'thermal_classic',
        config: { ...ITEMIZED_DISCOUNTS, showCashier: true, showTaxRate: true },
        preferredDefault: false,
    },
];

async function seed() {
    await dataSource.initialize();
    const tenantRepo = dataSource.getRepository(Tenant);
    const templateRepo = dataSource.getRepository(InvoiceTemplate);

    const tenants = await tenantRepo.find();
    if (tenants.length === 0) {
        console.log(
            'No tenants found — run the base seed first (npm run seed).',
        );
        await dataSource.destroy();
        return;
    }

    for (const tenant of tenants) {
        console.log(`\nTenant #${tenant.id} (${tenant.name}):`);
        // Drop retired starter rows first so a rename doesn't leave a stale copy.
        for (const legacy of LEGACY_NAMES) {
            const old = await templateRepo.findOne({
                where: { tenantId: tenant.id, brandId: IsNull(), name: legacy },
            });
            if (old) {
                const oldId = old.id;
                await templateRepo.remove(old);
                console.log(`  - removed retired "${legacy}" (id ${oldId})`);
            }
        }
        const hasDefault = await templateRepo.exist({
            where: { tenantId: tenant.id, brandId: IsNull(), isDefault: true },
        });
        let defaultAssigned = hasDefault;

        for (const t of STARTER_TEMPLATES) {
            const existing = await templateRepo.findOne({
                where: { tenantId: tenant.id, brandId: IsNull(), name: t.name },
            });
            if (existing) {
                // Refresh the managed design; keep the admin's default/active choice.
                existing.layout = t.layout;
                existing.config = t.config;
                const saved = await templateRepo.save(existing);
                console.log(
                    `  ~ "${t.name}" (${t.layout}) id ${saved.id} — refreshed${saved.isDefault ? ' (default)' : ''}`,
                );
                continue;
            }
            const makeDefault = t.preferredDefault && !defaultAssigned;
            const saved = await templateRepo.save(
                templateRepo.create({
                    tenantId: tenant.id,
                    brandId: null,
                    name: t.name,
                    layout: t.layout,
                    isActive: true,
                    isDefault: makeDefault,
                    config: t.config,
                }),
            );
            if (makeDefault) defaultAssigned = true;
            console.log(
                `  + "${t.name}" (${t.layout}) id ${saved.id}${makeDefault ? ' — set as tenant default' : ''}`,
            );
        }
    }

    console.log(
        '\nDone. Admins can switch the printing template under Admin → Invoice Templates.',
    );
    await dataSource.destroy();
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
