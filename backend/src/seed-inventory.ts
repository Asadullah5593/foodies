/**
 * Seed inventory + procurement + recipes demo data into an existing seeded DB.
 *
 * Safe to run multiple times (idempotent by natural keys like tenant+code).
 *
 * Usage:
 *   npm run seed:inventory
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Tenant } from './entities/tenant.entity';
import { Brand } from './entities/brand.entity';
import { Branch } from './entities/branch.entity';
import { MenuItem } from './entities/menu-item.entity';
import { Uom } from './entities/uom.entity';
import { Vendor } from './entities/vendor.entity';
import { InventoryItem } from './entities/inventory-item.entity';
import { InventoryLocation } from './entities/inventory-location.entity';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { PurchaseRequisitionLine } from './entities/purchase-requisition-line.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { GoodsReceiptNote } from './entities/goods-receipt-note.entity';
import { GoodsReceiptNoteLine } from './entities/goods-receipt-note-line.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { Recipe } from './entities/recipe.entity';
import { RecipeLine } from './entities/recipe-line.entity';

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

async function upsertUom(
    tenantId: number,
    code: string,
    name: string,
    kind: string,
) {
    const repo = dataSource.getRepository(Uom);
    const existing = await repo.findOne({ where: { tenantId, code } });
    if (existing) return existing;
    return repo.save(
        repo.create({ tenantId, code, name, kind, isActive: true }),
    );
}

async function upsertVendor(tenantId: number, name: string, type: string) {
    const repo = dataSource.getRepository(Vendor);
    const existing = await repo.findOne({
        where: { tenantId, name, type } as any,
    });
    if (existing) return existing;
    return repo.save(repo.create({ tenantId, name, type, isActive: true }));
}

async function upsertInventoryItem(args: {
    tenantId: number;
    code: string;
    name: string;
    type: string;
    baseUomId: number;
    trackExpiry: boolean;
    defaultReorderPoint?: number | null;
    defaultNearExpiryDays?: number | null;
}) {
    const repo = dataSource.getRepository(InventoryItem);
    const existing = await repo.findOne({
        where: { tenantId: args.tenantId, code: args.code },
    });
    if (existing) return existing;
    return repo.save(
        repo.create({
            tenantId: args.tenantId,
            code: args.code,
            name: args.name,
            type: args.type,
            baseUomId: args.baseUomId,
            trackExpiry: args.trackExpiry,
            trackLot: true,
            isActive: true,
            defaultReorderPoint: args.defaultReorderPoint ?? null,
            defaultNearExpiryDays: args.defaultNearExpiryDays ?? null,
        }),
    );
}

async function upsertLocation(
    tenantId: number,
    branchId: number,
    code: string,
    name: string,
) {
    const repo = dataSource.getRepository(InventoryLocation);
    const existing = await repo.findOne({
        where: { tenantId, branchId, code },
    });
    if (existing) return existing;
    return repo.save(
        repo.create({ tenantId, branchId, code, name, isActive: true }),
    );
}

async function ensureActiveRecipe(args: {
    tenantId: number;
    menuItemId: number;
    createdBy: number | null;
    lines: Array<{ inventoryItemId: number; qty: number; uomId: number }>;
}) {
    const recipeRepo = dataSource.getRepository(Recipe);
    const lineRepo = dataSource.getRepository(RecipeLine);

    const existingActive = await recipeRepo.findOne({
        where: {
            tenantId: args.tenantId,
            menuItemId: args.menuItemId,
            variantId: null,
            status: 'active',
        } as any,
        relations: { lines: true },
    });
    if (existingActive) return existingActive;

    const latest = await recipeRepo.findOne({
        where: {
            tenantId: args.tenantId,
            menuItemId: args.menuItemId,
            variantId: null,
        } as any,
        order: { version: 'DESC' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    // Archive others
    await recipeRepo.update(
        {
            tenantId: args.tenantId,
            menuItemId: args.menuItemId,
            variantId: null,
        } as any,
        { status: 'archived' },
    );

    const recipe = await recipeRepo.save(
        recipeRepo.create({
            tenantId: args.tenantId,
            menuItemId: args.menuItemId,
            variantId: null,
            version: nextVersion,
            status: 'active',
            notes: 'Seeded demo recipe (inventory integration)',
            createdBy: args.createdBy,
        }),
    );

    for (const l of args.lines) {
        await lineRepo.save(
            lineRepo.create({
                recipeId: recipe.id,
                inventoryItemId: l.inventoryItemId,
                qty: l.qty,
                uomId: l.uomId,
                wastageFactor: null,
                notes: null,
            }),
        );
    }

    return recipe;
}

async function main() {
    await dataSource.initialize();

    // Attach to an existing tenant + branch + menu item in the current DB.
    const tenantRepo = dataSource.getRepository(Tenant);
    const branchRepo = dataSource.getRepository(Branch);
    const menuItemRepo = dataSource.getRepository(MenuItem);

    const tenants = await tenantRepo.find({ order: { id: 'ASC' } });
    if (tenants.length === 0) {
        throw new Error('No tenants found. Seed your base data first.');
    }

    // Pick the first tenant that has at least one branch and one menu item.
    let picked: {
        tenant: Tenant;
        branchId: number;
        menuItemId: number;
    } | null = null;
    for (const t of tenants) {
        const branchRow = await dataSource.query(
            `
            SELECT b.id
            FROM branches b
            INNER JOIN branch_brands bb ON bb.branch_id = b.id
            INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
            ORDER BY b.id ASC
            LIMIT 1
            `,
            [t.id],
        );
        const menuRow = await dataSource.query(
            `
            SELECT mi.id
            FROM menu_items mi
            INNER JOIN brands br ON br.id = mi.brand_id AND br.tenant_id = $1
            ORDER BY mi.id ASC
            LIMIT 1
            `,
            [t.id],
        );
        if (branchRow[0]?.id && menuRow[0]?.id) {
            picked = {
                tenant: t,
                branchId: branchRow[0].id,
                menuItemId: menuRow[0].id,
            };
            break;
        }
    }

    if (!picked) {
        throw new Error(
            'Could not find a tenant with at least 1 branch + 1 menu item. Create those first, then rerun seed:inventory.',
        );
    }

    const tenant = picked.tenant;
    const branch = await branchRepo.findOne({ where: { id: picked.branchId } });
    if (!branch) throw new Error('Picked branch not found');
    const menuItem = await menuItemRepo.findOne({
        where: { id: picked.menuItemId },
    });
    if (!menuItem) throw new Error('Picked menu item not found');

    // --- UOMs (tenant scoped) ---
    const pcs = await upsertUom(tenant.id, 'pcs', 'Pieces', 'count');
    const g = await upsertUom(tenant.id, 'g', 'Gram', 'mass');
    const kg = await upsertUom(tenant.id, 'kg', 'Kilogram', 'mass');
    // Link kg -> g conversion (1 kg = 1000 g)
    if (kg.baseUomId == null || kg.multiplierToBase == null) {
        kg.baseUomId = g.id;
        kg.multiplierToBase = 1000;
        await dataSource.getRepository(Uom).save(kg);
    }
    const ml = await upsertUom(tenant.id, 'ml', 'Milliliter', 'volume');
    const l = await upsertUom(tenant.id, 'l', 'Liter', 'volume');
    if (l.baseUomId == null || l.multiplierToBase == null) {
        l.baseUomId = ml.id;
        l.multiplierToBase = 1000;
        await dataSource.getRepository(Uom).save(l);
    }

    // --- Vendors ---
    const warehouse = await upsertVendor(
        tenant.id,
        'Central Warehouse',
        'warehouse',
    );
    await upsertVendor(tenant.id, 'Local Produce Supplier', 'supplier');

    // --- Locations (branch) ---
    const dry = await upsertLocation(tenant.id, branch.id, 'dry', 'Dry store');
    const chiller = await upsertLocation(
        tenant.id,
        branch.id,
        'chiller',
        'Chiller',
    );

    // --- Inventory items (tenant) ---
    const bun = await upsertInventoryItem({
        tenantId: tenant.id,
        code: 'BUN',
        name: 'Burger Bun',
        type: 'ingredient',
        baseUomId: pcs.id,
        trackExpiry: true,
        defaultReorderPoint: 10,
        defaultNearExpiryDays: 3,
    });
    const patty = await upsertInventoryItem({
        tenantId: tenant.id,
        code: 'PATTY',
        name: 'Beef Patty',
        type: 'ingredient',
        baseUomId: pcs.id,
        trackExpiry: true,
        defaultReorderPoint: 10,
        defaultNearExpiryDays: 4,
    });
    const lettuce = await upsertInventoryItem({
        tenantId: tenant.id,
        code: 'LETTUCE',
        name: 'Lettuce',
        type: 'ingredient',
        baseUomId: g.id,
        trackExpiry: true,
        defaultReorderPoint: 500,
        defaultNearExpiryDays: 2,
    });

    // --- Procurement flow (PR -> PO -> GRN posted) ---
    const prRepo = dataSource.getRepository(PurchaseRequisition);
    const prLineRepo = dataSource.getRepository(PurchaseRequisitionLine);
    const poRepo = dataSource.getRepository(PurchaseOrder);
    const poLineRepo = dataSource.getRepository(PurchaseOrderLine);
    const grnRepo = dataSource.getRepository(GoodsReceiptNote);
    const grnLineRepo = dataSource.getRepository(GoodsReceiptNoteLine);
    const batchRepo = dataSource.getRepository(InventoryBatch);

    const existingPO = await poRepo.findOne({
        where: { tenantId: tenant.id, poNumber: `PO-DEMO-${tenant.id}-001` },
    });
    if (!existingPO) {
        const pr = await prRepo.save(
            prRepo.create({
                tenantId: tenant.id,
                requestingBranchId: branch.id,
                requestedFromVendorId: warehouse.id,
                status: 'approved',
                notes: 'Demo PR (seed)',
                approvedBy: null,
                approvedAt: new Date(),
                createdBy: null,
            }),
        );
        await prLineRepo.save([
            prLineRepo.create({
                purchaseRequisitionId: pr.id,
                inventoryItemId: bun.id,
                requestedQty: 20,
                requestedUomId: pcs.id,
                notes: null,
            }),
            prLineRepo.create({
                purchaseRequisitionId: pr.id,
                inventoryItemId: patty.id,
                requestedQty: 20,
                requestedUomId: pcs.id,
                notes: null,
            }),
            prLineRepo.create({
                purchaseRequisitionId: pr.id,
                inventoryItemId: lettuce.id,
                requestedQty: 2000,
                requestedUomId: g.id,
                notes: null,
            }),
        ]);

        const po = await poRepo.save(
            poRepo.create({
                tenantId: tenant.id,
                poNumber: `PO-DEMO-${tenant.id}-001`,
                buyerBranchId: branch.id,
                vendorId: warehouse.id,
                purchaseRequisitionId: pr.id,
                status: 'created',
                expectedDeliveryDate: null,
                notes: 'Demo PO (seed)',
                approvedBy: null,
                approvedAt: new Date(),
                createdBy: null,
            }),
        );
        const poLines = await poLineRepo.save([
            poLineRepo.create({
                purchaseOrderId: po.id,
                inventoryItemId: bun.id,
                orderedQty: 20,
                orderedUomId: pcs.id,
                unitCost: 0.25,
                taxRate: null,
                notes: null,
            }),
            poLineRepo.create({
                purchaseOrderId: po.id,
                inventoryItemId: patty.id,
                orderedQty: 20,
                orderedUomId: pcs.id,
                unitCost: 1.5,
                taxRate: null,
                notes: null,
            }),
            poLineRepo.create({
                purchaseOrderId: po.id,
                inventoryItemId: lettuce.id,
                orderedQty: 2000,
                orderedUomId: g.id,
                unitCost: 0.004,
                taxRate: null,
                notes: null,
            }),
        ]);

        const grn = await grnRepo.save(
            grnRepo.create({
                tenantId: tenant.id,
                branchId: branch.id,
                purchaseOrderId: po.id,
                status: 'posted',
                receivedBy: null,
                receivedAt: new Date(),
                postedBy: null,
                postedAt: new Date(),
                notes: 'Demo GRN (seed)',
            }),
        );

        // Two batches for lettuce (to demonstrate FEFO: earlier expiry should be consumed first)
        const today = new Date();
        const expirySoon = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
        const expiryLater = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);

        const grnLines = await grnLineRepo.save([
            grnLineRepo.create({
                goodsReceiptNoteId: grn.id,
                purchaseOrderLineId: poLines[0].id,
                inventoryItemId: bun.id,
                receivedQty: 20,
                receivedUomId: pcs.id,
                lotCode: 'BUN-LOT-1',
                expiryDate: fmt(expiryLater),
                locationId: dry.id,
                notes: null,
            }),
            grnLineRepo.create({
                goodsReceiptNoteId: grn.id,
                purchaseOrderLineId: poLines[1].id,
                inventoryItemId: patty.id,
                receivedQty: 20,
                receivedUomId: pcs.id,
                lotCode: 'PAT-LOT-1',
                expiryDate: fmt(expirySoon),
                locationId: chiller.id,
                notes: null,
            }),
            grnLineRepo.create({
                goodsReceiptNoteId: grn.id,
                purchaseOrderLineId: poLines[2].id,
                inventoryItemId: lettuce.id,
                receivedQty: 800,
                receivedUomId: g.id,
                lotCode: 'LET-LOT-A',
                expiryDate: fmt(expirySoon),
                locationId: chiller.id,
                notes: null,
            }),
            grnLineRepo.create({
                goodsReceiptNoteId: grn.id,
                purchaseOrderLineId: poLines[2].id,
                inventoryItemId: lettuce.id,
                receivedQty: 1200,
                receivedUomId: g.id,
                lotCode: 'LET-LOT-B',
                expiryDate: fmt(expiryLater),
                locationId: chiller.id,
                notes: null,
            }),
        ]);

        // Create batches and ledger movements exactly like postGRN would (simplified seed):
        // We insert into inventory_batches and inventory_*_on_hand / ledger via SQL, mirroring the service.
        for (const line of grnLines) {
            const batch = await batchRepo.save(
                batchRepo.create({
                    tenantId: tenant.id,
                    branchId: branch.id,
                    inventoryItemId: line.inventoryItemId,
                    vendorId: warehouse.id,
                    purchaseOrderId: po.id,
                    goodsReceiptNoteId: grn.id,
                    lotCode: line.lotCode ?? null,
                    batchVersion: 'v1',
                    expiryDate: line.expiryDate ?? null,
                    receivedAt: new Date(),
                    status: 'available',
                }),
            );

            const qtyDelta = Number(line.receivedQty);
            await dataSource.query(
                `
                INSERT INTO inventory_ledger_entries
                    (tenant_id, branch_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                     event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,'receive','grn',$7,$8,NULL,now())
                ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                `,
                [
                    tenant.id,
                    branch.id,
                    line.inventoryItemId,
                    batch.id,
                    line.locationId,
                    qtyDelta,
                    grn.id,
                    `seed:grn:${grn.id}:line:${line.id}`,
                ],
            );
            await dataSource.query(
                `
                INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, qty)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (branch_id, inventory_item_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                `,
                [
                    tenant.id,
                    branch.id,
                    line.inventoryItemId,
                    line.locationId,
                    qtyDelta,
                ],
            );
            await dataSource.query(
                `
                INSERT INTO inventory_batch_on_hand (tenant_id, branch_id, inventory_batch_id, location_id, qty)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (branch_id, inventory_batch_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                DO UPDATE SET qty = inventory_batch_on_hand.qty + EXCLUDED.qty, updated_at = now()
                `,
                [tenant.id, branch.id, batch.id, line.locationId, qtyDelta],
            );
        }
    }

    // --- Recipe linked to menu item (Acme Burger) ---
    await ensureActiveRecipe({
        tenantId: tenant.id,
        menuItemId: menuItem.id,
        createdBy: null,
        lines: [
            { inventoryItemId: bun.id, qty: 1, uomId: pcs.id },
            { inventoryItemId: patty.id, qty: 1, uomId: pcs.id },
            { inventoryItemId: lettuce.id, qty: 30, uomId: g.id },
        ],
    });

    console.log(`
Seeded demo inventory data (tenant: ${tenant.slug}, branch: ${branch.code}):
- UOMs: pcs, g, kg (kg->g), ml, l (l->ml)
- Vendor: Central Warehouse (warehouse)
- Locations: dry, chiller
- Inventory items: BUN, PATTY, LETTUCE
- PO + GRN batches with expiry (lettuce has 2 batches for FEFO)
- Recipe: selected menu item (id: ${menuItem.id}) consumes bun(1pcs), patty(1pcs), lettuce(30g)

Try in UI:
1) Admin -> Inventory: select branch "${branch.name} (${branch.code})" -> On-hand / Ledger / Alerts
2) Admin -> Procurement: view PR/PO/GRN demo records
3) Admin -> Recipes: select the seeded recipe (menu_item_id=${menuItem.id}) and compute cost for this branch
4) POS: place an order for that menu item; inventory will deduct via FEFO and ledger will show 'consume' entries.`);

    await dataSource.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
