import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeLine } from '../entities/recipe-line.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryBatchOnHand } from '../entities/inventory-batch-on-hand.entity';
import { OrderInventoryAllocation } from '../entities/order-inventory-allocation.entity';
import { InventoryService } from './inventory.service';

@Injectable()
export class InventoryConsumptionService {
    constructor(
        private dataSource: DataSource,
        private inventoryService: InventoryService,
        @InjectRepository(Order) private ordersRepo: Repository<Order>,
        @InjectRepository(OrderItem)
        private orderItemsRepo: Repository<OrderItem>,
        @InjectRepository(Recipe) private recipesRepo: Repository<Recipe>,
        @InjectRepository(RecipeLine)
        private recipeLinesRepo: Repository<RecipeLine>,
        @InjectRepository(InventoryItem)
        private itemsRepo: Repository<InventoryItem>,
        @InjectRepository(InventoryBatch)
        private batchesRepo: Repository<InventoryBatch>,
        @InjectRepository(InventoryBatchOnHand)
        private batchOnHandRepo: Repository<InventoryBatchOnHand>,
        @InjectRepository(OrderInventoryAllocation)
        private allocationsRepo: Repository<OrderInventoryAllocation>,
    ) {}

    async consumeForOrder(orderId: number) {
        const order = await this.ordersRepo.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');

        const existingAlloc = await this.allocationsRepo.findOne({
            where: { orderId: order.id },
        });
        if (existingAlloc) return { ok: true, already_consumed: true };

        // Load order items with their selected add-ons and modifiers, so we can
        // deduct each selection's own recipe on top of the base dish recipe.
        const orderItems = await this.orderItemsRepo.find({
            where: { orderId: order.id },
            relations: { addons: true, modifiers: true },
        });
        if (orderItems.length === 0) return { ok: true };

        // Aggregate required qty per ingredient item in base units
        const requiredByItemId = new Map<number, number>();

        for (const oi of orderItems) {
            // Base dish recipe — scales with the line quantity.
            const baseRecipe =
                oi.menuItemId != null
                    ? await this.findActiveItemRecipe(
                          order.tenantId,
                          oi.menuItemId,
                          oi.variantId ?? null,
                      )
                    : null;
            await this.accumulateRecipe(
                order.tenantId,
                baseRecipe,
                Number(oi.quantity),
                requiredByItemId,
            );

            // Add-on recipes — scale with the add-on's own quantity (matches how
            // add-ons are priced: independent of the line quantity).
            for (const addon of oi.addons ?? []) {
                const addonRecipe = await this.findActiveAddonRecipe(
                    order.tenantId,
                    addon.addonId,
                );
                await this.accumulateRecipe(
                    order.tenantId,
                    addonRecipe,
                    Number(addon.quantity ?? 1),
                    requiredByItemId,
                );
            }

            // Modifier recipes — scale with the modifier's own quantity.
            for (const modifier of oi.modifiers ?? []) {
                if (modifier.modifierId == null) continue; // deleted modifier
                const modRecipe = await this.findActiveModifierRecipe(
                    order.tenantId,
                    modifier.modifierId,
                );
                await this.accumulateRecipe(
                    order.tenantId,
                    modRecipe,
                    Number(modifier.quantity ?? 1),
                    requiredByItemId,
                );
            }
        }

        if (requiredByItemId.size === 0) return { ok: true };

        return this.dataSource.transaction(async (manager) => {
            for (const [itemId, requiredQty] of requiredByItemId.entries()) {
                await this.allocateAndConsumeItem({
                    manager,
                    tenantId: order.tenantId,
                    branchId: order.branchId,
                    // Orders are single-brand; deduct strictly from this brand's
                    // bucket (null only for legacy/brand-less orders => branch pool).
                    brandId: order.brandId ?? null,
                    orderId: order.id,
                    inventoryItemId: itemId,
                    requiredQty,
                    createdBy: null,
                });
            }
            return { ok: true };
        });
    }

