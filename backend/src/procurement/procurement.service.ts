import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
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
    allowedBranchIds?: number[] | null;
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

    private generatePRNumber(tenantId: number, id: number) {
        return `PR-${tenantId}-${String(id).padStart(6, '0')}`;
    }

    private generateGRNNumber(tenantId: number, id: number) {
        return `GRN-${tenantId}-${String(id).padStart(6, '0')}`;
    }

    private async ensureUniquePRNumber(
        tenantId: number,
        prNumber: string,
        excludeId?: number,
    ) {
        const where: any = { tenantId, prNumber };
        if (excludeId != null) where.id = Not(excludeId);
        const exists = await this.prRepo.findOne({ where });
        if (exists) {
            throw new BadRequestException(
                `PR reference "${prNumber}" already exists`,
            );
        }
    }

    private async ensureUniquePONumber(
        tenantId: number,
        poNumber: string,
        excludeId?: number,
    ) {
        const where: any = { tenantId, poNumber };
        if (excludeId != null) where.id = Not(excludeId);
        const exists = await this.poRepo.findOne({ where });
        if (exists) {
            throw new BadRequestException(
                `PO reference "${poNumber}" already exists`,
            );
        }
    }

    private async ensureUniqueGRNNumber(
        tenantId: number,
        grnNumber: string,
        excludeId?: number,
    ) {
        const where: any = { tenantId, grnNumber };
        if (excludeId != null) where.id = Not(excludeId);
        const exists = await this.grnRepo.findOne({ where });
        if (exists) {
            throw new BadRequestException(
                `GRN reference "${grnNumber}" already exists`,
            );
        }
    }

    private async validateLineQtyAndUom(args: {
        tenantId: number;
        itemId: number;
        qty: number;
        uomId: number;
        qtyFieldLabel: string;
    }) {
        if (!Number.isFinite(args.qty) || args.qty <= 0) {
            throw new BadRequestException(
                `${args.qtyFieldLabel} must be greater than 0`,
            );
        }
        await this.inventoryService.convertToItemBaseQty(
            args.tenantId,
            args.itemId,
            args.qty,
            args.uomId,
        );
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
            pr_number?: string;
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
        if (!dto.lines?.length) {
            throw new BadRequestException('PR must include at least one line');
        }
        for (const l of dto.lines ?? []) {
            await this.validateLineQtyAndUom({
                tenantId,
                itemId: Number(l.inventory_item_id),
                qty: Number(l.requested_qty),
                uomId: Number(l.requested_uom_id),
                qtyFieldLabel: 'requested_qty',
            });
        }

        const prId = await this.dataSource.transaction(async (manager) => {
            const pr = await manager.getRepository(PurchaseRequisition).save(
                manager.getRepository(PurchaseRequisition).create({
                    tenantId,
                    requestingBranchId: dto.requesting_branch_id,
                    requestedFromVendorId: dto.requested_from_vendor_id,
                    prNumber: null,
                    status: 'draft',
                    notes: dto.notes ?? null,
                    createdBy: user.id,
                }),
            );
            const nextPrNumber =
                dto.pr_number?.trim() || this.generatePRNumber(tenantId, pr.id);
            await this.ensureUniquePRNumber(tenantId, nextPrNumber);
            pr.prNumber = nextPrNumber;
            await manager.getRepository(PurchaseRequisition).save(pr);

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

            return pr.id;
        });
        return this.getPR(tenantId, prId);
    }

    async updatePR(
        user: TenantContextUser,
        prId: number,
        dto: {
            pr_number?: string;
            requesting_branch_id?: number;
            requested_from_vendor_id?: number;
            notes?: string | null;
            lines?: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string | null;
            }>;
        },
    ) {
        const pr = await this.prRepo.findOne({
            where: { id: prId },
            relations: { lines: true },
        });
        if (!pr) throw new NotFoundException('PR not found');
        const tenantId = await this.resolveTenantId(
            user,
            pr.requestingBranchId,
        );
        if (pr.tenantId !== tenantId) throw new ForbiddenException();

        const isAdminLike =
            user.isSuperAdmin === true || user.allowedBranchIds == null;
        const isBranchUserForPr =
            Array.isArray(user.allowedBranchIds) &&
            user.allowedBranchIds.includes(Number(pr.requestingBranchId));

        if (isAdminLike) {
            if (!['draft', 'submitted'].includes(pr.status)) {
                throw new BadRequestException(
                    'Admin can edit PR only in draft or submitted status',
                );
            }
        } else if (isBranchUserForPr) {
            if (pr.status !== 'draft') {
                throw new BadRequestException(
                    'Branch can edit PR only in draft status',
                );
            }
        } else {
            throw new ForbiddenException();
        }

        return this.dataSource.transaction(async (manager) => {
            if (dto.requesting_branch_id != null) {
                if (
                    !isAdminLike &&
                    dto.requesting_branch_id !== pr.requestingBranchId
                ) {
                    throw new BadRequestException(
                        'Branch cannot change requesting branch',
                    );
                }
                pr.requestingBranchId = dto.requesting_branch_id;
            }
            if (dto.pr_number != null) {
                const next = String(dto.pr_number).trim();
                if (!next) {
                    throw new BadRequestException('pr_number cannot be empty');
                }
                await this.ensureUniquePRNumber(tenantId, next, pr.id);
                pr.prNumber = next;
            }
            if (dto.requested_from_vendor_id != null) {
                pr.requestedFromVendorId = dto.requested_from_vendor_id;
            }
            if (dto.notes !== undefined) {
                pr.notes = dto.notes ?? null;
            }
            await manager.getRepository(PurchaseRequisition).save(pr);

            if (dto.lines) {
                if (!dto.lines.length) {
                    throw new BadRequestException(
                        'PR must include at least one line',
                    );
                }
                for (const l of dto.lines) {
                    await this.validateLineQtyAndUom({
                        tenantId,
                        itemId: Number(l.inventory_item_id),
                        qty: Number(l.requested_qty),
                        uomId: Number(l.requested_uom_id),
                        qtyFieldLabel: 'requested_qty',
                    });
                }
                await manager.getRepository(PurchaseRequisitionLine).delete({
                    purchaseRequisitionId: pr.id,
                });
                for (const l of dto.lines) {
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
        const tenantId = await this.resolveTenantId(
            user,
            pr.requestingBranchId,
        );
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
        await this.ensureUniquePONumber(tenantId, poNumber);

        const poId = await this.dataSource.transaction(async (manager) => {
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
                await this.validateLineQtyAndUom({
                    tenantId,
                    itemId: Number(l.inventoryItemId),
                    qty: Number(l.requestedQty),
                    uomId: Number(l.requestedUomId),
                    qtyFieldLabel: 'requested_qty',
                });
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

            return po.id;
        });
        return this.getPO(tenantId, poId);
    }

    async rejectPR(user: TenantContextUser, prId: number, reason?: string) {
        const pr = await this.prRepo.findOne({ where: { id: prId } });
        if (!pr) throw new NotFoundException('PR not found');
        const tenantId = await this.resolveTenantId(
            user,
            pr.requestingBranchId,
        );
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
    async listPOs(
        tenantId: number,
        filters?: { status?: string; from?: string; to?: string },
    ) {
        const qb = this.poRepo
            .createQueryBuilder('po')
            .leftJoinAndSelect('po.lines', 'lines')
            .leftJoinAndSelect('po.purchaseRequisition', 'pr')
            .where('po.tenant_id = :tenantId', { tenantId })
            .orderBy('po.id', 'DESC');
        if (filters?.status) {
            qb.andWhere('po.status = :status', { status: filters.status });
        }
        if (filters?.from) {
            qb.andWhere('po.created_at >= :fromDate', {
                fromDate: filters.from,
            });
        }
        if (filters?.to) {
            qb.andWhere(
                `po.created_at < (:toDate::timestamp + interval '1 day')`,
                {
                    toDate: filters.to,
                },
            );
        }
        return qb.getMany();
    }

    async getPO(tenantId: number, poId: number) {
        const po = await this.poRepo.findOne({
            where: { tenantId, id: poId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');
        return po;
    }

    async updatePO(
        user: TenantContextUser,
        poId: number,
        dto: {
            po_number?: string;
            vendor_id?: number;
            notes?: string | null;
            lines?: Array<{
                inventory_item_id: number;
                ordered_qty: number;
                ordered_uom_id: number;
                notes?: string | null;
            }>;
        },
    ) {
        const po = await this.poRepo.findOne({
            where: { id: poId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');
        const tenantId = await this.resolveTenantId(user, po.buyerBranchId);
        if (po.tenantId !== tenantId) throw new ForbiddenException();

        const isAdminLike =
            user.isSuperAdmin === true || user.allowedBranchIds == null;
        if (!isAdminLike) {
            throw new ForbiddenException('Only admin can edit purchase orders');
        }
        if (po.status !== 'created') {
            throw new BadRequestException(
                'PO can be edited only when status is created',
            );
        }
        const hasAnyGrn = await this.grnRepo.exist({
            where: { tenantId, purchaseOrderId: po.id },
        });
        if (hasAnyGrn) {
            throw new BadRequestException(
                'PO is no longer editable because a GRN already exists',
            );
        }

        return this.dataSource.transaction(async (manager) => {
            if (dto.po_number != null) {
                const next = String(dto.po_number).trim();
                if (!next)
                    throw new BadRequestException('po_number cannot be empty');
                await this.ensureUniquePONumber(tenantId, next, po.id);
                po.poNumber = next;
            }
            if (dto.vendor_id != null) po.vendorId = dto.vendor_id;
            if (dto.notes !== undefined) po.notes = dto.notes ?? null;
            po.expectedDeliveryDate = null;
            await manager.getRepository(PurchaseOrder).save(po);

            if (dto.lines) {
                if (!dto.lines.length) {
                    throw new BadRequestException(
                        'PO must include at least one line',
                    );
                }
                for (const l of dto.lines) {
                    await this.validateLineQtyAndUom({
                        tenantId,
                        itemId: Number(l.inventory_item_id),
                        qty: Number(l.ordered_qty),
                        uomId: Number(l.ordered_uom_id),
                        qtyFieldLabel: 'ordered_qty',
                    });
                }
                await manager.getRepository(PurchaseOrderLine).delete({
                    purchaseOrderId: po.id,
                });
                for (const l of dto.lines) {
                    await manager.getRepository(PurchaseOrderLine).save(
                        manager.getRepository(PurchaseOrderLine).create({
                            purchaseOrderId: po.id,
                            inventoryItemId: l.inventory_item_id,
                            orderedQty: l.ordered_qty,
                            orderedUomId: l.ordered_uom_id,
                            unitCost: null,
                            taxRate: null,
                            notes: l.notes ?? null,
                        }),
                    );
                }
            }
            return this.getPO(tenantId, po.id);
        });
    }

    private async isPOFullyReceived(
        tenantId: number,
        branchId: number,
        poId: number,
    ) {
        const rows = await this.dataSource.query(
            `
            SELECT COALESCE(SUM(qty_delta),0)::numeric AS qty
            FROM inventory_ledger_entries
            WHERE tenant_id = $1
              AND branch_id = $2
              AND event_type = 'receive'
              AND event_ref_type = 'grn'
              AND event_ref_id IN (
                SELECT id FROM goods_receipt_notes
                WHERE purchase_order_id = $3 AND status = 'posted'
              )
            `,
            [tenantId, branchId, poId],
        );
        const totalReceived = Number(rows?.[0]?.qty ?? 0);
        const orderedRows = await this.dataSource.query(
            `
            SELECT pol.inventory_item_id,
                   pol.ordered_qty,
                   pol.ordered_uom_id
            FROM purchase_order_lines pol
            WHERE pol.purchase_order_id = $1
            `,
            [poId],
        );
        let orderedTotal = 0;
        for (const row of orderedRows) {
            orderedTotal += await this.inventoryService.convertToItemBaseQty(
                tenantId,
                row.inventory_item_id,
                Number(row.ordered_qty),
                row.ordered_uom_id,
            );
        }
        return orderedTotal > 0 && totalReceived + 1e-9 >= orderedTotal;
    }

    // ---------------- GRN ----------------
    async createGRN(
        user: TenantContextUser,
        dto: {
            grn_number?: string;
            purchase_order_id: number;
            branch_id: number;
            notes?: string;
        },
    ) {
        const tenantId = await this.resolveTenantId(user, dto.branch_id);
        const po = await this.poRepo.findOne({
            where: { tenantId, id: dto.purchase_order_id },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');
        if (po.buyerBranchId !== dto.branch_id) {
            throw new BadRequestException(
                'GRN branch must match PO buyer branch',
            );
        }
        if (po.status === 'closed') {
            throw new BadRequestException('Cannot create GRN for closed PO');
        }
        const fullyReceived = await this.isPOFullyReceived(
            tenantId,
            dto.branch_id,
            po.id,
        );
        if (fullyReceived) {
            throw new BadRequestException(
                'PO is already fully received; duplicate GRN is blocked',
            );
        }
        const grnId = await this.dataSource.transaction(async (manager) => {
            const grn = await manager.getRepository(GoodsReceiptNote).save(
                manager.getRepository(GoodsReceiptNote).create({
                    tenantId,
                    branchId: dto.branch_id,
                    purchaseOrderId: dto.purchase_order_id,
                    grnNumber: null,
                    status: 'draft',
                    receivedBy: user.id,
                    receivedAt: new Date(),
                    notes: dto.notes ?? null,
                }),
            );
            const nextGrnNumber =
                dto.grn_number?.trim() ||
                this.generateGRNNumber(tenantId, grn.id);
            await this.ensureUniqueGRNNumber(tenantId, nextGrnNumber);
            grn.grnNumber = nextGrnNumber;
            await manager.getRepository(GoodsReceiptNote).save(grn);

            // Seed expected lines from PO so receiver can see expected vs received.
            for (const poLine of po.lines ?? []) {
                await manager.getRepository(GoodsReceiptNoteLine).save(
                    manager.getRepository(GoodsReceiptNoteLine).create({
                        goodsReceiptNoteId: grn.id,
                        purchaseOrderLineId: poLine.id,
                        inventoryItemId: poLine.inventoryItemId,
                        receivedQty: 0,
                        acceptedQty: 0,
                        rejectedQty: 0,
                        rejectionReason: null,
                        isOverReceived: false,
                        isMismatchedItem: false,
                        receivedUomId: poLine.orderedUomId,
                        lotCode: null,
                        expiryDate: null,
                        locationId: null,
                        notes: `Expected from PO: ${Number(poLine.orderedQty)}`,
                    }),
                );
            }
            return grn.id;
        });

        return this.getGRN(tenantId, grnId);
    }

    async updateGRN(
        user: TenantContextUser,
        grnId: number,
        dto: {
            grn_number?: string;
            notes?: string | null;
            lines?: Array<{
                line_id?: number;
                purchase_order_line_id?: number | null;
                inventory_item_id: number;
                received_qty: number;
                accepted_qty?: number | null;
                rejected_qty?: number | null;
                rejection_reason?: string | null;
                allow_mismatched_item?: boolean;
                received_uom_id: number;
                lot_code?: string | null;
                expiry_date?: string | null;
                location_id?: number | null;
                notes?: string | null;
            }>;
        },
    ) {
        const grn = await this.grnRepo.findOne({
            where: { id: grnId },
            relations: { lines: true },
        });
        if (!grn) throw new NotFoundException('GRN not found');
        const tenantId = await this.resolveTenantId(user, grn.branchId);
        if (grn.tenantId !== tenantId) throw new ForbiddenException();
        if (grn.status !== 'draft') {
            throw new BadRequestException('Only draft GRN can be edited');
        }
        const po = await this.poRepo.findOne({
            where: { id: grn.purchaseOrderId, tenantId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');

        await this.dataSource.transaction(async (manager) => {
            if (dto.grn_number != null) {
                const next = String(dto.grn_number).trim();
                if (!next)
                    throw new BadRequestException('grn_number cannot be empty');
                await this.ensureUniqueGRNNumber(tenantId, next, grn.id);
                grn.grnNumber = next;
            }
            if (dto.notes !== undefined) {
                grn.notes = dto.notes ?? null;
            }
            await manager.getRepository(GoodsReceiptNote).save(grn);

            if (dto.lines != null) {
                if (!dto.lines.length) {
                    throw new BadRequestException(
                        'GRN must include at least one line',
                    );
                }

                const existingById = new Map(
                    (grn.lines ?? []).map((line) => [line.id, line]),
                );
                const existingByPoLineId = new Map(
                    (grn.lines ?? [])
                        .filter((line) => line.purchaseOrderLineId != null)
                        .map((line) => [
                            line.purchaseOrderLineId as number,
                            line,
                        ]),
                );
                const poItems = new Set(
                    (po.lines ?? []).map((line) => line.inventoryItemId),
                );
                const linesToSave: GoodsReceiptNoteLine[] = [];

                for (const l of dto.lines) {
                    let targetLine: GoodsReceiptNoteLine | undefined;
                    if (l.line_id != null) {
                        targetLine = existingById.get(Number(l.line_id));
                    } else if (l.purchase_order_line_id != null) {
                        targetLine = existingByPoLineId.get(
                            Number(l.purchase_order_line_id),
                        );
                    }
                    if (!targetLine && l.line_id != null) {
                        throw new BadRequestException(
                            `GRN line ${l.line_id} not found`,
                        );
                    }

                    const receivedQty = Number(l.received_qty ?? 0);
                    if (receivedQty < 0) {
                        throw new BadRequestException(
                            'received_qty cannot be negative',
                        );
                    }
                    const rejectedQty = Math.max(
                        0,
                        Number(l.rejected_qty ?? 0),
                    );
                    const acceptedQty =
                        l.accepted_qty == null
                            ? Math.max(receivedQty - rejectedQty, 0)
                            : Number(l.accepted_qty);
                    if (acceptedQty < 0 || rejectedQty < 0) {
                        throw new BadRequestException(
                            'accepted/rejected quantities cannot be negative',
                        );
                    }
                    if (acceptedQty + rejectedQty - receivedQty > 1e-9) {
                        throw new BadRequestException(
                            'accepted_qty + rejected_qty cannot exceed received_qty',
                        );
                    }

                    const itemId = Number(l.inventory_item_id);
                    const item = await this.itemsRepo.findOne({
                        where: { id: itemId, tenantId },
                    });
                    if (!item) {
                        throw new NotFoundException('Inventory item not found');
                    }
                    if (item.trackExpiry && receivedQty > 0 && !l.expiry_date) {
                        throw new BadRequestException(
                            'Expiry date is required for this item',
                        );
                    }

                    const poLine = l.purchase_order_line_id
                        ? (po.lines?.find(
                              (line) => line.id === l.purchase_order_line_id,
                          ) ?? null)
                        : null;
                    const mismatch = !poItems.has(itemId);
                    if (mismatch && !l.allow_mismatched_item) {
                        throw new BadRequestException(
                            'Item does not match PO line items',
                        );
                    }
                    if (poLine && poLine.inventoryItemId !== itemId) {
                        throw new BadRequestException(
                            'purchase_order_line_id does not match inventory_item_id',
                        );
                    }

                    const acceptedQtyBase =
                        await this.inventoryService.convertToItemBaseQty(
                            tenantId,
                            itemId,
                            acceptedQty,
                            Number(l.received_uom_id),
                        );
                    const orderedQtyBase = poLine
                        ? await this.inventoryService.convertToItemBaseQty(
                              tenantId,
                              poLine.inventoryItemId,
                              Number(poLine.orderedQty),
                              poLine.orderedUomId,
                          )
                        : null;
                    const isOverReceived =
                        orderedQtyBase != null &&
                        acceptedQtyBase > orderedQtyBase + 1e-9;

                    const line =
                        targetLine ??
                        manager.getRepository(GoodsReceiptNoteLine).create({
                            goodsReceiptNoteId: grn.id,
                        });
                    line.purchaseOrderLineId = l.purchase_order_line_id ?? null;
                    line.inventoryItemId = itemId;
                    line.receivedQty = receivedQty;
                    line.acceptedQty = acceptedQty;
                    line.rejectedQty = rejectedQty;
                    line.rejectionReason = l.rejection_reason ?? null;
                    line.isOverReceived = isOverReceived;
                    line.isMismatchedItem = mismatch;
                    line.receivedUomId = Number(l.received_uom_id);
                    line.lotCode = l.lot_code ?? null;
                    line.expiryDate = l.expiry_date ?? null;
                    line.locationId = l.location_id ?? null;
                    line.notes = l.notes ?? null;
                    linesToSave.push(line);
                }

                await manager
                    .getRepository(GoodsReceiptNoteLine)
                    .save(linesToSave);
            }
        });

        return this.getGRN(tenantId, grn.id);
    }

    async addGRNLine(
        user: TenantContextUser,
        grnId: number,
        dto: {
            purchase_order_line_id?: number | null;
            inventory_item_id: number;
            received_qty: number;
            accepted_qty?: number | null;
            rejected_qty?: number | null;
            rejection_reason?: string | null;
            allow_mismatched_item?: boolean;
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
        const po = await this.poRepo.findOne({
            where: { id: grn.purchaseOrderId, tenantId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');
        if (po.status === 'closed') {
            throw new BadRequestException('Cannot edit GRN for closed PO');
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
        const poLine = dto.purchase_order_line_id
            ? (po.lines?.find((l) => l.id === dto.purchase_order_line_id) ??
              null)
            : null;
        const poItems = new Set((po.lines ?? []).map((l) => l.inventoryItemId));
        const mismatch = !poItems.has(dto.inventory_item_id);
        if (mismatch && !dto.allow_mismatched_item) {
            throw new BadRequestException('Item does not match PO line items');
        }
        if (poLine && poLine.inventoryItemId !== dto.inventory_item_id) {
            throw new BadRequestException(
                'purchase_order_line_id does not match inventory_item_id',
            );
        }

        const receivedQty = Number(dto.received_qty);
        if (receivedQty <= 0) {
            throw new BadRequestException(
                'received_qty must be greater than 0',
            );
        }
        const rejectedQty = Math.max(0, Number(dto.rejected_qty ?? 0));
        const acceptedQty =
            dto.accepted_qty == null
                ? Math.max(receivedQty - rejectedQty, 0)
                : Number(dto.accepted_qty);
        if (acceptedQty < 0 || rejectedQty < 0) {
            throw new BadRequestException(
                'accepted/rejected quantities cannot be negative',
            );
        }
        if (acceptedQty + rejectedQty - receivedQty > 1e-9) {
            throw new BadRequestException(
                'accepted_qty + rejected_qty cannot exceed received_qty',
            );
        }
        const acceptedQtyBase =
            await this.inventoryService.convertToItemBaseQty(
                tenantId,
                dto.inventory_item_id,
                acceptedQty,
                dto.received_uom_id,
            );
        const orderedQtyBase = poLine
            ? await this.inventoryService.convertToItemBaseQty(
                  tenantId,
                  poLine.inventoryItemId,
                  Number(poLine.orderedQty),
                  poLine.orderedUomId,
              )
            : null;
        const isOverReceived =
            orderedQtyBase != null && acceptedQtyBase > orderedQtyBase + 1e-9;

        const existingSeededLine =
            dto.purchase_order_line_id != null
                ? await this.grnLinesRepo.findOne({
                      where: {
                          goodsReceiptNoteId: grn.id,
                          purchaseOrderLineId: dto.purchase_order_line_id,
                      },
                  })
                : null;

        const line = await this.grnLinesRepo.save(
            this.grnLinesRepo.create({
                ...(existingSeededLine ?? {}),
                goodsReceiptNoteId: grn.id,
                purchaseOrderLineId: dto.purchase_order_line_id ?? null,
                inventoryItemId: dto.inventory_item_id,
                receivedQty,
                acceptedQty,
                rejectedQty,
                rejectionReason: dto.rejection_reason ?? null,
                isOverReceived,
                isMismatchedItem: mismatch,
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
            relations: {
                lines: true,
                purchaseOrder: { purchaseRequisition: true },
            },
        });
        if (!grn) throw new NotFoundException('GRN not found');
        return grn;
    }

    async listGRNs(
        tenantId: number,
        filters?: { status?: string; from?: string; to?: string },
    ) {
        const qb = this.grnRepo
            .createQueryBuilder('grn')
            .leftJoinAndSelect('grn.lines', 'lines')
            .leftJoinAndSelect('grn.purchaseOrder', 'po')
            .leftJoinAndSelect('po.purchaseRequisition', 'pr')
            .where('grn.tenant_id = :tenantId', { tenantId })
            .orderBy('grn.id', 'DESC');
        if (filters?.status) {
            qb.andWhere('grn.status = :status', { status: filters.status });
        }
        if (filters?.from) {
            qb.andWhere('grn.created_at >= :fromDate', {
                fromDate: filters.from,
            });
        }
        if (filters?.to) {
            qb.andWhere(
                `grn.created_at < (:toDate::timestamp + interval '1 day')`,
                {
                    toDate: filters.to,
                },
            );
        }
        return qb.getMany();
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
        const hasAnyPositiveReceipt = (grn.lines ?? []).some(
            (l) => Number(l.acceptedQty ?? l.receivedQty ?? 0) > 0,
        );
        if (!hasAnyPositiveReceipt) {
            throw new BadRequestException(
                'No received quantity entered. Update at least one expected line before posting.',
            );
        }

        const po = await this.poRepo.findOne({
            where: { tenantId, id: grn.purchaseOrderId },
            relations: { lines: true },
        });
        if (!po) throw new NotFoundException('PO not found');
        if (po.status === 'closed') {
            throw new BadRequestException('Cannot post GRN for closed PO');
        }

        const vendor = await this.vendorsRepo.findOne({
            where: { id: po.vendorId, tenantId },
        });
        if (!vendor) throw new NotFoundException('Vendor not found');

        const postedAt = new Date();

        const postedGrnId = await this.dataSource.transaction(
            async (manager) => {
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
                    const item = await manager
                        .getRepository(InventoryItem)
                        .findOne({
                            where: { id: line.inventoryItemId, tenantId },
                        });
                    if (!item)
                        throw new NotFoundException('Inventory item not found');
                    const lineReceivedQty = Number(
                        line.acceptedQty ?? line.receivedQty ?? 0,
                    );
                    if (
                        lineReceivedQty > 0 &&
                        item.trackExpiry &&
                        !line.expiryDate
                    ) {
                        throw new BadRequestException(
                            `Missing expiry_date for item ${item.code}`,
                        );
                    }

                    const qtyBase =
                        await this.inventoryService.convertToItemBaseQty(
                            tenantId,
                            item.id,
                            lineReceivedQty,
                            line.receivedUomId,
                        );
                    if (qtyBase <= 0) {
                        continue;
                    }

                    const batch = await manager
                        .getRepository(InventoryBatch)
                        .save(
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
                        ? (po.lines?.find(
                              (l) => l.id === line.purchaseOrderLineId,
                          ) ?? null)
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
                            [
                                tenantId,
                                grn.branchId,
                                item.id,
                                unitCostPerBase,
                                grn.id,
                            ],
                        );
                    }
                }

                await this.inventoryService.postLedgerMovements({
                    tenantId,
                    branchId: grn.branchId,
                    manager,
                    movements: movements.map((m) => ({
                        inventoryItemId: m.inventoryItemId,
                        inventoryBatchId: m.inventoryBatchId,
                        locationId: m.locationId,
                        qtyDelta: m.qtyDelta,
                        eventType: 'receive',
                        eventRefType: 'grn',
                        eventRefId: grn.id,
                        idempotencyKey: m.idempotencyKey,
                        createdBy: user.id,
                    })),
                });

                // Update PO status based on received vs ordered (base-unit compare)
                const orderedByItem = new Map<number, number>();
                for (const l of po.lines ?? []) {
                    const qtyBase =
                        await this.inventoryService.convertToItemBaseQty(
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
                const totals: Array<{
                    inventory_item_id: number | string;
                    received_qty: number | string;
                }> = await manager.query(
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
                );
                const receivedTotals = new Map<number, number>(
                    totals.map((r) => [
                        Number(r.inventory_item_id),
                        Number(r.received_qty),
                    ]),
                );

                let allReceived = true;
                let anyReceived = false;
                for (const [
                    itemId,
                    orderedQtyBase,
                ] of orderedByItem.entries()) {
                    const receivedQtyBase = receivedTotals.get(itemId) ?? 0;
                    if (receivedQtyBase > 0) anyReceived = true;
                    if (receivedQtyBase + 1e-9 < orderedQtyBase)
                        allReceived = false;
                }

                po.status = allReceived
                    ? 'closed'
                    : anyReceived
                      ? 'partially_received'
                      : po.status;
                await manager.getRepository(PurchaseOrder).save(po);

                return grn.id;
            },
        );
        return this.getGRN(tenantId, postedGrnId);
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
            where: {
                tenantId,
                branchId: grn.branchId,
                goodsReceiptNoteId: grn.id,
            },
        });
        if (batches.length === 0) {
            throw new BadRequestException('No batches found for this GRN');
        }

        const reversedGrnId = await this.dataSource.transaction(
            async (manager) => {
                // Ensure none of the batches were consumed/adjusted after receiving:
                for (const b of batches) {
                    const rows = await manager.query(
                        `
                    SELECT SUM(qty) AS on_hand_qty
                    FROM inventory_batch_on_hand
                    WHERE tenant_id = $1 AND branch_id = $2 AND inventory_batch_id = $3
                    `,
                        [tenantId, grn.branchId, b.id],
                    );
                    const onHandQty = Number(rows?.[0]?.on_hand_qty ?? 0);
                    if (onHandQty <= 0) continue;

                    const movementRows = await manager.query(
                        `
                    SELECT COUNT(*)::int AS cnt
                    FROM inventory_ledger_entries
                    WHERE tenant_id = $1 AND branch_id = $2 AND inventory_batch_id = $3
                      AND NOT (event_type = 'receive' AND event_ref_type = 'grn' AND event_ref_id = $4)
                    `,
                        [tenantId, grn.branchId, b.id, grn.id],
                    );
                    if ((movementRows?.[0]?.cnt ?? 0) > 0) {
                        throw new BadRequestException(
                            'Cannot reverse GRN: some received batches were moved/consumed',
                        );
                    }
                }

                // Reverse the receive movements (negate ledger and read models)
                const receiveRows = await manager.query(
                    `
                SELECT id, inventory_item_id, inventory_batch_id, location_id, qty_delta
                FROM inventory_ledger_entries
                WHERE tenant_id = $1 AND branch_id = $2
                  AND event_type = 'receive' AND event_ref_type = 'grn' AND event_ref_id = $3
                `,
                    [tenantId, grn.branchId, grn.id],
                );

                for (const r of receiveRows) {
                    const qty = Number(r.qty_delta);
                    const reverseKey = `grn:${grn.id}:reverse:ledger:${r.id}`;
                    await this.inventoryService.postLedgerMovements({
                        tenantId,
                        branchId: grn.branchId,
                        manager,
                        movements: [
                            {
                                inventoryItemId: r.inventory_item_id,
                                inventoryBatchId: r.inventory_batch_id,
                                locationId: r.location_id,
                                qtyDelta: -qty,
                                eventType: 'receive_reversal',
                                eventRefType: 'grn',
                                eventRefId: grn.id,
                                idempotencyKey: reverseKey,
                                createdBy: user.id,
                            },
                        ],
                    });
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

                return grn.id;
            },
        );
        return this.getGRN(tenantId, reversedGrnId);
    }
}
