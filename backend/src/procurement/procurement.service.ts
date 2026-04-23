import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../inventory/inventory.service';
import { PurchaseRequisition } from '../entities/purchase-requisition.entity';
import { PurchaseRequisitionLine } from '../entities/purchase-requisition-line.entity';
import { PurchaseOrder } from '../entities/purchase-order.entity';
import { PurchaseOrderLine } from '../entities/purchase-order-line.entity';
import { GoodsReceiptNote } from '../entities/goods-receipt-note.entity';
import { GoodsReceiptNoteLine } from '../entities/goods-receipt-note-line.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { Vendor } from '../entities/vendor.entity';

type TenantContextUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
};

@Injectable()
export class ProcurementService {
    constructor(
        private dataSource: DataSource,
        private branchesService: BranchesService,
        private inventoryService: InventoryService,
        @InjectRepository(PurchaseRequisition)
        private prRepo: Repository<PurchaseRequisition>,
        @InjectRepository(PurchaseRequisitionLine)
        private prLinesRepo: Repository<PurchaseRequisitionLine>,
        @InjectRepository(PurchaseOrder)
        private poRepo: Repository<PurchaseOrder>,
        @InjectRepository(PurchaseOrderLine)
        private poLinesRepo: Repository<PurchaseOrderLine>,
        @InjectRepository(GoodsReceiptNote)
        private grnRepo: Repository<GoodsReceiptNote>,
        @InjectRepository(GoodsReceiptNoteLine)
        private grnLinesRepo: Repository<GoodsReceiptNoteLine>,
        @InjectRepository(InventoryBatch)
        private batchesRepo: Repository<InventoryBatch>,
        @InjectRepository(InventoryItem)
        private itemsRepo: Repository<InventoryItem>,
        @InjectRepository(Vendor)
        private vendorsRepo: Repository<Vendor>,
    ) {}

    private async resolveTenantId(user: TenantContextUser, branchId?: number) {
        return this.inventoryService.resolveTenantId(user, branchId);
    }

    async resolveTenantIdForList(user: TenantContextUser): Promise<number> {
        // For list endpoints, tenant users can use their JWT tenantId; super admin must supply branch context elsewhere.
        if (user.tenantId != null) return user.tenantId;
        if (user.isSuperAdmin === true) {
            throw new ForbiddenException(
                'Super admin must provide branch context for procurement operations',
            );
        }
        throw new ForbiddenException('Tenant context required');
    }

