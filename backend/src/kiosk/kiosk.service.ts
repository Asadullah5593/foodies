import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Repository, QueryFailedError } from 'typeorm';
import {
    KioskOrder,
    KioskOrderPayload,
} from '../entities/kiosk-order.entity';
import { Branch } from '../entities/branch.entity';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { ShiftsService } from '../shifts/shifts.service';

type BranchWithBrands = Branch & {
    branchBrands?: Array<{ brand?: { tenantId?: number | null } }>;
};

export type KioskPaymentInput = { method: 'cash' | 'card'; amount: number };

const PENDING_TTL_HOURS = 12;
const MAX_CODE_ATTEMPTS = 12;

@Injectable()
export class KioskService {
    private readonly logger = new Logger(KioskService.name);

    constructor(
        @InjectRepository(KioskOrder)
        private readonly kioskRepo: Repository<KioskOrder>,
        @InjectRepository(Branch)
        private readonly branchRepo: Repository<Branch>,
        private readonly ordersService: OrdersService,
        private readonly paymentsService: PaymentsService,
        private readonly shiftsService: ShiftsService,
        private readonly dataSource: DataSource,
    ) {}

    /** Resolve tenant id from a branch (mirrors consumer.controller pattern). */
    private async getTenantIdFromBranch(branchId: number): Promise<number> {
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as BranchWithBrands | null;
        if (!branch?.branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const tenantId = branch.branchBrands[0]?.brand?.tenantId ?? null;
        if (tenantId == null) throw new NotFoundException('Branch not found');
        return tenantId;
    }

    private todayDate(): string {
        return new Date().toISOString().slice(0, 10);
    }

    private quoteInput(payload: KioskOrderPayload) {
        return {
            branch_id: payload.branch_id,
            order_type: payload.order_type,
            // quote/createOrder cast internally; deals are expanded at runtime.
            items: payload.items as unknown as {
                menu_item_id: number;
                quantity: number;
            }[],
            discount_code: payload.discount_code,
        };
    }

    /**
     * Kiosk submits a "pay at counter" cart. We validate + price it, store it as
     * a PENDING row, and return a short code the customer reads at the counter.
     * No real Order is created yet.
     */
    async submit(payload: KioskOrderPayload, idempotencyKey?: string | null) {
        if (!payload?.branch_id)
            throw new BadRequestException('branch_id is required');
        if (!Array.isArray(payload.items) || payload.items.length === 0)
            throw new BadRequestException('items are required');
        const orderType = (payload.order_type ?? '').trim();
        if (orderType !== 'dine_in' && orderType !== 'takeaway')
            throw new BadRequestException(
                "order_type must be 'dine_in' or 'takeaway'",
            );

        const tenantId = await this.getTenantIdFromBranch(payload.branch_id);

        // Loyalty redemption is not honored for kiosk source — drop it defensively.
        const sanitized: KioskOrderPayload = {
            branch_id: payload.branch_id,
            order_type: orderType,
            table_number: payload.table_number,
            customer_name: payload.customer_name?.trim() || undefined,
            customer_phone: payload.customer_phone?.trim() || undefined,
            items: payload.items,
            notes: payload.notes,
            discount_code: payload.discount_code,
        };

        // Validate items + compute the price (throws if no valid items).
        const quote = await this.ordersService.quote(
            this.quoteInput(sanitized),
            tenantId,
            'kiosk',
        );
        const total = Number(quote.total_amount);

        // Idempotent re-submit: same key on the same branch returns the existing row.
        if (idempotencyKey) {
            const existing = await this.kioskRepo.findOne({
                where: { branchId: payload.branch_id, idempotencyKey },
            });
            if (existing)
                return {
                    kiosk_code: existing.kioskCode,
                    total: Number(existing.snapshotTotal),
                };
        }

        const codeDate = this.todayDate();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + PENDING_TTL_HOURS);

        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            const kioskCode = await this.nextCode(payload.branch_id, codeDate);
            const row = this.kioskRepo.create({
                tenantId,
                branchId: payload.branch_id,
                kioskCode,
                codeDate,
                status: 'pending',
                orderType,
                payload: sanitized,
                quoteSnapshot: quote as unknown as Record<string, unknown>,
                snapshotTotal: total,
                customerName: sanitized.customer_name ?? null,
                customerPhone: sanitized.customer_phone ?? null,
                idempotencyKey: idempotencyKey ?? null,
                expiresAt,
            });
            try {
                const saved = await this.kioskRepo.save(row);
                return { kiosk_code: saved.kioskCode, total };
            } catch (e) {
                const constraint = this.uniqueConstraintOf(e);
                if (constraint === 'uq_kiosk_idempotency' && idempotencyKey) {
                    const existing = await this.kioskRepo.findOne({
                        where: { branchId: payload.branch_id, idempotencyKey },
                    });
                    if (existing)
                        return {
                            kiosk_code: existing.kioskCode,
                            total: Number(existing.snapshotTotal),
                        };
                }
                if (constraint === 'uq_kiosk_active_code') {
                    // Code raced with another submit — retry with the next number.
                    continue;
                }
                throw e;
            }
        }
        throw new BadRequestException(
            'Unable to allocate a kiosk order number, please try again',
        );
    }

    /** Next zero-padded daily-per-branch sequence among pending rows. */
    private async nextCode(branchId: number, codeDate: string): Promise<string> {
        const res: Array<{ max: number | string | null }> =
            await this.kioskRepo.query(
                `SELECT COALESCE(MAX(kiosk_code::int), 0) AS max
                 FROM kiosk_orders
                 WHERE branch_id = $1 AND code_date = $2 AND status = 'pending'`,
                [branchId, codeDate],
            );
        const next = Number(res?.[0]?.max ?? 0) + 1;
        return String(next).padStart(3, '0');
    }

    private uniqueConstraintOf(e: unknown): string | null {
        if (e instanceof QueryFailedError) {
            const driver = (e as unknown as { driverError?: { code?: string; constraint?: string } })
                .driverError;
            if (driver?.code === '23505') return driver.constraint ?? 'unknown';
        }
        return null;
    }

    /**
     * Cashier looks up a pending kiosk cart by its code. Returns the stored cart
     * plus a freshly recomputed total so price changes are visible.
     */
    async lookup(code: string, branchId: number, tenantId: number) {
        const row = await this.kioskRepo.findOne({
            where: { branchId, kioskCode: code, status: 'pending' },
        });
        if (!row || row.tenantId !== tenantId)
            throw new NotFoundException(
                'Kiosk order not found, already paid, or expired',
            );

        const submittedCount = row.payload.items?.length ?? 0;
        let currentTotal = 0;
        let itemsDropped = false;
        let quote: Awaited<ReturnType<OrdersService['quote']>> | null = null;
        try {
            quote = await this.ordersService.quote(
                this.quoteInput(row.payload),
                tenantId,
                'kiosk',
            );
            currentTotal = Number(quote.total_amount);
            if ((quote.line_breakdown?.length ?? 0) < submittedCount)
                itemsDropped = true;
        } catch {
            // All items invalid now (e.g. removed from menu).
            itemsDropped = true;
        }

        const snapshotTotal = Number(row.snapshotTotal);
        const priceChanged = quote
            ? Math.abs(currentTotal - snapshotTotal) > 0.01
            : true;

        return {
            kiosk_code: row.kioskCode,
            branch_id: row.branchId,
            order_type: row.orderType,
            customer_name: row.customerName,
            customer_phone: row.customerPhone,
            payload: row.payload,
            items: row.payload.items,
            snapshot_total: snapshotTotal,
            current_total: currentTotal,
            price_changed: priceChanged,
            items_dropped: itemsDropped,
            quote,
            created_at: row.createdAt,
        };
    }

    /**
     * Cashier finalizes a kiosk cart (possibly edited): creates the real order
     * with source='kiosk', records payments, and marks the kiosk row finalized.
     * Idempotent: re-finalizing a finalized code returns its existing group.
     */
    async finalize(
        code: string,
        branchId: number,
        tenantId: number,
        editedDto: KioskOrderPayload | undefined,
        payments: KioskPaymentInput[],
        userId: number,
    ) {
        const result = await this.dataSource.transaction(async (manager) => {
            const repo = manager.getRepository(KioskOrder);
            const row = await repo
                .createQueryBuilder('k')
                .setLock('pessimistic_write')
                .where('k.branchId = :branchId AND k.kioskCode = :code', {
                    branchId,
                    code,
                })
                .orderBy('k.id', 'DESC')
                .getOne();

            if (!row || row.tenantId !== tenantId)
                throw new NotFoundException('Kiosk order not found');

            // Idempotent retry — already finalized.
            if (row.status === 'finalized' && row.finalizedOrderGroupId) {
                const group = await this.ordersService.getOrderGroup(
                    row.finalizedOrderGroupId,
                );
                return { group, kioskCode: row.kioskCode, alreadyFinalized: true };
            }
            if (row.status !== 'pending')
                throw new BadRequestException(
                    `Kiosk order cannot be finalized (status: ${row.status})`,
                );

            // Cash-drawer reconciliation: require an open shift for this branch.
            const openShift = await this.shiftsService.findOpenByBranch(
                branchId,
            );
            if (!openShift)
                throw new ForbiddenException(
                    `No shift is open for branch ID ${branchId}. Open a shift in Admin → Shifts before finalizing kiosk orders.`,
                );

            const dto: KioskOrderPayload = {
                ...(editedDto ?? row.payload),
                branch_id: (editedDto ?? row.payload).branch_id ?? branchId,
            };

            // Validate the cashier's collected amount BEFORE creating the order
            // (a post-create rejection could not roll back the committed order).
            const quote = await this.ordersService.quote(
                this.quoteInput(dto),
                tenantId,
                'kiosk',
            );
            const expectedTotal = Number(quote.total_amount);
            const validPayments = (payments ?? []).filter(
                (p) => p && Number(p.amount) > 0,
            );
            const paid = validPayments.reduce(
                (s, p) => s + Number(p.amount),
                0,
            );
            if (Math.abs(paid - expectedTotal) > 0.01)
                throw new BadRequestException(
                    `Collected amount (${paid.toFixed(2)}) does not match order total (${expectedTotal.toFixed(2)})`,
                );

            // Create the real order. source='kiosk' attributes it to the kiosk
            // even though a cashier (userId) placed it.
            const created = await this.ordersService.createOrder(
                dto as unknown as Parameters<OrdersService['createOrder']>[0],
                tenantId,
                userId,
                'kiosk',
            );

            // Link + mark finalized immediately (before payments) so a retry is
            // idempotent and can never double-create the order.
            row.status = 'finalized';
            row.finalizedOrderGroupId = created.order_group_id;
            row.finalizedByUserId = userId;
            row.finalizedAt = new Date();
            await repo.save(row);

            return {
                group: created,
                kioskCode: row.kioskCode,
                payments: validPayments,
                alreadyFinalized: false,
            };
        });

        // Apply payments after the order + finalized state are committed.
        if (!result.alreadyFinalized && result.payments?.length) {
            await this.applyPayments(result.group.orders, result.payments);
        }

        return { ...result.group, kiosk_code: result.kioskCode };
    }

    /** Distribute collected payments proportionally across the order group. */
    private async applyPayments(
        orders: Array<{ id: number; total_amount?: number }>,
        payments: KioskPaymentInput[],
    ) {
        const grandTotal = orders.reduce(
            (s, o) => s + Number(o.total_amount ?? 0),
            0,
        );
        if (!orders.length || grandTotal <= 0) return;
        for (const order of orders) {
            const orderTotal = Number(order.total_amount ?? 0);
            if (orderTotal <= 0) continue;
            const ratio = orderTotal / grandTotal;
            for (const p of payments) {
                const amount = Math.round(Number(p.amount) * ratio * 100) / 100;
                if (amount > 0) {
                    await this.paymentsService.processPayment(
                        order.id,
                        p.method,
                        amount,
                    );
                }
            }
        }
    }

    /** Sweep abandoned pending carts so their codes are freed. */
    @Cron(CronExpression.EVERY_HOUR)
    async expireStalePending() {
        try {
            const res = await this.kioskRepo
                .createQueryBuilder()
                .update(KioskOrder)
                .set({ status: 'expired' })
                .where('status = :s AND expires_at IS NOT NULL AND expires_at < now()', {
                    s: 'pending',
                })
                .execute();
            if (res.affected)
                this.logger.log(`Expired ${res.affected} stale kiosk order(s)`);
        } catch (e) {
            this.logger.warn(
                `Failed to expire stale kiosk orders: ${(e as Error).message}`,
            );
        }
    }
}