    async reverseConsumptionForOrder(orderId: number, userId: number | null) {
        const order = await this.ordersRepo.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');

        const allocations = await this.allocationsRepo.find({
            where: { orderId: order.id },
        });
        if (allocations.length === 0)
            return { ok: true, nothing_to_reverse: true };

        return this.dataSource.transaction(async (manager) => {
            // Reverse into the same brand bucket / batch.
            for (const a of allocations) {
                const qty = Number(a.qty);
                const brandId = a.brandId ?? null;
                const reverseKey = `order:${order.id}:reverse:item:${a.inventoryItemId}:batch:${a.inventoryBatchId ?? 'none'}`;

                await manager.query(
                    `
                    INSERT INTO inventory_ledger_entries
                        (tenant_id, branch_id, brand_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                         event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                    VALUES ($1,$2,$3,$4,$5,NULL,$6,'consume_reversal','order',$7,$8,$9,now())
                    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                    `,
                    [
                        order.tenantId,
                        order.branchId,
                        brandId,
                        a.inventoryItemId,
                        a.inventoryBatchId,
                        qty,
                        order.id,
                        reverseKey,
                        userId,
                    ],
                );

                await manager.query(
                    `
                    INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, brand_id, qty)
                    VALUES ($1,$2,$3,NULL,$4,$5)
                    ON CONFLICT (branch_id, inventory_item_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                    DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                    `,
                    [
                        order.tenantId,
                        order.branchId,
                        a.inventoryItemId,
                        brandId,
                        qty,
                    ],
                );

                // Clear the negative flag once the bucket is back to non-negative.
                await manager.query(
                    `
                    UPDATE inventory_on_hand
                    SET negative_flagged_at = NULL
                    WHERE tenant_id = $1 AND branch_id = $2 AND inventory_item_id = $3
                      AND location_id IS NULL AND brand_id IS NOT DISTINCT FROM $4
                      AND qty >= 0 AND negative_flagged_at IS NOT NULL
                    `,
                    [
                        order.tenantId,
                        order.branchId,
                        a.inventoryItemId,
                        brandId,
                    ],
                );

                // Batchless shortfall allocations have no batch row to re-credit.
                if (a.inventoryBatchId != null) {
                    await manager.query(
                        `
                        INSERT INTO inventory_batch_on_hand (tenant_id, branch_id, inventory_batch_id, location_id, brand_id, qty)
                        VALUES ($1,$2,$3,NULL,$4,$5)
                        ON CONFLICT (branch_id, inventory_batch_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                        DO UPDATE SET qty = inventory_batch_on_hand.qty + EXCLUDED.qty, updated_at = now()
                        `,
                        [
                            order.tenantId,
                            order.branchId,
                            a.inventoryBatchId,
                            brandId,
                            qty,
                        ],
                    );
                }
            }

            // Delete allocations (they're not immutable; ledger is immutable)
            await manager.getRepository(OrderInventoryAllocation).delete({
                orderId: order.id,
            });

            return { ok: true };
        });
    }

    /**
     * Add an active recipe's lines into the required-by-item map, scaled by
     * `multiplier` (line quantity for a dish, selection quantity for an add-on/modifier).
     */
    private async accumulateRecipe(
        tenantId: number,
        recipe: Recipe | null,
        multiplier: number,
        requiredByItemId: Map<number, number>,
    ) {
        if (!recipe || multiplier <= 0) return;
        const lines = await this.recipeLinesRepo.find({
            where: { recipeId: recipe.id },
        });
        for (const line of lines) {
            const baseQtyPerUnit =
                await this.inventoryService.convertToItemBaseQty(
                    tenantId,
                    line.inventoryItemId,
                    Number(line.qty),
                    line.uomId,
                );
            const wastageFactor = line.wastageFactor
                ? Number(line.wastageFactor)
                : 0;
            const needed = baseQtyPerUnit * (1 + wastageFactor) * multiplier;
            requiredByItemId.set(
                line.inventoryItemId,
                (requiredByItemId.get(line.inventoryItemId) ?? 0) + needed,
            );
        }
    }

    private async findActiveItemRecipe(
        tenantId: number,
        menuItemId: number,
        variantId: number | null,
    ) {
        // Prefer exact variant match; fallback to item-level recipe (variant_id null)
        if (variantId != null) {
            const variantRecipe = await this.recipesRepo.findOne({
                where: {
                    tenantId,
                    menuItemId,
                    variantId,
                    status: 'active',
                } as any,
                order: { version: 'DESC' },
            });
            if (variantRecipe) return variantRecipe;
        }
        return this.recipesRepo.findOne({
            where: {
                tenantId,
                menuItemId,
                variantId: null,
                status: 'active',
            } as any,
            order: { version: 'DESC' },
        });
    }

    private findActiveAddonRecipe(tenantId: number, addonId: number) {
        return this.recipesRepo.findOne({
            where: { tenantId, addonId, status: 'active' } as any,
            order: { version: 'DESC' },
        });
    }

    private findActiveModifierRecipe(tenantId: number, modifierId: number) {
        return this.recipesRepo.findOne({
            where: { tenantId, modifierId, status: 'active' } as any,
            order: { version: 'DESC' },
        });
    }

