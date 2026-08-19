import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InventoryAdjustment } from '../entities/inventory-adjustment.entity';
import { InventoryAdjustmentLine } from '../entities/inventory-adjustment-line.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryService } from './inventory.service';
import { transitionStatus } from '../common/db-concurrency';
import { ActivityContext } from '../activity-log/activity-context';

type TenantContextUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
};

@Injectable()
export class InventoryAdjustmentService {
    constructor(
        private dataSource: DataSource,
        private inventoryService: InventoryService,
        @InjectRepository(InventoryAdjustment)
        private adjustmentRepo: Repository<InventoryAdjustment>,
        @InjectRepository(InventoryAdjustmentLine)
        private adjustmentLineRepo: Repository<InventoryAdjustmentLine>,
    ) {}

    async listAdjustments(tenantId: number, branchId: number) {
        return this.adjustmentRepo.find({
            where: { tenantId, branchId },
            relations: { lines: true },
            order: { id: 'DESC' },
        });
    }

    async createAdjustment(
        user: TenantContextUser,
        dto: {
            branch_id: number;
            adjustment_type: 'in' | 'out';
            reason_code: string;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                qty: number;
                qty_uom_id: number;
                location_id?: number | null;
                inventory_batch_id?: number | null;
                lot_code?: string | null;
                expiry_date?: string | null;
                notes?: string | null;
            }>;
        },
    ) {
        if (!['in', 'out'].includes(dto.adjustment_type)) {
            throw new BadRequestException('adjustment_type must be in or out');
        }
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            dto.branch_id,
        );
        return this.dataSource.transaction(async (manager) => {
            const adjustment = await manager
                .getRepository(InventoryAdjustment)
                .save(
                    manager.getRepository(InventoryAdjustment).create({
                        tenantId,
                        branchId: dto.branch_id,
                        adjustmentType: dto.adjustment_type,
                        reasonCode: dto.reason_code,
                        status: 'draft',
                        notes: dto.notes ?? null,
                        createdBy: user.id,
                    }),
                );

            for (const line of dto.lines ?? []) {
                await manager.getRepository(InventoryAdjustmentLine).save(
                    manager.getRepository(InventoryAdjustmentLine).create({
                        inventoryAdjustmentId: adjustment.id,
                        inventoryItemId: line.inventory_item_id,
                        qty: line.qty,
                        qtyUomId: line.qty_uom_id,
                        locationId: line.location_id ?? null,
                        inventoryBatchId: line.inventory_batch_id ?? null,
                        lotCode: line.lot_code ?? null,
                        expiryDate: line.expiry_date ?? null,
                        notes: line.notes ?? null,
                    }),
                );
            }

            return manager.getRepository(InventoryAdjustment).findOne({
                where: { id: adjustment.id, tenantId },
                relations: { lines: true },
            });
        });
    }

    async postAdjustment(user: TenantContextUser, adjustmentId: number) {
        const adjustment = await this.adjustmentRepo.findOne({
            where: { id: adjustmentId },
            relations: { lines: true },
        });
        if (!adjustment) throw new NotFoundException('Adjustment not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            adjustment.branchId,
        );
        if (adjustment.tenantId !== tenantId) throw new ForbiddenException();
        if (adjustment.status !== 'draft') {
            throw new BadRequestException(
                'Only draft adjustment can be posted',
            );
        }
        if (!adjustment.lines?.length) {
            throw new BadRequestException('Adjustment must include lines');
        }

        return this.dataSource.transaction(async (manager) => {
            const postedAt = new Date();
            // Atomic draft -> posted FIRST: only one concurrent poster proceeds to
            // create batches/movements. Without it a double-post of an 'in' adjustment
            // mints a duplicate orphan batch and mis-points the line.
            const prevStatus = await transitionStatus(
                manager,
                'inventory_adjustments',
                adjustment.id,
                'posted',
                {
                    allowedFrom: ['draft'],
                    set: { posted_by: user.id, posted_at: postedAt },
                },
            );
            if (prevStatus === null) {
                throw new ConflictException(
                    'This adjustment has already been posted',
                );
            }
            const sign = adjustment.adjustmentType === 'in' ? 1 : -1;
            const movements = [];
            for (const line of adjustment.lines) {
                const item = await manager
                    .getRepository(InventoryItem)
                    .findOne({
                        where: { id: line.inventoryItemId, tenantId },
                    });
                if (!item)
                    throw new NotFoundException('Inventory item not found');
                const qtyBase =
                    await this.inventoryService.convertToItemBaseQty(
                        tenantId,
                        line.inventoryItemId,
                        Number(line.qty),
                        line.qtyUomId,
                    );
                if (Math.abs(qtyBase) < 1e-9) continue;
                let inventoryBatchId: number | null =
                    line.inventoryBatchId ?? null;
                if (adjustment.adjustmentType === 'in') {
                    if (item.trackExpiry && !line.expiryDate) {
                        throw new BadRequestException(
                            `Missing expiry_date for item ${item.code}`,
                        );
                    }
                    const batch = await manager
                        .getRepository(InventoryBatch)
                        .save(
                            manager.getRepository(InventoryBatch).create({
                                tenantId,
                                branchId: adjustment.branchId,
                                inventoryItemId: item.id,
                                vendorId: null,
                                purchaseOrderId: null,
                                goodsReceiptNoteId: null,
                                lotCode: line.lotCode ?? null,
                                batchVersion: 'v1',
                                expiryDate: line.expiryDate ?? null,
                                receivedAt: postedAt,
                                status: 'available',
                            }),
                        );
                    inventoryBatchId = batch.id;
                    line.inventoryBatchId = batch.id;
                    await manager
                        .getRepository(InventoryAdjustmentLine)
                        .save(line);
                }
                movements.push({
                    inventoryItemId: line.inventoryItemId,
                    inventoryBatchId,
                    locationId: line.locationId ?? null,
                    qtyDelta: sign * Math.abs(qtyBase),
                    eventType:
                        adjustment.adjustmentType === 'in'
                            ? 'adjustment_in'
                            : 'adjustment_out',
                    eventRefType: 'inventory_adjustment',
                    eventRefId: adjustment.id,
                    idempotencyKey: `adjustment:${adjustment.id}:line:${line.id}`,
                    notes: line.notes ?? null,
                    createdBy: user.id,
                });
            }

            await this.inventoryService.postLedgerMovements({
                tenantId,
                branchId: adjustment.branchId,
                manager,
                movements,
            });

            adjustment.status = 'posted';
            adjustment.postedBy = user.id;
            adjustment.postedAt = postedAt;
            const saved = await manager
                .getRepository(InventoryAdjustment)
                .save(adjustment);
            // A posted adjustment moves stock without a purchase or a sale
            // behind it, which is exactly the shape shrinkage takes. Recorded
            // as an addition (no "before" — posting is not an edit).
            ActivityContext.setScope({ branchId: adjustment.branchId });
            ActivityContext.recordChange(
                'inventory_adjustment',
                saved.id,
                null,
                {
                    adjustment_type: adjustment.adjustmentType,
                    reason_code: adjustment.reasonCode,
                    line_count: movements.length,
                    status: 'posted',
                },
                `Adjustment #${saved.id}`,
            );
            return saved;
        });
    }

    async updateDraftAdjustment(
        user: TenantContextUser,
        adjustmentId: number,
        dto: {
            reason_code?: string;
            notes?: string | null;
            lines: Array<{
                inventory_item_id: number;
                qty: number;
                qty_uom_id: number;
                location_id?: number | null;
                inventory_batch_id?: number | null;
                lot_code?: string | null;
                expiry_date?: string | null;
                notes?: string | null;
            }>;
        },
    ) {
        const adjustment = await this.adjustmentRepo.findOne({
            where: { id: adjustmentId },
            relations: { lines: true },
        });
        if (!adjustment) throw new NotFoundException('Adjustment not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            adjustment.branchId,
        );
        if (adjustment.tenantId !== tenantId) throw new ForbiddenException();
        if (adjustment.status !== 'draft') {
            throw new BadRequestException(
                'Only draft adjustment can be edited',
            );
        }
        const nextLines = Array.isArray(dto.lines) ? dto.lines : [];
        if (nextLines.length === 0) {
            throw new BadRequestException('Adjustment must include lines');
        }
        return this.dataSource.transaction(async (manager) => {
            if (dto.reason_code !== undefined) {
                const reason = String(dto.reason_code).trim();
                if (!reason)
                    throw new BadRequestException('reason_code is required');
                adjustment.reasonCode = reason;
            }
            if (dto.notes !== undefined) {
                adjustment.notes = dto.notes == null ? null : String(dto.notes);
            }
            await manager.getRepository(InventoryAdjustment).save(adjustment);
            await manager.getRepository(InventoryAdjustmentLine).delete({
                inventoryAdjustmentId: adjustment.id,
            });
            for (const line of nextLines) {
                await manager.getRepository(InventoryAdjustmentLine).save(
                    manager.getRepository(InventoryAdjustmentLine).create({
                        inventoryAdjustmentId: adjustment.id,
                        inventoryItemId: line.inventory_item_id,
                        qty: line.qty,
                        qtyUomId: line.qty_uom_id,
                        locationId: line.location_id ?? null,
                        inventoryBatchId: line.inventory_batch_id ?? null,
                        lotCode: line.lot_code ?? null,
                        expiryDate: line.expiry_date ?? null,
                        notes: line.notes ?? null,
                    }),
                );
            }
            return manager.getRepository(InventoryAdjustment).findOne({
                where: { id: adjustment.id, tenantId },
                relations: { lines: true },
            });
        });
    }

    async deleteDraftAdjustment(user: TenantContextUser, adjustmentId: number) {
        const adjustment = await this.adjustmentRepo.findOne({
            where: { id: adjustmentId },
        });
        if (!adjustment) throw new NotFoundException('Adjustment not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            adjustment.branchId,
        );
        if (adjustment.tenantId !== tenantId) throw new ForbiddenException();
        if (adjustment.status !== 'draft') {
            throw new BadRequestException(
                'Only draft adjustment can be deleted',
            );
        }
        await this.adjustmentRepo.delete({ id: adjustment.id });
        return { ok: true };
    }
}
