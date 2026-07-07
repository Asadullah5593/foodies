import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InventoryService } from './inventory.service';
import {
    transitionStatus,
    advisoryXactLock,
    AdvisoryLock,
    raw,
} from '../common/db-concurrency';
import { InventoryTransferRequest } from '../entities/inventory-transfer-request.entity';
import { InventoryTransferRequestLine } from '../entities/inventory-transfer-request-line.entity';
import { InventoryTransferOrder } from '../entities/inventory-transfer-order.entity';
import { InventoryTransferReceipt } from '../entities/inventory-transfer-receipt.entity';
import { InventoryTransferReceiptLine } from '../entities/inventory-transfer-receipt-line.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { Permissions } from '../roles/permissions.dto';

type TenantContextUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
    // null/undefined = unrestricted (all branches); an array means branch-scoped.
    allowedBranchIds?: number[] | null;
    // null/undefined = unrestricted; an array means the user is brand-locked.
    allowedBrandIds?: number[] | null;
    // Resolved permission names (set by RoleAccessGuard). Undefined for super admin.
    permissions?: string[];
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

    /** Super admin (no tenant) is unrestricted by branch/brand/permission scope. */
    private isUnrestricted(user: TenantContextUser): boolean {
        return user.tenantId == null || user.isSuperAdmin === true;
    }

    /** True if the user holds at least one of the given permissions (super admin: always). */
    private hasPermission(
        user: TenantContextUser,
        ...anyOf: string[]
    ): boolean {
        if (this.isUnrestricted(user)) return true;
        const perms = user.permissions ?? [];
        return anyOf.some((p) => perms.includes(p));
    }

    /**
     * Can this user act on the (branch, brand) bucket?
     *  - branch ok: unrestricted, or branch ∈ allowedBranchIds
     *  - brand ok: a brand bucket needs that brand ∈ allowedBrandIds (or unrestricted);
     *    the shared pool (brandId null) needs whole-branch authority (not brand-locked).
     */
    private canActOnBucket(
        user: TenantContextUser,
        branchId: number,
        brandId: number | null,
    ): boolean {
        const branchOk =
            user.allowedBranchIds == null ||
            user.allowedBranchIds.includes(branchId);
        const brandOk =
            brandId == null
                ? user.allowedBrandIds == null
                : user.allowedBrandIds == null ||
                  user.allowedBrandIds.includes(brandId);
        return branchOk && brandOk;
    }

    /** Source-side gate (approve/reject/dispatch): approve permission + source-bucket authority. */
    private assertSourceApprovalAuthority(
        user: TenantContextUser,
        move: { sourceBranchId: number; sourceBrandId: number | null },
    ): void {
        if (
            !this.hasPermission(
                user,
                Permissions.INVENTORY_TRANSFER_APPROVE,
                Permissions.INVENTORY_TRANSFER,
            )
        ) {
            throw new ForbiddenException(
                'You are not allowed to approve or dispatch transfers',
            );
        }
        if (
            !this.canActOnBucket(user, move.sourceBranchId, move.sourceBrandId)
        ) {
            throw new ForbiddenException(
                'Only the source branch/brand can approve or dispatch this transfer',
            );
        }
    }

    /** Destination-side gate (receive): request permission + destination-bucket authority. */
    private assertDestinationAuthority(
        user: TenantContextUser,
        move: {
            destinationBranchId: number;
            destinationBrandId: number | null;
        },
    ): void {
        if (
            !this.hasPermission(
                user,
                Permissions.INVENTORY_TRANSFER_REQUEST,
                Permissions.INVENTORY_TRANSFER,
            )
        ) {
            throw new ForbiddenException(
                'You are not allowed to receive transfers',
            );
        }
        if (
            !this.canActOnBucket(
                user,
                move.destinationBranchId,
                move.destinationBrandId,
            )
        ) {
            throw new ForbiddenException(
                'Only the destination branch/brand can receive this transfer',
            );
        }
    }

    /**
     * scope: 'mine' = requests INTO a bucket I control (destination side);
     * 'incoming' = requests OUT OF a bucket I control, awaiting my approval/dispatch
     * (source side); undefined = either. Unrestricted users always see everything.
     */
    async listRequests(
        user: TenantContextUser,
        tenantId: number,
        scope?: 'mine' | 'incoming',
    ) {
        const rows = await this.requestRepo.find({
            where: { tenantId },
            relations: { lines: true },
            order: { id: 'DESC' },
        });
        if (this.isUnrestricted(user)) return rows;
        return rows.filter((r) => {
            const mine = this.canActOnBucket(
                user,
                r.destinationBranchId,
                r.destinationBrandId,
            );
            const incoming = this.canActOnBucket(
                user,
                r.sourceBranchId,
                r.sourceBrandId,
            );
            if (scope === 'mine') return mine;
            if (scope === 'incoming') return incoming;
            return mine || incoming;
        });
    }

    async listOrders(
        user: TenantContextUser,
        tenantId: number,
        scope?: 'mine' | 'incoming',
    ) {
        const rows = await this.orderRepo.find({
            where: { tenantId },
            order: { id: 'DESC' },
        });
        if (this.isUnrestricted(user)) return rows;
        return rows.filter((r) => {
            const mine = this.canActOnBucket(
                user,
                r.destinationBranchId,
                r.destinationBrandId,
            );
            const incoming = this.canActOnBucket(
                user,
                r.sourceBranchId,
                r.sourceBrandId,
            );
            if (scope === 'mine') return mine;
            if (scope === 'incoming') return incoming;
            return mine || incoming;
        });
    }

    async createRequest(
        user: TenantContextUser,
        dto: {
            source_branch_id: number;
            destination_branch_id: number;
            source_brand_id?: number | null;
            destination_brand_id?: number | null;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string;
            }>;
        },
    ) {
        const sourceBrandId = dto.source_brand_id ?? null;
        const destinationBrandId = dto.destination_brand_id ?? null;
        // A move is valid as long as the (branch, brand) tuples differ. This covers
        // all 4 directions: branch→brand, brand→branch, brand→brand, branch→branch.
        if (
            dto.source_branch_id === dto.destination_branch_id &&
            sourceBrandId === destinationBrandId
        ) {
            throw new BadRequestException(
                'Source and destination (branch, brand) must be different',
            );
        }
        if (
            !this.hasPermission(
                user,
                Permissions.INVENTORY_TRANSFER_REQUEST,
                Permissions.INVENTORY_TRANSFER,
            )
        ) {
            throw new ForbiddenException(
                'You are not allowed to request transfers',
            );
        }
        // The requester must own the DESTINATION bucket (their brand, one of their
        // branches). The SOURCE may be any branch pool or brand — the source side
        // approves the pull, so it is not restricted at creation time.
        if (
            !this.canActOnBucket(
                user,
                dto.destination_branch_id,
                destinationBrandId,
            )
        ) {
            throw new ForbiddenException(
                'You can only request stock into your own brand and branch',
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
                        sourceBrandId,
                        destinationBranchId: dto.destination_branch_id,
                        destinationBrandId,
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
        // Two-party handshake: only someone with authority over the SOURCE bucket
        // may approve the pull. This structurally blocks a requester from approving
        // their own request (they have no authority over the source pool/brand).
        this.assertSourceApprovalAuthority(user, request);

        return this.dataSource.transaction(async (manager) => {
            // Atomic submitted -> approved under a row lock. Prevents two approvers
            // (or a double-click) from both creating a transfer order for one request,
            // and coordinates with a concurrent reject (whichever transitions first
            // wins; the loser gets a clean 409).
            const prev = await transitionStatus(
                manager,
                'inventory_transfer_requests',
                request.id,
                'approved',
                {
                    allowedFrom: ['submitted'],
                    set: {
                        approved_by: user.id,
                        approved_at: raw('now()'),
                        ...(notes
                            ? {
                                  notes: `${request.notes ?? ''}\n${notes}`.trim(),
                              }
                            : {}),
                    },
                },
            );
            if (prev === null) {
                throw new ConflictException(
                    'This transfer request is no longer awaiting approval',
                );
            }

            const order = await manager
                .getRepository(InventoryTransferOrder)
                .save(
                    manager.getRepository(InventoryTransferOrder).create({
                        tenantId,
                        transferRequestId: request.id,
                        sourceBranchId: request.sourceBranchId,
                        sourceBrandId: request.sourceBrandId,
                        destinationBranchId: request.destinationBranchId,
                        destinationBrandId: request.destinationBrandId,
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
        // Rejecting a pull is a source-side decision, same authority as approving.
        this.assertSourceApprovalAuthority(user, request);
        return this.dataSource.transaction(async (manager) => {
            // Atomic submitted -> rejected under a row lock; coordinates with a
            // concurrent approve so a request cannot end up 'rejected' while a live
            // dispatchable order exists.
            const prev = await transitionStatus(
                manager,
                'inventory_transfer_requests',
                request.id,
                'rejected',
                {
                    allowedFrom: ['submitted'],
                    set: reason
                        ? {
                              notes: `${request.notes ?? ''}\nREJECTED: ${reason}`.trim(),
                          }
                        : {},
                },
            );
            if (prev === null) {
                throw new ConflictException(
                    'This transfer request is no longer awaiting approval',
                );
            }
            return manager
                .getRepository(InventoryTransferRequest)
                .findOne({ where: { id: request.id } });
        });
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
        // Dispatching releases stock out of the source bucket — source authority.
        this.assertSourceApprovalAuthority(user, order);

        const sourceBrandId = order.sourceBrandId ?? null;

        return this.dataSource.transaction(async (manager) => {
            // Serialize every dispatch/receive for this order so two concurrent
            // dispatches cannot each FEFO-pick and double-deduct the source bucket.
            await advisoryXactLock(
                manager,
                AdvisoryLock.TRANSFER_ORDER,
                order.id,
            );
            // Re-validate status under the lock (a peer dispatch/receive may have
            // moved it since the pre-transaction read).
            const locked = await manager
                .getRepository(InventoryTransferOrder)
                .findOne({
                    where: { id: order.id },
                    select: { id: true, status: true },
                });
            if (
                !locked ||
                ![
                    'approved',
                    'dispatched_partial',
                    'received_partial',
                ].includes(locked.status)
            ) {
                throw new BadRequestException('Order is not dispatchable');
            }
            const movements = [];
            for (const l of dto.lines) {
                const qtyBase =
                    await this.inventoryService.convertToItemBaseQty(
                        tenantId,
                        l.inventory_item_id,
                        Number(l.qty),
                        l.qty_uom_id,
                    );
                if (qtyBase <= 0) continue;

                if (l.inventory_batch_id) {
                    // Explicit batch: guard that bucket, dispatch that batch only.
                    const available = await this.getBatchBucketQty(
                        manager,
                        tenantId,
                        order.sourceBranchId,
                        sourceBrandId,
                        l.inventory_batch_id,
                        l.location_id ?? null,
                    );
                    if (available + 1e-9 < qtyBase) {
                        throw new BadRequestException(
                            `Insufficient stock in source batch for item ${l.inventory_item_id} (have ${available}, need ${qtyBase})`,
                        );
                    }
                    movements.push({
                        inventoryItemId: l.inventory_item_id,
                        inventoryBatchId: l.inventory_batch_id,
                        locationId: l.location_id ?? null,
                        brandId: sourceBrandId,
                        qtyDelta: -Math.abs(qtyBase),
                        eventType: 'transfer_order',
                        eventRefType: 'transfer_order',
                        eventRefId: order.id,
                        idempotencyKey: `transfer:${order.id}:dispatch:${l.inventory_item_id}:${l.inventory_batch_id}:${sourceBrandId ?? 0}:${qtyBase}`,
                        notes: l.notes ?? null,
                        createdBy: user.id,
                    });
                    continue;
                }

                // No batch given: FEFO-pick batches from the source bucket so batch
                // lineage (lot/expiry) is preserved — required for same-branch brand
                // moves and more correct for cross-branch too. Transfers never go negative.
                const picks = await this.fefoPickForDispatch(
                    manager,
                    tenantId,
                    order.sourceBranchId,
                    sourceBrandId,
                    l.inventory_item_id,
                    qtyBase,
                );
                for (const p of picks) {
                    movements.push({
                        inventoryItemId: l.inventory_item_id,
                        inventoryBatchId: p.batchId,
                        locationId: null,
                        brandId: sourceBrandId,
                        qtyDelta: -p.qty,
                        eventType: 'transfer_order',
                        eventRefType: 'transfer_order',
                        eventRefId: order.id,
                        idempotencyKey: `transfer:${order.id}:dispatch:${l.inventory_item_id}:${p.batchId}:${sourceBrandId ?? 0}:${p.qty}`,
                        notes: l.notes ?? null,
                        createdBy: user.id,
                    });
                }
            }

            await this.inventoryService.postLedgerMovements({
                tenantId,
                branchId: order.sourceBranchId,
                movements,
                manager,
            });
            // Scoped update (not a full-entity save) so a concurrent receive that
            // moved status/audit columns is not clobbered by a stale snapshot.
            await manager.getRepository(InventoryTransferOrder).update(
                { id: order.id },
                {
                    status: 'dispatched_partial',
                    dispatchedBy: user.id,
                    dispatchedAt: new Date(),
                },
            );
            return manager
                .getRepository(InventoryTransferOrder)
                .findOne({ where: { id: order.id } });
        });
    }

    private async getBatchBucketQty(
        manager: any,
        tenantId: number,
        branchId: number,
        brandId: number | null,
        batchId: number,
        locationId: number | null,
    ): Promise<number> {
        const rows = (await manager.query(
            `
            SELECT qty::numeric AS qty FROM inventory_batch_on_hand
            WHERE tenant_id = $1 AND branch_id = $2
              AND inventory_batch_id = $3
              AND location_id IS NOT DISTINCT FROM $4
              AND brand_id IS NOT DISTINCT FROM $5
            FOR UPDATE
            `,
            [tenantId, branchId, batchId, locationId, brandId],
        )) as Array<{ qty: string }>;
        return rows.length ? Number(rows[0].qty) : 0;
    }

    /**
     * FEFO-pick batches from a source (branch, brand) bucket to cover qtyBase, so a
     * dispatch decrements specific batches (preserving lot/expiry lineage) rather than
     * an unattributed item-level amount. Throws if the bucket can't cover it (transfers
     * never go negative). Locks the rows FOR UPDATE within the dispatch transaction.
     */
    private async fefoPickForDispatch(
        manager: any,
        tenantId: number,
        branchId: number,
        brandId: number | null,
        itemId: number,
        qtyBase: number,
    ): Promise<Array<{ batchId: number; qty: number }>> {
        const rows = (await manager.query(
            `
            SELECT iboh.inventory_batch_id AS batch_id, iboh.qty::numeric AS qty
            FROM inventory_batch_on_hand iboh
            INNER JOIN inventory_batches b ON b.id = iboh.inventory_batch_id
            WHERE iboh.tenant_id = $1 AND iboh.branch_id = $2
              AND iboh.brand_id IS NOT DISTINCT FROM $3
              AND b.inventory_item_id = $4
              AND b.status = 'available'
              AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
              AND iboh.location_id IS NULL
              AND iboh.qty > 0
            ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC, iboh.inventory_batch_id ASC
            FOR UPDATE
            `,
            [tenantId, branchId, brandId, itemId],
        )) as Array<{ batch_id: number; qty: string }>;

        const picks: Array<{ batchId: number; qty: number }> = [];
        let remaining = qtyBase;
        for (const r of rows) {
            if (remaining <= 1e-9) break;
            const take = Math.min(Number(r.qty), remaining);
            if (take <= 0) continue;
            picks.push({ batchId: Number(r.batch_id), qty: take });
            remaining -= take;
        }
        if (remaining > 1e-9) {
            throw new BadRequestException(
                `Insufficient stock in source bucket for item ${itemId} (short by ${remaining})`,
            );
        }
        return picks;
    }

    /**
     * For a same-branch brand move, the qty still "in transit" for an item is what was
     * dispatched out of the source brand bucket minus what's already been received into
     * the destination brand bucket, per batch. Returned FEFO so lineage stays correct.
     */
    private async getInTransitBatches(
        manager: any,
        order: InventoryTransferOrder,
        itemId: number,
        sourceBrandId: number | null,
        destinationBrandId: number | null,
    ): Promise<Array<{ batchId: number; available: number }>> {
        const dispatched = (await manager.query(
            `
            SELECT le.inventory_batch_id AS batch_id,
                   SUM(-le.qty_delta)::numeric AS qty,
                   b.expiry_date AS expiry_date,
                   b.received_at AS received_at
            FROM inventory_ledger_entries le
            INNER JOIN inventory_batches b ON b.id = le.inventory_batch_id
            WHERE le.tenant_id = $1 AND le.branch_id = $2
              AND le.event_ref_type = 'transfer_order' AND le.event_ref_id = $3
              AND le.inventory_item_id = $4
              AND le.brand_id IS NOT DISTINCT FROM $5
              AND le.inventory_batch_id IS NOT NULL
            GROUP BY le.inventory_batch_id, b.expiry_date, b.received_at
            ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC, le.inventory_batch_id ASC
            `,
            [
                order.tenantId,
                order.sourceBranchId,
                order.id,
                itemId,
                sourceBrandId,
            ],
        )) as Array<{ batch_id: number; qty: string }>;

        const received = (await manager.query(
            `
            SELECT le.inventory_batch_id AS batch_id, SUM(le.qty_delta)::numeric AS qty
            FROM inventory_ledger_entries le
            INNER JOIN inventory_transfer_receipts tr ON tr.id = le.event_ref_id
            WHERE le.tenant_id = $1 AND le.branch_id = $2
              AND le.event_type = 'transfer_receipt'
              AND le.event_ref_type = 'transfer_receipt'
              AND tr.transfer_order_id = $3
              AND le.inventory_item_id = $4
              AND le.brand_id IS NOT DISTINCT FROM $5
              AND le.inventory_batch_id IS NOT NULL
            GROUP BY le.inventory_batch_id
            `,
            [
                order.tenantId,
                order.destinationBranchId,
                order.id,
                itemId,
                destinationBrandId,
            ],
        )) as Array<{ batch_id: number; qty: string }>;

        const receivedByBatch = new Map<number, number>(
            received.map((r) => [Number(r.batch_id), Number(r.qty)]),
        );
        return dispatched
            .map((d) => ({
                batchId: Number(d.batch_id),
                available:
                    Number(d.qty) -
                    (receivedByBatch.get(Number(d.batch_id)) ?? 0),
            }))
            .filter((b) => b.available > 1e-9);
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
        // Receiving credits the destination bucket — destination authority.
        this.assertDestinationAuthority(user, order);

        return this.dataSource.transaction(async (manager) => {
            // Serialize dispatch/receive for this order so two concurrent receives
            // cannot both read the same in-transit total and over-credit the
            // destination bucket.
            await advisoryXactLock(
                manager,
                AdvisoryLock.TRANSFER_ORDER,
                order.id,
            );
            const locked = await manager
                .getRepository(InventoryTransferOrder)
                .findOne({
                    where: { id: order.id },
                    select: { id: true, status: true },
                });
            if (
                !locked ||
                ![
                    'dispatched_partial',
                    'dispatched_full',
                    'received_partial',
                ].includes(locked.status)
            ) {
                throw new BadRequestException('Order is not receivable');
            }
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

            const sourceBrandId = order.sourceBrandId ?? null;
            const destinationBrandId = order.destinationBrandId ?? null;
            // Same-branch moves (e.g. branch pool → brand A) just shuffle qty between
            // brand buckets of the SAME batch — no new batch, lot/expiry lineage kept.
            const sameBranch =
                order.sourceBranchId === order.destinationBranchId;

            // Cross-branch moves mint a fresh destination batch, so there is no
            // batch-level in-transit cap like the same-branch path. Enforce an
            // item-level cap instead: total received across all receipts must never
            // exceed total dispatched. Computed under the advisory lock so it also
            // reflects any concurrent receipt that committed first.
            const crossBranchRemaining = new Map<number, number>();
            if (!sameBranch) {
                const rows: Array<{ item: number; remaining: string }> =
                    await manager.query(
                        `SELECT d.inventory_item_id AS item,
                                (d.dispatched - COALESCE(r.received, 0)) AS remaining
                         FROM (
                           SELECT inventory_item_id, SUM(-qty_delta) AS dispatched
                           FROM inventory_ledger_entries
                           WHERE tenant_id = $1 AND branch_id = $2
                             AND event_type = 'transfer_order'
                             AND event_ref_type = 'transfer_order'
                             AND event_ref_id = $3
                           GROUP BY inventory_item_id
                         ) d
                         LEFT JOIN (
                           SELECT le.inventory_item_id, SUM(le.qty_delta) AS received
                           FROM inventory_ledger_entries le
                           INNER JOIN inventory_transfer_receipts tr
                             ON tr.id = le.event_ref_id
                           WHERE le.tenant_id = $1 AND le.branch_id = $4
                             AND le.event_type = 'transfer_receipt'
                             AND le.event_ref_type = 'transfer_receipt'
                             AND tr.transfer_order_id = $3
                           GROUP BY le.inventory_item_id
                         ) r ON r.inventory_item_id = d.inventory_item_id`,
                        [
                            tenantId,
                            order.sourceBranchId,
                            order.id,
                            order.destinationBranchId,
                        ],
                    );
                for (const row of rows) {
                    crossBranchRemaining.set(
                        Number(row.item),
                        Number(row.remaining),
                    );
                }
            }

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
                const qtyBase =
                    await this.inventoryService.convertToItemBaseQty(
                        tenantId,
                        l.inventory_item_id,
                        Number(l.received_qty),
                        l.received_uom_id,
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

                if (sameBranch) {
                    // Re-credit the same batches that were dispatched, into the
                    // destination brand bucket, FEFO, capped at what's still in transit.
                    const batches = await this.getInTransitBatches(
                        manager,
                        order,
                        l.inventory_item_id,
                        sourceBrandId,
                        destinationBrandId,
                    );
                    let remaining = qtyBase;
                    for (const b of batches) {
                        if (remaining <= 1e-9) break;
                        const take = Math.min(b.available, remaining);
                        if (take <= 0) continue;
                        remaining -= take;
                        movements.push({
                            inventoryItemId: l.inventory_item_id,
                            inventoryBatchId: b.batchId,
                            locationId: l.location_id ?? null,
                            brandId: destinationBrandId,
                            qtyDelta: take,
                            eventType: 'transfer_receipt',
                            eventRefType: 'transfer_receipt',
                            eventRefId: receipt.id,
                            idempotencyKey: `transfer:${order.id}:receipt:${receipt.id}:${l.inventory_item_id}:batch:${b.batchId}:${take}`,
                            notes: l.notes ?? null,
                            createdBy: user.id,
                        });
                    }
                    if (remaining > 1e-9) {
                        throw new BadRequestException(
                            `Cannot receive ${qtyBase} of item ${item.code}: only ${qtyBase - remaining} is in transit for this brand move`,
                        );
                    }
                } else {
                    // Cross-branch: the stock physically moved, so create a new batch
                    // at the destination, owned by the destination brand bucket.
                    const rem =
                        crossBranchRemaining.get(l.inventory_item_id) ?? 0;
                    if (qtyBase > rem + 1e-9) {
                        throw new BadRequestException(
                            `Cannot receive ${qtyBase} of item ${item.code}: only ${Math.max(0, rem)} is in transit for this transfer`,
                        );
                    }
                    crossBranchRemaining.set(
                        l.inventory_item_id,
                        rem - qtyBase,
                    );
                    if (item.trackExpiry && !l.expiry_date) {
                        throw new BadRequestException(
                            `Missing expiry_date for item ${item.code}`,
                        );
                    }
                    const batch = await manager
                        .getRepository(InventoryBatch)
                        .save(
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
                    movements.push({
                        inventoryItemId: l.inventory_item_id,
                        inventoryBatchId: batch.id,
                        locationId: l.location_id ?? null,
                        brandId: destinationBrandId,
                        qtyDelta: Math.abs(qtyBase),
                        eventType: 'transfer_receipt',
                        eventRefType: 'transfer_receipt',
                        eventRefId: receipt.id,
                        idempotencyKey: `transfer:${order.id}:receipt:${receipt.id}:${l.inventory_item_id}:${l.location_id ?? 0}:${qtyBase}`,
                        notes: l.notes ?? null,
                        createdBy: user.id,
                    });
                }
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
            // Scoped update (not a full-entity save) so a concurrent dispatch's
            // audit-column write is not clobbered by this stale snapshot.
            await manager
                .getRepository(InventoryTransferOrder)
                .update(
                    { id: order.id },
                    { status: allReceived ? 'closed' : 'received_partial' },
                );
            return this.receiptRepo.findOne({
                where: { id: receipt.id },
                relations: { lines: true },
            });
        });
    }
}
