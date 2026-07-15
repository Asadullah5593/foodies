import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Repository, QueryFailedError, In } from 'typeorm';
import {
    KioskOrder,
    KioskOrderPayload,
    KioskOrderItemPayload,
} from '../entities/kiosk-order.entity';
import { Branch } from '../entities/branch.entity';
import { BranchBrand } from '../entities/branch-brand.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
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
        @InjectRepository(MenuVariant)
        private readonly variantRepo: Repository<MenuVariant>,
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

    /**
     * Fills in a missing `variant_id` with the item's default size, and rejects
     * only what is genuinely unusable.
     *
     * The kiosk used to demand an explicit variant on any sized item while POS and
     * the consumer API required nothing — so a cart POS accepts was rejected here
     * with no row written, which looks exactly like the order vanishing. POS picks
     * the merchant's `is_default` variant in the same situation
     * (`defaultVariantIdForItem`); this mirrors that rather than inventing a rule.
     *
     * A variant that does not belong to the item is still refused: that is a wrong
     * answer, not a missing one. The resolved id is written back into the payload,
     * so the stored cart is explicit and the counter sees the same size the kiosk
     * was priced at.
     */
    private async resolveVariantSelections(
        items: KioskOrderItemPayload[],
    ): Promise<void> {
        /** Lines by reference, so the resolved variant can be written back. */
        const lines: Array<{
            menuItemId: number;
            line: { variant_id?: number };
        }> = [];
        for (const it of items ?? []) {
            if (it.deal_menu_item_id != null) {
                for (const c of it.components ?? [])
                    lines.push({ menuItemId: c.menu_item_id, line: c });
            } else if (it.menu_item_id != null) {
                lines.push({ menuItemId: it.menu_item_id, line: it });
            }
        }
        const ids = [...new Set(lines.map((l) => l.menuItemId))];
        if (ids.length === 0) return;

        const variants = await this.variantRepo.find({
            where: { menuItemId: In(ids) },
        });
        const byItem = new Map<number, MenuVariant[]>();
        for (const v of variants) {
            if (!byItem.has(v.menuItemId)) byItem.set(v.menuItemId, []);
            byItem.get(v.menuItemId)!.push(v);
        }

        for (const { menuItemId, line } of lines) {
            const options = byItem.get(menuItemId);
            // No sizes to choose from — nothing to resolve, nothing to reject.
            if (!options || options.length === 0) continue;

            if (line.variant_id != null) {
                if (!options.some((v) => v.id === line.variant_id))
                    throw new BadRequestException(
                        `variant_id ${line.variant_id} is not valid for menu_item ${menuItemId}`,
                    );
                continue;
            }

            const fallback =
                options.find((v) => v.isDefault) ??
                [...options].sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )[0];
            if (!fallback) {
                throw new BadRequestException(
                    `menu_item ${menuItemId} has no usable size to default to; send a variant_id`,
                );
            }
            line.variant_id = fallback.id;
            this.logger.warn(
                `Kiosk sent no variant_id for menu_item ${menuItemId}; defaulted to variant ${fallback.id}` +
                    `${fallback.isDefault ? '' : ' (no is_default set — used the first by sort order)'}`,
            );
        }
    }

    /**
     * The tender the pricing engine sees is derived from the money actually being
     * collected, never from a client-sent split. A card offer only survives if the
     * cashier really is taking the whole bill on that card, so the kiosk cannot
     * price a bank-funded discount the tender does not back.
     */
    private paymentSplitOf(payments: KioskPaymentInput[] | undefined) {
        const sum = (method: 'cash' | 'card') =>
            (payments ?? [])
                .filter((p) => p?.method === method)
                .reduce((s, p) => s + (Number(p.amount) || 0), 0);
        return { cash_amount: sum('cash'), card_amount: sum('card') };
    }

    private quoteInput(
        payload: KioskOrderPayload,
        payments?: KioskPaymentInput[],
    ) {
        return {
            branch_id: payload.branch_id,
            order_type: payload.order_type,
            // quote/createOrder cast internally; deals are expanded at runtime.
            items: payload.items as unknown as {
                menu_item_id: number;
                quantity: number;
            }[],
            discount_code: payload.discount_code,
            // Only meaningful at finalize; at submit time there is no tender yet,
            // so no card offer is priced and the kiosk shows the undiscounted total.
            bank_card_id: payload.bank_card_id ?? null,
            payment_split: payments ? this.paymentSplitOf(payments) : undefined,
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

        // Items with variants must specify which one (the API has no UI to enforce it).
        await this.resolveVariantSelections(payload.items);

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

        // Validate items + compute the price (throws if no valid items, or if
        // the cart mixes brands — kiosk carts are single-brand).
        const quote = await this.ordersService.quote(
            this.quoteInput(sanitized),
            tenantId,
            'kiosk',
        );
        const total = Number(quote.total_amount);
        const cartBrandIds = new Set(
            (quote.line_breakdown ?? [])
                .map((l) => l.brand_id)
                .filter((id): id is number => id != null),
        );
        const brandId = cartBrandIds.size === 1 ? [...cartBrandIds][0] : null;

        // Kiosk is an online self-order channel: honor the per-(branch,brand)
        // open/close switch (POS finalize by a cashier is unaffected).
        if (brandId != null) {
            const bb = await this.dataSource
                .getRepository(BranchBrand)
                .findOne({ where: { branchId: payload.branch_id, brandId } });
            if (bb && bb.isOpen === false) {
                throw new ConflictException(
                    'This brand is currently closed at this branch.',
                );
            }
        }

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
                brandId,
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
    private async nextCode(
        branchId: number,
        codeDate: string,
    ): Promise<string> {
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
            const driver = (
                e as unknown as {
                    driverError?: { code?: string; constraint?: string };
                }
            ).driverError;
            if (driver?.code === '23505') return driver.constraint ?? 'unknown';
        }
        return null;
    }

    /**
     * Says why a code did not resolve, instead of one message covering five
     * different causes. "Not found, already paid, or expired" left a cashier (and
     * whoever they call) unable to tell a wrong-branch mistake from a cart the
     * kiosk never actually saved.
     *
     * Same-tenant staff only, so naming the other branch leaks nothing. A cart
     * belonging to a brand the cashier is locked out of stays deliberately vague.
     */
    private async explainMissing(
        code: string,
        branchId: number,
        tenantId: number,
    ): Promise<string> {
        const anywhere = await this.kioskRepo.find({
            where: { kioskCode: code, tenantId },
            order: { id: 'DESC' },
            take: 5,
        });
        if (anywhere.length === 0) {
            return `No kiosk order #${code} was ever received. If the kiosk showed this code, its order never reached the server — check the kiosk app for a rejected submit.`;
        }
        const here = anywhere.filter((r) => r.branchId === branchId);
        if (here.length === 0) {
            const other = await this.branchRepo.findOne({
                where: { id: anywhere[0].branchId },
            });
            return `Kiosk order #${code} belongs to ${other?.name ?? `branch ${anywhere[0].branchId}`}, not this branch. Switch the POS branch to load it.`;
        }
        const latest = here[0];
        if (latest.status === 'finalized')
            return `Kiosk order #${code} has already been paid.`;
        if (latest.status === 'expired')
            return `Kiosk order #${code} expired (carts are held for ${PENDING_TTL_HOURS} hours). Ring it up fresh.`;
        return `Kiosk order #${code} is no longer pending (${latest.status}).`;
    }

    /**
     * Cashier looks up a pending kiosk cart by its code. Returns the stored cart
     * plus a freshly recomputed total so price changes are visible.
     */
    async lookup(
        code: string,
        branchId: number,
        tenantId: number,
        /** Brand lock of the cashier (null = unrestricted). */
        allowedBrandIds: number[] | null = null,
    ) {
        const row = await this.kioskRepo.findOne({
            where: { branchId, kioskCode: code, status: 'pending' },
        });
        if (!row || row.tenantId !== tenantId) {
            throw new NotFoundException(
                await this.explainMissing(code, branchId, tenantId),
            );
        }
        this.assertCashierBrandAccess(row, allowedBrandIds);

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
            brand_id: row.brandId ?? null,
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
    /** A brand-locked cashier may only handle kiosk carts of their own brand. */
    private assertCashierBrandAccess(
        row: { brandId: number | null },
        allowedBrandIds: number[] | null,
    ) {
        if (allowedBrandIds == null) return;
        if (row.brandId == null || !allowedBrandIds.includes(row.brandId)) {
            throw new NotFoundException(
                'Kiosk order not found, already paid, or expired',
            );
        }
    }

    async finalize(
        code: string,
        branchId: number,
        tenantId: number,
        editedDto: KioskOrderPayload | undefined,
        payments: KioskPaymentInput[],
        userId: number,
        /** Brand lock of the cashier (null = unrestricted). */
        allowedBrandIds: number[] | null = null,
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
            this.assertCashierBrandAccess(row, allowedBrandIds);

            // Idempotent retry — already finalized.
            if (row.status === 'finalized' && row.finalizedOrderGroupId) {
                const group = await this.ordersService.getOrderGroup(
                    row.finalizedOrderGroupId,
                );
                return {
                    group,
                    kioskCode: row.kioskCode,
                    alreadyFinalized: true,
                };
            }
            if (row.status !== 'pending')
                throw new BadRequestException(
                    `Kiosk order cannot be finalized (status: ${row.status})`,
                );

            // Cash-drawer reconciliation: require an open shift for this branch.
            const openShift =
                await this.shiftsService.findOpenByBranch(branchId);
            if (!openShift)
                throw new ForbiddenException(
                    `No shift is open for branch ID ${branchId}. Open a shift in Admin → Shifts before finalizing kiosk orders.`,
                );

            const dto: KioskOrderPayload = {
                ...(editedDto ?? row.payload),
                branch_id: (editedDto ?? row.payload).branch_id ?? branchId,
            };

            // Same variant guard at finalize, in case the cart was edited.
            await this.resolveVariantSelections(dto.items);

            const validPayments = (payments ?? []).filter(
                (p) => p && Number(p.amount) > 0,
            );
            // Validate the cashier's collected amount BEFORE creating the order
            // (a post-create rejection could not roll back the committed order).
            // Priced against the real tender, so a card offer is only granted when
            // the whole bill is genuinely being taken on the chosen card.
            const quote = await this.ordersService.quote(
                this.quoteInput(dto, validPayments),
                tenantId,
                'kiosk',
            );
            const expectedTotal = Number(quote.total_amount);
            const paid = validPayments.reduce(
                (s, p) => s + Number(p.amount),
                0,
            );
            if (Math.abs(paid - expectedTotal) > 0.01)
                throw new BadRequestException(
                    `Collected amount (${paid.toFixed(2)}) does not match order total (${expectedTotal.toFixed(2)})`,
                );

            // Create the real order. source='kiosk' attributes it to the kiosk
            // even though a cashier (userId) placed it. It must be priced against
            // the same tender the quote above used, or the order would re-price
            // without the card offer and disagree with the amount collected.
            const created = await this.ordersService.createOrder(
                {
                    ...dto,
                    bank_card_id: dto.bank_card_id ?? null,
                    payment_split: this.paymentSplitOf(validPayments),
                } as unknown as Parameters<OrdersService['createOrder']>[0],
                tenantId,
                userId,
                'kiosk',
                null,
                allowedBrandIds,
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

        // Apply payments idempotently AFTER the order + finalized state are committed.
        // This runs on BOTH the fresh finalize and the idempotent retry path, so if
        // the process crashed / timed out between commit and payment application, the
        // cashier's retry heals the missing payments instead of losing them. The
        // per-slice idempotency key (in applyPayments) prevents double-recording.
        const validPayments = (payments ?? []).filter(
            (p) => p && Number(p.amount) > 0,
        );
        if (validPayments.length && result.group?.orders?.length) {
            await this.applyPayments(result.group.orders, validPayments);
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
            for (let i = 0; i < payments.length; i++) {
                const p = payments[i];
                const amount = Math.round(Number(p.amount) * ratio * 100) / 100;
                if (amount > 0) {
                    // Stable per-slice idempotency key: a retry re-applies the SAME
                    // keys, so processPayment deduplicates and a partial/lost
                    // application is completed without double-charging.
                    await this.paymentsService.processPayment(
                        order.id,
                        p.method,
                        amount,
                        undefined,
                        `kiosk:order:${order.id}:pay:${i}:${p.method}`,
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
                .where(
                    'status = :s AND expires_at IS NOT NULL AND expires_at < now()',
                    {
                        s: 'pending',
                    },
                )
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
