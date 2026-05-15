import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InventoryService } from './inventory.service';
import { InventoryTransferRequest } from '../entities/inventory-transfer-request.entity';
import { InventoryTransferRequestLine } from '../entities/inventory-transfer-request-line.entity';
import { InventoryTransferOrder } from '../entities/inventory-transfer-order.entity';
import { InventoryTransferReceipt } from '../entities/inventory-transfer-receipt.entity';
import { InventoryTransferReceiptLine } from '../entities/inventory-transfer-receipt-line.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';

type TenantContextUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
};

@Injectable()
export class InventoryTransferService {
    constructor(
        private dataSource: DataSource,
        private inventoryService: InventoryService,
        @InjectRepository(InventoryTransferRequest)
        private requestRepo: Repository<InventoryTransferRequest>,
        @InjectRepository(InventoryTransferRequestLine)
        private requestLineRepo: Repository<InventoryTransferRequestLine>,
        @InjectRepository(InventoryTransferOrder)
        private orderRepo: Repository<InventoryTransferOrder>,
        @InjectRepository(InventoryTransferReceipt)
        private receiptRepo: Repository<InventoryTransferReceipt>,
        @InjectRepository(InventoryTransferReceiptLine)
        private receiptLineRepo: Repository<InventoryTransferReceiptLine>,
    ) {}

    async listRequests(tenantId: number) {
        return this.requestRepo.find({
            where: { tenantId },
            relations: { lines: true },
            order: { id: 'DESC' },
        });
    }

    async listOrders(tenantId: number) {
        return this.orderRepo.find({
            where: { tenantId },
            order: { id: 'DESC' },
        });
    }

