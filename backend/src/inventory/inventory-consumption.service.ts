import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
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

        const orderItems = await this.orderItemsRepo.find({
            where: { orderId: order.id },
        });
        if (orderItems.length === 0) return { ok: true };

        // Aggregate required qty per ingredient item in base units
        const requiredByItemId = new Map<number, number>();

        for (const oi of orderItems) {
            const recipe = await this.findActiveRecipe(
                order.tenantId,
                oi.menuItemId,
                oi.variantId ?? null,
            );
            if (!recipe) continue; // no recipe => no deduction

            const lines = await this.recipeLinesRepo.find({
                where: { recipeId: recipe.id },
            });
            for (const line of lines) {
                const baseQtyPerUnit =
                    await this.inventoryService.convertToItemBaseQty(
                        order.tenantId,
                        line.inventoryItemId,
                        Number(line.qty),
                        line.uomId,
                    );
                const wastageFactor = line.wastageFactor
                    ? Number(line.wastageFactor)
                    : 0;
                const needed =
                    baseQtyPerUnit * (1 + wastageFactor) * Number(oi.quantity);
                requiredByItemId.set(
                    line.inventoryItemId,
                    (requiredByItemId.get(line.inventoryItemId) ?? 0) + needed,
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
            // Reverse in same batches
            for (const a of allocations) {
                const qty = Number(a.qty);
                const reverseKey = `order:${order.id}:reverse:item:${a.inventoryItemId}:batch:${a.inventoryBatchId}`;

                await manager.query(
                    `
                    INSERT INTO inventory_ledger_entries
                        (tenant_id, branch_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                         event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                    VALUES ($1,$2,$3,$4,NULL,$5,'consume_reversal','order',$6,$7,$8,now())
                    ON CONFLICT (idempotency_key) DO NOTHING
                    `,
                    [
                        order.tenantId,
                        order.branchId,
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
                    INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, qty)
                    VALUES ($1,$2,$3,NULL,$4)
                    ON CONFLICT (branch_id, inventory_item_id, location_id)
                    DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                    `,
                    [order.tenantId, order.branchId, a.inventoryItemId, qty],
                );

                await manager.query(
                    `
                    INSERT INTO inventory_batch_on_hand (tenant_id, branch_id, inventory_batch_id, location_id, qty)
                    VALUES ($1,$2,$3,NULL,$4)
                    ON CONFLICT (branch_id, inventory_batch_id, location_id)
                    DO UPDATE SET qty = inventory_batch_on_hand.qty + EXCLUDED.qty, updated_at = now()
                    `,
                    [order.tenantId, order.branchId, a.inventoryBatchId, qty],
                );
            }

            // Delete allocations (they're not immutable; ledger is immutable)
            await manager.getRepository(OrderInventoryAllocation).delete({
                orderId: order.id,
            });

            return { ok: true };
        });
    }

    private async findActiveRecipe(
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

    private async allocateAndConsumeItem(args: {
        manager: any;
        tenantId: number;
        branchId: number;
        orderId: number;
        inventoryItemId: number;
        requiredQty: number;
        createdBy: number | null;
    }) {
        const { tenantId, branchId, orderId, inventoryItemId } = args;
        let remaining = args.requiredQty;

        // Lock eligible batches ordered by FEFO (expiry ASC), then by receivedAt.
        // We only lock batch_on_hand rows (location_id null), which is what we use for consumption.
        const rows = (await args.manager.query(
            `
            SELECT iboh.inventory_batch_id AS batch_id,
                   iboh.qty::numeric AS qty,
                   b.expiry_date AS expiry_date
            FROM inventory_batch_on_hand iboh
            INNER JOIN inventory_batches b ON b.id = iboh.inventory_batch_id
            WHERE iboh.tenant_id = $1
              AND iboh.branch_id = $2
              AND b.inventory_item_id = $3
              AND b.status = 'available'
              AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
              AND iboh.location_id IS NULL
              AND iboh.qty > 0
            ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC, iboh.inventory_batch_id ASC
            FOR UPDATE
            `,
            [tenantId, branchId, inventoryItemId],
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
                    (tenant_id, branch_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                     event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                VALUES ($1,$2,$3,$4,NULL,$5,'consume','order',$6,$7,$8,now())
                ON CONFLICT (idempotency_key) DO NOTHING
                `,
                [
                    tenantId,
                    branchId,
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
                WHERE tenant_id = $2 AND branch_id = $3 AND inventory_batch_id = $4 AND location_id IS NULL
                `,
                [take, tenantId, branchId, r.batch_id],
            );

            await args.manager.query(
                `
                INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, qty)
                VALUES ($1,$2,$3,NULL,$4)
                ON CONFLICT (branch_id, inventory_item_id, location_id)
                DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                `,
                [tenantId, branchId, inventoryItemId, -take],
            );

            await args.manager.getRepository(OrderInventoryAllocation).save(
                args.manager.getRepository(OrderInventoryAllocation).create({
                    tenantId,
                    branchId,
                    orderId,
                    inventoryItemId,
                    inventoryBatchId: r.batch_id,
                    qty: take,
                }),
            );
        }

        if (remaining > 1e-9) {
            throw new BadRequestException(
                `Insufficient stock for item ${inventoryItemId}. Missing: ${remaining}`,
            );
        }
    }
}