    // ---------------- PR ----------------
    async createPR(
        user: TenantContextUser,
        dto: {
            requesting_branch_id: number;
            requested_from_vendor_id: number;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string;
            }>;
        },
    ) {
        const tenantId = await this.resolveTenantId(
            user,
            dto.requesting_branch_id,
        );

        return this.dataSource.transaction(async (manager) => {
            const pr = await manager.getRepository(PurchaseRequisition).save(
                manager.getRepository(PurchaseRequisition).create({
                    tenantId,
                    requestingBranchId: dto.requesting_branch_id,
                    requestedFromVendorId: dto.requested_from_vendor_id,
                    status: 'draft',
                    notes: dto.notes ?? null,
                    createdBy: user.id,
                }),
            );

            for (const l of dto.lines ?? []) {
                await manager.getRepository(PurchaseRequisitionLine).save(
                    manager.getRepository(PurchaseRequisitionLine).create({
                        purchaseRequisitionId: pr.id,
                        inventoryItemId: l.inventory_item_id,
                        requestedQty: l.requested_qty,
                        requestedUomId: l.requested_uom_id,
                        notes: l.notes ?? null,
                    }),
                );
            }

            return this.getPR(tenantId, pr.id);
        });
    }

    async listPRs(tenantId: number) {
        return this.prRepo.find({
            where: { tenantId },
            order: { id: 'DESC' },
            relations: { lines: true },
        });
    }

    async getPR(tenantId: number, id: number) {
        const pr = await this.prRepo.findOne({
            where: { tenantId, id },
            relations: { lines: true },
        });
        if (!pr) throw new NotFoundException('PR not found');
        return pr;
    }

    async submitPR(user: TenantContextUser, prId: number) {
        const pr = await this.prRepo.findOne({ where: { id: prId } });
        if (!pr) throw new NotFoundException('PR not found');
        const tenantId = await this.resolveTenantId(user, pr.requestingBranchId);
        if (pr.tenantId !== tenantId) throw new ForbiddenException();
        if (pr.status !== 'draft') {
            throw new BadRequestException('Only draft PR can be submitted');
        }
        pr.status = 'submitted';
        await this.prRepo.save(pr);
        return this.getPR(tenantId, prId);
    }

    async approvePRAndCreatePO(args: {
        user: TenantContextUser;
        prId: number;
        po_number?: string;
        expected_delivery_date?: string | null;
        notes?: string | null;
    }) {
        const pr = await this.prRepo.findOne({
            where: { id: args.prId },
            relations: { lines: true },
        });
        if (!pr) throw new NotFoundException('PR not found');
        const tenantId = await this.resolveTenantId(
            args.user,
            pr.requestingBranchId,
        );
        if (pr.tenantId !== tenantId) throw new ForbiddenException();
        if (pr.status !== 'submitted') {
            throw new BadRequestException('Only submitted PR can be approved');
        }

        const poNumber =
            args.po_number ??
            `PO-${tenantId}-${Date.now().toString().slice(-8)}`;

        return this.dataSource.transaction(async (manager) => {
            pr.status = 'approved';
            pr.approvedBy = args.user.id;
            pr.approvedAt = new Date();
            await manager.getRepository(PurchaseRequisition).save(pr);

            const po = await manager.getRepository(PurchaseOrder).save(
                manager.getRepository(PurchaseOrder).create({
                    tenantId,
                    poNumber,
                    buyerBranchId: pr.requestingBranchId,
                    vendorId: pr.requestedFromVendorId,
                    purchaseRequisitionId: pr.id,
                    status: 'created',
                    expectedDeliveryDate: args.expected_delivery_date ?? null,
                    notes: args.notes ?? null,
                    approvedBy: args.user.id,
                    approvedAt: new Date(),
                    createdBy: args.user.id,
                }),
            );

            for (const l of pr.lines ?? []) {
                await manager.getRepository(PurchaseOrderLine).save(
                    manager.getRepository(PurchaseOrderLine).create({
                        purchaseOrderId: po.id,
                        inventoryItemId: l.inventoryItemId,
                        orderedQty: l.requestedQty,
                        orderedUomId: l.requestedUomId,
                        unitCost: null,
                        taxRate: null,
                        notes: l.notes ?? null,
                    }),
                );
            }

            return this.getPO(tenantId, po.id);
        });
    }

    async rejectPR(user: TenantContextUser, prId: number, reason?: string) {
        const pr = await this.prRepo.findOne({ where: { id: prId } });
        if (!pr) throw new NotFoundException('PR not found');
        const tenantId = await this.resolveTenantId(user, pr.requestingBranchId);
        if (pr.tenantId !== tenantId) throw new ForbiddenException();
        if (pr.status !== 'submitted') {
            throw new BadRequestException('Only submitted PR can be rejected');
        }
        pr.status = 'rejected';
        pr.approvedBy = user.id;
        pr.approvedAt = new Date();
        pr.notes = reason ? `${pr.notes ?? ''}\nREJECTED: ${reason}` : pr.notes;
        await this.prRepo.save(pr);
        return this.getPR(tenantId, prId);
    }

    // ---------------- PO ----------------
    async listPOs(tenantId: number) {
        return this.poRepo.find({
            where: { tenantId },
            order: { id: 'DESC' },
            relations: { lines: true },
        });
    }

    async getPO(tenantId: number, poId: number) {
        const po = await this.poRepo.findOne({
            where: { tenantId, id: poId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');
        return po;
    }

    // ---------------- GRN ----------------
    async createGRN(
        user: TenantContextUser,
        dto: { purchase_order_id: number; branch_id: number; notes?: string },
    ) {
        const tenantId = await this.resolveTenantId(user, dto.branch_id);
        const po = await this.poRepo.findOne({
            where: { tenantId, id: dto.purchase_order_id },
        });
        if (!po) throw new NotFoundException('PO not found');
        if (po.buyerBranchId !== dto.branch_id) {
            throw new BadRequestException(
                'GRN branch must match PO buyer branch',
            );
        }
        const grn = await this.grnRepo.save(
            this.grnRepo.create({
                tenantId,
                branchId: dto.branch_id,
                purchaseOrderId: dto.purchase_order_id,
                status: 'draft',
                receivedBy: user.id,
                receivedAt: new Date(),
                notes: dto.notes ?? null,
            }),
        );
        return this.getGRN(tenantId, grn.id);
    }

    async addGRNLine(
        user: TenantContextUser,
        grnId: number,
        dto: {
            purchase_order_line_id?: number | null;
            inventory_item_id: number;
            received_qty: number;
            received_uom_id: number;
            lot_code?: string | null;
            expiry_date?: string | null;
            location_id?: number | null;
            notes?: string | null;
        },
    ) {
        const grn = await this.grnRepo.findOne({ where: { id: grnId } });
        if (!grn) throw new NotFoundException('GRN not found');
        const tenantId = await this.resolveTenantId(user, grn.branchId);
        if (grn.tenantId !== tenantId) throw new ForbiddenException();
        if (grn.status !== 'draft') {
            throw new BadRequestException('Only draft GRN can be edited');
        }

        const item = await this.itemsRepo.findOne({
            where: { id: dto.inventory_item_id, tenantId },
        });
        if (!item) throw new NotFoundException('Inventory item not found');
        if (item.trackExpiry && !dto.expiry_date) {
            throw new BadRequestException(
                'Expiry date is required for this item',
            );
        }

        const line = await this.grnLinesRepo.save(
            this.grnLinesRepo.create({
                goodsReceiptNoteId: grn.id,
                purchaseOrderLineId: dto.purchase_order_line_id ?? null,
                inventoryItemId: dto.inventory_item_id,
                receivedQty: dto.received_qty,
                receivedUomId: dto.received_uom_id,
                lotCode: dto.lot_code ?? null,
                expiryDate: dto.expiry_date ?? null,
                locationId: dto.location_id ?? null,
                notes: dto.notes ?? null,
            }),
        );

        return line;
    }

    async getGRN(tenantId: number, grnId: number) {
        const grn = await this.grnRepo.findOne({
            where: { tenantId, id: grnId },
            relations: { lines: true },
        });
        if (!grn) throw new NotFoundException('GRN not found');
        return grn;
    }

    async listGRNs(tenantId: number) {
        return this.grnRepo.find({
            where: { tenantId },
            order: { id: 'DESC' },
            relations: { lines: true },
        });
    }

    async postGRN(user: TenantContextUser, grnId: number) {
        const grn = await this.grnRepo.findOne({
            where: { id: grnId },
            relations: { lines: true },
        });
        if (!grn) throw new NotFoundException('GRN not found');
        const tenantId = await this.resolveTenantId(user, grn.branchId);
        if (grn.tenantId !== tenantId) throw new ForbiddenException();
        if (grn.status !== 'draft') {
            throw new BadRequestException('Only draft GRN can be posted');
        }
        if (!grn.lines || grn.lines.length === 0) {
            throw new BadRequestException('GRN has no lines');
        }

        const po = await this.poRepo.findOne({
            where: { tenantId, id: grn.purchaseOrderId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');

        const vendor = await this.vendorsRepo.findOne({
            where: { id: po.vendorId, tenantId },
        });
        if (!vendor) throw new NotFoundException('Vendor not found');

        const postedAt = new Date();

        return this.dataSource.transaction(async (manager) => {
            // Mark GRN posted
            grn.status = 'posted';
            grn.postedAt = postedAt;
            grn.postedBy = user.id;
            await manager.getRepository(GoodsReceiptNote).save(grn);

            // Track per-item total receipt for updating PO status
            const receivedByItem = new Map<number, number>();

            const movements: Array<{
                inventoryItemId: number;
                inventoryBatchId: number;
                locationId: number | null;
                qtyDelta: number;
                idempotencyKey: string;
            }> = [];

            // Create a batch per GRN line and post receive movements
            for (const line of grn.lines) {
                const item = await manager.getRepository(InventoryItem).findOne({
                    where: { id: line.inventoryItemId, tenantId },
                });
                if (!item) throw new NotFoundException('Inventory item not found');
                if (item.trackExpiry && !line.expiryDate) {
                    throw new BadRequestException(
                        `Missing expiry_date for item ${item.code}`,
                    );
                }

                const qtyBase = await this.inventoryService.convertToItemBaseQty(
                    tenantId,
                    item.id,
                    Number(line.receivedQty),
                    line.receivedUomId,
                );

                const batch = await manager.getRepository(InventoryBatch).save(
                    manager.getRepository(InventoryBatch).create({
                        tenantId,
                        branchId: grn.branchId,
                        inventoryItemId: item.id,
                        vendorId: vendor.id,
                        purchaseOrderId: po.id,
                        goodsReceiptNoteId: grn.id,
                        lotCode: line.lotCode ?? null,
                        batchVersion: 'v1',
                        expiryDate: line.expiryDate ?? null,
                        receivedAt: postedAt,
                        status: 'available',
                    }),
                );

                movements.push({
                    inventoryItemId: item.id,
                    inventoryBatchId: batch.id,
                    locationId: line.locationId ?? null,
                    qtyDelta: qtyBase,
                    idempotencyKey: `grn:${grn.id}:line:${line.id}:receive`,
                });

                receivedByItem.set(
                    item.id,
                    (receivedByItem.get(item.id) ?? 0) + qtyBase,
                );

                // Cost: if PO line has unit cost, store per-base unit cost snapshot
                const poLine = line.purchaseOrderLineId
                    ? po.lines?.find((l) => l.id === line.purchaseOrderLineId) ??
                      null
                    : null;
                if (poLine?.unitCost != null) {
                    const unitCostPerBase =
                        (Number(poLine.unitCost) /
                            (await this.inventoryService.convertToItemBaseQty(
                                tenantId,
                                item.id,
                                1,
                                poLine.orderedUomId,
                            ))) *
                        1;
                    await manager.query(
                        `
                        INSERT INTO inventory_item_costs
                            (tenant_id, branch_id, inventory_item_id, effective_at, unit_cost, currency, source_type, source_id)
                        VALUES ($1,$2,$3,now(),$4,NULL,'grn',$5)
                        `,
                        [tenantId, grn.branchId, item.id, unitCostPerBase, grn.id],
                    );
                }
            }

            // Post movements via InventoryService (same datasource, but we are inside a transaction manager)
            // We do a manual insert/update to reuse same transaction context.
            for (const m of movements) {
                await manager.query(
                    `
                    INSERT INTO inventory_ledger_entries
                        (tenant_id, branch_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                         event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                    VALUES ($1,$2,$3,$4,$5,$6,'receive','grn',$7,$8,$9,now())
                    ON CONFLICT (idempotency_key) DO NOTHING
                    `,
                    [
                        tenantId,
                        grn.branchId,
                        m.inventoryItemId,
                        m.inventoryBatchId,
                        m.locationId,
                        m.qtyDelta,
                        grn.id,
                        m.idempotencyKey,
                        user.id,
                    ],
                );

                await manager.query(
                    `
                    INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, qty)
                    VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (branch_id, inventory_item_id, location_id)
                    DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                    `,
                    [
                        tenantId,
                        grn.branchId,
                        m.inventoryItemId,
                        m.locationId,
                        m.qtyDelta,
                    ],
                );
                await manager.query(
                    `
                    INSERT INTO inventory_batch_on_hand (tenant_id, branch_id, inventory_batch_id, location_id, qty)
                    VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (branch_id, inventory_batch_id, location_id)
                    DO UPDATE SET qty = inventory_batch_on_hand.qty + EXCLUDED.qty, updated_at = now()
                    `,
                    [
                        tenantId,
                        grn.branchId,
                        m.inventoryBatchId,
                        m.locationId,
                        m.qtyDelta,
                    ],
                );
            }

            // Update PO status based on received vs ordered (base-unit compare)
            const orderedByItem = new Map<number, number>();
            for (const l of po.lines ?? []) {
                const qtyBase = await this.inventoryService.convertToItemBaseQty(
                    tenantId,
                    l.inventoryItemId,
                    Number(l.orderedQty),
                    l.orderedUomId,
                );
                orderedByItem.set(
                    l.inventoryItemId,
                    (orderedByItem.get(l.inventoryItemId) ?? 0) + qtyBase,
                );
            }

            // Compare total received across all posted GRNs for this PO
            const totals = (await manager.query(
                `
                SELECT inventory_item_id, SUM(qty_delta) AS received_qty
                FROM inventory_ledger_entries
                WHERE tenant_id = $1 AND branch_id = $2
                  AND event_type = 'receive'
                  AND event_ref_type = 'grn'
                  AND event_ref_id IN (
                    SELECT id FROM goods_receipt_notes
                    WHERE purchase_order_id = $3 AND status = 'posted'
                  )
                GROUP BY inventory_item_id
                `,
                [tenantId, grn.branchId, po.id],
            )) as Array<{ inventory_item_id: number; received_qty: string }>;
            const receivedTotals = new Map<number, number>(
                totals.map((r) => [r.inventory_item_id, Number(r.received_qty)]),
            );

            let allReceived = true;
            let anyReceived = false;
            for (const [itemId, orderedQtyBase] of orderedByItem.entries()) {
                const receivedQtyBase = receivedTotals.get(itemId) ?? 0;
                if (receivedQtyBase > 0) anyReceived = true;
                if (receivedQtyBase + 1e-9 < orderedQtyBase) allReceived = false;
            }

            po.status = allReceived
                ? 'closed'
                : anyReceived
                  ? 'partially_received'
                  : po.status;
            await manager.getRepository(PurchaseOrder).save(po);

            return this.getGRN(tenantId, grn.id);
        });
    }

    async reverseGRN(user: TenantContextUser, grnId: number) {
        const grn = await this.grnRepo.findOne({
            where: { id: grnId },
            relations: { lines: true },
        });
        if (!grn) throw new NotFoundException('GRN not found');
        const tenantId = await this.resolveTenantId(user, grn.branchId);
        if (grn.tenantId !== tenantId) throw new ForbiddenException();
        if (grn.status !== 'posted') {
            throw new BadRequestException('Only posted GRN can be reversed');
        }

        // Find all batches created by this GRN
        const batches = await this.batchesRepo.find({
            where: { tenantId, branchId: grn.branchId, goodsReceiptNoteId: grn.id },
        });
        if (batches.length === 0) {
            throw new BadRequestException('No batches found for this GRN');
        }

        return this.dataSource.transaction(async (manager) => {
            // Ensure none of the batches were consumed/adjusted after receiving:
            for (const b of batches) {
                const rows = (await manager.query(
                    `
                    SELECT SUM(qty) AS on_hand_qty
                    FROM inventory_batch_on_hand
                    WHERE tenant_id = $1 AND branch_id = $2 AND inventory_batch_id = $3
                    `,
                    [tenantId, grn.branchId, b.id],
                )) as Array<{ on_hand_qty: string | null }>;
                const onHandQty = Number(rows?.[0]?.on_hand_qty ?? 0);
                if (onHandQty <= 0) continue;

                const movementRows = (await manager.query(
                    `
                    SELECT COUNT(*)::int AS cnt
                    FROM inventory_ledger_entries
                    WHERE tenant_id = $1 AND branch_id = $2 AND inventory_batch_id = $3
                      AND NOT (event_type = 'receive' AND event_ref_type = 'grn' AND event_ref_id = $4)
                    `,
                    [tenantId, grn.branchId, b.id, grn.id],
                )) as Array<{ cnt: number }>;
                if ((movementRows?.[0]?.cnt ?? 0) > 0) {
                    throw new BadRequestException(
                        'Cannot reverse GRN: some received batches were moved/consumed',
                    );
                }
            }

            // Reverse the receive movements (negate ledger and read models)
            const receiveRows = (await manager.query(
                `
                SELECT id, inventory_item_id, inventory_batch_id, location_id, qty_delta
                FROM inventory_ledger_entries
                WHERE tenant_id = $1 AND branch_id = $2
                  AND event_type = 'receive' AND event_ref_type = 'grn' AND event_ref_id = $3
                `,
                [tenantId, grn.branchId, grn.id],
            )) as Array<{
                id: number;
                inventory_item_id: number;
                inventory_batch_id: number | null;
                location_id: number | null;
                qty_delta: string;
            }>;

            for (const r of receiveRows) {
                const qty = Number(r.qty_delta);
                const reverseKey = `grn:${grn.id}:reverse:ledger:${r.id}`;

                await manager.query(
                    `
                    INSERT INTO inventory_ledger_entries
                        (tenant_id, branch_id, inventory_item_id, inventory_batch_id, location_id, qty_delta,
                         event_type, event_ref_type, event_ref_id, idempotency_key, created_by, created_at)
                    VALUES ($1,$2,$3,$4,$5,$6,'receive_reversal','grn',$7,$8,$9,now())
                    ON CONFLICT (idempotency_key) DO NOTHING
                    `,
                    [
                        tenantId,
                        grn.branchId,
                        r.inventory_item_id,
                        r.inventory_batch_id,
                        r.location_id,
                        -qty,
                        grn.id,
                        reverseKey,
                        user.id,
                    ],
                );

                await manager.query(
                    `
                    UPDATE inventory_on_hand
                    SET qty = qty - $1, updated_at = now()
                    WHERE branch_id = $2 AND inventory_item_id = $3
                      AND ((location_id IS NULL AND $4 IS NULL) OR location_id = $4)
                    `,
                    [
                        qty,
                        grn.branchId,
                        r.inventory_item_id,
                        r.location_id,
                    ],
                );

                if (r.inventory_batch_id != null) {
                    await manager.query(
                        `
                        UPDATE inventory_batch_on_hand
                        SET qty = qty - $1, updated_at = now()
                        WHERE branch_id = $2 AND inventory_batch_id = $3
                          AND ((location_id IS NULL AND $4 IS NULL) OR location_id = $4)
                        `,
                        [qty, grn.branchId, r.inventory_batch_id, r.location_id],
                    );
                }
            }

            // Mark GRN reversed and batches blocked (so FEFO won't pick them)
            grn.status = 'reversed';
            await manager.getRepository(GoodsReceiptNote).save(grn);

            await manager.query(
                `
                UPDATE inventory_batches
                SET status = 'blocked', updated_at = now()
                WHERE tenant_id = $1 AND branch_id = $2 AND goods_receipt_note_id = $3
                `,
                [tenantId, grn.branchId, grn.id],
            );

            return this.getGRN(tenantId, grn.id);
        });
    }
}