    async createRequest(
        user: TenantContextUser,
        dto: {
            source_branch_id: number;
            destination_branch_id: number;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string;
            }>;
        },
    ) {
        if (dto.source_branch_id === dto.destination_branch_id) {
            throw new BadRequestException(
                'Source and destination branches must be different',
            );
        }
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            dto.source_branch_id,
        );
        return this.dataSource.transaction(async (manager) => {
            const request = await manager
                .getRepository(InventoryTransferRequest)
                .save(
                    manager.getRepository(InventoryTransferRequest).create({
                        tenantId,
                        sourceBranchId: dto.source_branch_id,
                        destinationBranchId: dto.destination_branch_id,
                        status: 'submitted',
                        notes: dto.notes ?? null,
                        createdBy: user.id,
                    }),
                );

            for (const l of dto.lines ?? []) {
                await manager.getRepository(InventoryTransferRequestLine).save(
                    manager.getRepository(InventoryTransferRequestLine).create({
                        transferRequestId: request.id,
                        inventoryItemId: l.inventory_item_id,
                        requestedQty: l.requested_qty,
                        requestedUomId: l.requested_uom_id,
                        notes: l.notes ?? null,
                    }),
                );
            }
            return this.requestRepo.findOne({
                where: { id: request.id, tenantId },
                relations: { lines: true },
            });
        });
    }

    async approveRequest(
        user: TenantContextUser,
        requestId: number,
        notes?: string,
    ) {
        const request = await this.requestRepo.findOne({
            where: { id: requestId },
            relations: { lines: true },
        });
        if (!request) throw new NotFoundException('Transfer request not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            request.sourceBranchId,
        );
        if (request.tenantId !== tenantId) throw new ForbiddenException();
        if (request.status !== 'submitted') {
            throw new BadRequestException(
                'Only submitted requests can be approved',
            );
        }

        return this.dataSource.transaction(async (manager) => {
            request.status = 'approved';
            request.approvedBy = user.id;
            request.approvedAt = new Date();
            if (notes)
                request.notes = `${request.notes ?? ''}\n${notes}`.trim();
            await manager.getRepository(InventoryTransferRequest).save(request);

            const order = await manager
                .getRepository(InventoryTransferOrder)
                .save(
                    manager.getRepository(InventoryTransferOrder).create({
                        tenantId,
                        transferRequestId: request.id,
                        sourceBranchId: request.sourceBranchId,
                        destinationBranchId: request.destinationBranchId,
                        status: 'approved',
                        notes: notes ?? null,
                    }),
                );
            return order;
        });
    }

    async rejectRequest(
        user: TenantContextUser,
        requestId: number,
        reason?: string,
    ) {
        const request = await this.requestRepo.findOne({
            where: { id: requestId },
        });
        if (!request) throw new NotFoundException('Transfer request not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            request.sourceBranchId,
        );
        if (request.tenantId !== tenantId) throw new ForbiddenException();
        if (request.status !== 'submitted') {
            throw new BadRequestException(
                'Only submitted requests can be rejected',
            );
        }
        request.status = 'rejected';
        if (reason)
            request.notes =
                `${request.notes ?? ''}\nREJECTED: ${reason}`.trim();
        return this.requestRepo.save(request);
    }

    async dispatchOrder(
        user: TenantContextUser,
        orderId: number,
        dto: {
            lines: Array<{
                inventory_item_id: number;
                qty: number;
                qty_uom_id: number;
                location_id?: number | null;
                inventory_batch_id?: number | null;
                notes?: string | null;
            }>;
        },
    ) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Transfer order not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            order.sourceBranchId,
        );
        if (order.tenantId !== tenantId) throw new ForbiddenException();
        if (
            !['approved', 'dispatched_partial', 'received_partial'].includes(
                order.status,
            )
        ) {
            throw new BadRequestException('Order is not dispatchable');
        }
        if (!dto.lines?.length)
            throw new BadRequestException('Dispatch lines are required');

        const movements = await Promise.all(
            dto.lines.map(async (l) => {
                const qtyBase =
                    await this.inventoryService.convertToItemBaseQty(
                        tenantId,
                        l.inventory_item_id,
                        Number(l.qty),
                        l.qty_uom_id,
                    );
                return {
                    inventoryItemId: l.inventory_item_id,
                    inventoryBatchId: l.inventory_batch_id ?? null,
                    locationId: l.location_id ?? null,
                    qtyDelta: -Math.abs(qtyBase),
                    eventType: 'transfer_order',
                    eventRefType: 'transfer_order',
                    eventRefId: order.id,
                    idempotencyKey: `transfer:${order.id}:dispatch:${l.inventory_item_id}:${l.location_id ?? 0}:${l.inventory_batch_id ?? 0}:${qtyBase}`,
                    notes: l.notes ?? null,
                    createdBy: user.id,
                };
            }),
        );

        await this.inventoryService.postLedgerMovements({
            tenantId,
            branchId: order.sourceBranchId,
            movements,
        });
        order.status = 'dispatched_partial';
        order.dispatchedBy = user.id;
        order.dispatchedAt = new Date();
        return this.orderRepo.save(order);
    }

    async receiveOrder(
        user: TenantContextUser,
        orderId: number,
        dto: {
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                received_qty: number;
                received_uom_id: number;
                location_id?: number | null;
                lot_code?: string | null;
                expiry_date?: string | null;
                notes?: string | null;
            }>;
        },
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: { transferRequest: { lines: true } },
        });
        if (!order) throw new NotFoundException('Transfer order not found');
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            order.destinationBranchId,
        );
        if (tenantId !== order.tenantId) throw new ForbiddenException();
        if (
            ![
                'dispatched_partial',
                'dispatched_full',
                'received_partial',
            ].includes(order.status)
        ) {
            throw new BadRequestException('Order is not receivable');
        }
        if (!dto.lines?.length)
            throw new BadRequestException('Receipt lines are required');

        return this.dataSource.transaction(async (manager) => {
            const receipt = await manager
                .getRepository(InventoryTransferReceipt)
                .save(
                    manager.getRepository(InventoryTransferReceipt).create({
                        tenantId,
                        transferOrderId: order.id,
                        status: 'posted',
                        notes: dto.notes ?? null,
                        postedBy: user.id,
                        postedAt: new Date(),
                    }),
                );

            const requestLinesByItem = new Map(
                (order.transferRequest?.lines ?? []).map((l) => [
                    l.inventoryItemId,
                    l,
                ]),
            );

            const movements = [];
            for (const l of dto.lines) {
                const reqLine = requestLinesByItem.get(l.inventory_item_id);
                if (!reqLine) {
                    throw new BadRequestException(
                        `Item ${l.inventory_item_id} is not part of transfer request`,
                    );
                }
                const item = await manager
                    .getRepository(InventoryItem)
                    .findOne({
                        where: { id: l.inventory_item_id, tenantId },
                    });
                if (!item)
                    throw new NotFoundException('Inventory item not found');
                if (item.trackExpiry && !l.expiry_date) {
                    throw new BadRequestException(
                        `Missing expiry_date for item ${item.code}`,
                    );
                }
                const qtyBase =
                    await this.inventoryService.convertToItemBaseQty(
                        tenantId,
                        l.inventory_item_id,
                        Number(l.received_qty),
                        l.received_uom_id,
                    );
                const batch = await manager.getRepository(InventoryBatch).save(
                    manager.getRepository(InventoryBatch).create({
                        tenantId,
                        branchId: order.destinationBranchId,
                        inventoryItemId: item.id,
                        vendorId: null,
                        purchaseOrderId: null,
                        goodsReceiptNoteId: null,
                        lotCode: l.lot_code ?? null,
                        batchVersion: 'v1',
                        expiryDate: l.expiry_date ?? null,
                        receivedAt: new Date(),
                        status: 'available',
                    }),
                );
                await manager.getRepository(InventoryTransferReceiptLine).save(
                    manager.getRepository(InventoryTransferReceiptLine).create({
                        transferReceiptId: receipt.id,
                        inventoryItemId: l.inventory_item_id,
                        receivedQty: l.received_qty,
                        receivedUomId: l.received_uom_id,
                        locationId: l.location_id ?? null,
                        lotCode: l.lot_code ?? null,
                        expiryDate: l.expiry_date ?? null,
                        notes: l.notes ?? null,
                    }),
                );
                movements.push({
                    inventoryItemId: l.inventory_item_id,
                    inventoryBatchId: batch.id,
                    locationId: l.location_id ?? null,
                    qtyDelta: Math.abs(qtyBase),
                    eventType: 'transfer_receipt',
                    eventRefType: 'transfer_receipt',
                    eventRefId: receipt.id,
                    idempotencyKey: `transfer:${order.id}:receipt:${receipt.id}:${l.inventory_item_id}:${l.location_id ?? 0}:${qtyBase}`,
                    notes: l.notes ?? null,
                    createdBy: user.id,
                });
            }

            await this.inventoryService.postLedgerMovements({
                tenantId,
                branchId: order.destinationBranchId,
                movements,
                manager,
            });

            const receivedTotals: Array<{
                inventory_item_id: number | string;
                qty: number | string;
            }> = await manager.query(
                `
                    SELECT l.inventory_item_id, SUM(l.qty_delta)::numeric AS qty
                    FROM inventory_ledger_entries l
                    INNER JOIN inventory_transfer_receipts tr ON tr.id = l.event_ref_id
                    WHERE l.tenant_id = $1
                      AND l.branch_id = $2
                      AND l.event_type IN ('transfer_receipt', 'transfer_in')
                      AND l.event_ref_type = 'transfer_receipt'
                      AND tr.transfer_order_id = $3
                    GROUP BY l.inventory_item_id
                `,
                [tenantId, order.destinationBranchId, order.id],
            );
            const receivedMap = new Map<number, number>(
                receivedTotals.map((r) => [
                    Number(r.inventory_item_id),
                    Number(r.qty),
                ]),
            );

            let allReceived = true;
            for (const req of order.transferRequest?.lines ?? []) {
                const requestedBase =
                    await this.inventoryService.convertToItemBaseQty(
                        tenantId,
                        req.inventoryItemId,
                        Number(req.requestedQty),
                        req.requestedUomId,
                    );
                if (
                    (receivedMap.get(req.inventoryItemId) ?? 0) + 1e-9 <
                    requestedBase
                ) {
                    allReceived = false;
                    break;
                }
            }
            order.status = allReceived ? 'closed' : 'received_partial';
            await manager.getRepository(InventoryTransferOrder).save(order);
            return this.receiptRepo.findOne({
                where: { id: receipt.id },
                relations: { lines: true },
            });
        });
    }
}