    private async allocateAndConsumeItem(args: {
        manager: any;
        tenantId: number;
        branchId: number;
        brandId: number | null;
        orderId: number;
        inventoryItemId: number;
        requiredQty: number;
        createdBy: number | null;
    }) {
        const { tenantId, branchId, brandId, orderId, inventoryItemId } = args;
        let remaining = args.requiredQty;

        // Lock eligible batches in THIS brand's bucket, ordered by FEFO (expiry ASC),
        // then by receivedAt. We only consume from the un-located bucket (location_id null).
        const rows = (await args.manager.query(
            `
            SELECT iboh.inventory_batch_id AS batch_id,
                   iboh.qty::numeric AS qty,
                   b.expiry_date AS expiry_date
            FROM inventory_batch_on_hand iboh
            INNER JOIN inventory_batches b ON b.id = iboh.inventory_batch_id
            WHERE iboh.tenant_id = $1
              AND iboh.branch_id = $2
              AND iboh.brand_id IS NOT DISTINCT FROM $3
              AND b.inventory_item_id = $4
              AND b.status = 'available'
              AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
              AND iboh.location_id IS NULL
              AND iboh.qty > 0
            ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC, iboh.inventory_batch_id ASC
            FOR UPDATE
            `,
            [tenantId, branchId, brandId, inventoryItemId],
        )) as Array<{ batch_id: number; qty: string }>;

        for (const r of rows) {
            if (remaining <= 0) break;
            const available = Number(r.qty);
            if (available <= 0) continue;
            const take = Math.min(available, remaining);
            remaining -= take;

            const idempotencyKey = `order:${orderId}:item:${inventoryItemId}:batch:${r.batch_id}`;

            await args.manager.query(
                `
                INSERT INTO inventory_ledger_entries
                    (tenant_id, branch_id, brand_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                     event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                VALUES ($1,$2,$3,$4,$5,NULL,$6,'consume','order',$7,$8,$9,now())
                ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                `,
                [
                    tenantId,
                    branchId,
                    brandId,
                    inventoryItemId,
                    r.batch_id,
                    -take,
                    orderId,
                    idempotencyKey,
                    args.createdBy,
                ],
            );

            await args.manager.query(
                `
                UPDATE inventory_batch_on_hand
                SET qty = qty - $1, updated_at = now()
                WHERE tenant_id = $2 AND branch_id = $3 AND inventory_batch_id = $4
                  AND location_id IS NULL AND brand_id IS NOT DISTINCT FROM $5
                `,
                [take, tenantId, branchId, r.batch_id, brandId],
            );

            await args.manager.query(
                `
                INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, brand_id, qty)
                VALUES ($1,$2,$3,NULL,$4,$5)
                ON CONFLICT (branch_id, inventory_item_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                `,
                [tenantId, branchId, inventoryItemId, brandId, -take],
            );

            await args.manager.getRepository(OrderInventoryAllocation).save(
                args.manager.getRepository(OrderInventoryAllocation).create({
                    tenantId,
                    branchId,
                    brandId,
                    orderId,
                    inventoryItemId,
                    inventoryBatchId: r.batch_id,
                    qty: take,
                }),
            );
        }

        // Allow-negative policy: never block the sale. Record any shortfall as a
        // batchless consume entry that drives the brand bucket negative and flag it.
        if (remaining > 1e-9) {
            const shortfallKey = `order:${orderId}:item:${inventoryItemId}:shortfall`;

            await args.manager.query(
                `
                INSERT INTO inventory_ledger_entries
                    (tenant_id, branch_id, brand_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                     event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                VALUES ($1,$2,$3,$4,NULL,NULL,$5,'consume_shortfall','order',$6,$7,$8,now())
                ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                `,
                [
                    tenantId,
                    branchId,
                    brandId,
                    inventoryItemId,
                    -remaining,
                    orderId,
                    shortfallKey,
                    args.createdBy,
                ],
            );

            await args.manager.query(
                `
                INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, brand_id, qty)
                VALUES ($1,$2,$3,NULL,$4,$5)
                ON CONFLICT (branch_id, inventory_item_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                `,
                [tenantId, branchId, inventoryItemId, brandId, -remaining],
            );

            await args.manager.query(
                `
                UPDATE inventory_on_hand
                SET negative_flagged_at = now()
                WHERE tenant_id = $1 AND branch_id = $2 AND inventory_item_id = $3
                  AND location_id IS NULL AND brand_id IS NOT DISTINCT FROM $4 AND qty < 0
                `,
                [tenantId, branchId, inventoryItemId, brandId],
            );

            await args.manager.getRepository(OrderInventoryAllocation).save(
                args.manager.getRepository(OrderInventoryAllocation).create({
                    tenantId,
                    branchId,
                    brandId,
                    orderId,
                    inventoryItemId,
                    inventoryBatchId: null,
                    qty: remaining,
                }),
            );
        }
    }
}
