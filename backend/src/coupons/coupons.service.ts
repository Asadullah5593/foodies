import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Discount } from '../entities/discount.entity';
import { Voucher } from '../entities/voucher.entity';
import { CouponRealization } from '../entities/coupon-realization.entity';
import { Customer } from '../entities/customer.entity';
import { DiscountsService } from '../discounts/discounts.service';
import { normalizePakistaniPhone } from '../utils/phone';

/**
 * Coupons = voucher-backed discounts (offer_kind='coupon', requires_code=true).
 * CRUD delegates to DiscountsService; this service owns voucher issuance and the
 * usage/realization reporting. A voucher embeds the coupon's own code and an
 * opaque qr_token — leak-safety comes from customer binding + the realizations
 * ledger, not code secrecy — so the existing code-lookup redemption path works.
 */
@Injectable()
export class CouponsService {
    constructor(
        private discounts: DiscountsService,
        @InjectRepository(Discount)
        private discountRepo: Repository<Discount>,
        @InjectRepository(Voucher)
        private voucherRepo: Repository<Voucher>,
        @InjectRepository(CouponRealization)
        private realizationRepo: Repository<CouponRealization>,
        @InjectRepository(Customer)
        private customerRepo: Repository<Customer>,
    ) {}

    findAll(tenantId: number | null, allowedBrandIds?: number[] | null) {
        return this.discounts.findAll(tenantId, allowedBrandIds, ['coupon']);
    }

    async create(
        dto: Record<string, unknown>,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const created = await this.discounts.create(
            { ...(dto as object), offer_kind: 'coupon', requires_code: true } as never,
            tenantId,
            allowedBrandIds,
        );
        await this.syncVouchers(created as { id: number }, dto, tenantId);
        return created;
    }

    async update(
        id: number,
        tenantId: number,
        dto: Record<string, unknown>,
        allowedBrandIds?: number[] | null,
    ) {
        const updated = await this.discounts.update(
            id,
            tenantId,
            dto as never,
            allowedBrandIds,
        );
        // A voucher's `code` embeds the coupon code. When the admin renames the
        // code, follow it through to every already-issued voucher — otherwise the
        // voucher (and anything that displays it) keeps the OLD code while POS
        // redeems against the coupon's NEW `discounts.code`, so the two drift and
        // the coupon looks like it "can't be found". Only touches mismatched rows.
        if (dto.code !== undefined) {
            await this.voucherRepo.query(
                `UPDATE vouchers AS v
                 SET code = d.code
                 FROM discounts AS d
                 WHERE d.id = v.offer_id
                   AND v.offer_id = $1
                   AND d.tenant_id = $2
                   AND d.code IS NOT NULL AND d.code <> ''
                   AND v.code IS DISTINCT FROM d.code`,
                [id, tenantId],
            );
        }
        await this.syncVouchers({ id }, dto, tenantId);
        return updated;
    }

    /**
     * Keep a coupon's auto-generated vouchers in sync with its audience:
     *  - `specific`     → mint a voucher for each eligible customer (idempotent).
     *  - `new_customer` → ensure a single "template" voucher (no customer yet);
     *    a linked per-customer copy is minted when each customer registers.
     * Non-fatal — the coupon is still saved if voucher generation fails.
     */
    private async syncVouchers(
        coupon: { id: number },
        dto: Record<string, unknown>,
        tenantId: number,
    ): Promise<void> {
        const audience = dto.audience as string | undefined;
        try {
            if (audience === 'specific') {
                const ids = dto.eligible_customer_ids;
                if (Array.isArray(ids) && ids.length > 0) {
                    await this.issueVouchers(coupon.id, tenantId, ids.map(Number));
                }
            } else if (audience === 'new_customer') {
                await this.ensureTemplateVoucher(coupon.id, tenantId);
            } else if (audience === 'all') {
                await this.issueVouchersForAll(coupon.id, tenantId);
            }
        } catch {
            // non-fatal — the coupon is still created; vouchers can be retried.
        }
    }

    /**
     * An `all`-audience coupon materializes a REAL voucher for every existing
     * customer in the tenant, so each one sees it in the app (GET /vouchers/mine)
     * and at POS. New customers get theirs on registration
     * (`awardNewCustomerVouchers`). Idempotent — skips customers who already have
     * one — and runs as a single bulk INSERT…SELECT to stay fast on large bases.
     */
    async issueVouchersForAll(couponId: number, tenantId: number): Promise<void> {
        const coupon = await this.discountRepo.findOne({
            where: { id: couponId, tenantId },
        });
        if (!coupon || (coupon as { offerKind?: string }).offerKind !== 'coupon')
            return;
        const expiresAt = this.computeExpiry(coupon);
        await this.voucherRepo.query(
            `INSERT INTO vouchers
                (tenant_id, offer_id, customer_id, code, qr_token, status, expires_at, uses, granted_at)
             SELECT $1, $2, c.id, $3,
                    md5(random()::text || clock_timestamp()::text || c.id::text),
                    'active', $4, 0, now()
             FROM customers c
             WHERE c.tenant_id = $1
               AND NOT EXISTS (
                   SELECT 1 FROM vouchers v
                   WHERE v.offer_id = $2 AND v.customer_id = c.id
               )`,
            [tenantId, couponId, coupon.code ?? '', expiresAt],
        );
    }

    /**
     * A `new_customer` coupon has no customers up front, so we mint one unbound
     * "template" voucher (customer_id = null, status='template'). The admin sees
     * it immediately as the master; it is never redeemable itself. When a new
     * customer registers, `awardNewCustomerVouchers` mints a real, linked copy.
     */
    private async ensureTemplateVoucher(
        couponId: number,
        tenantId: number,
    ): Promise<void> {
        const coupon = await this.discountRepo.findOne({
            where: { id: couponId, tenantId },
        });
        if (!coupon || (coupon as { offerKind?: string }).offerKind !== 'coupon')
            return;
        const existing = await this.voucherRepo
            .createQueryBuilder('v')
            .where('v.offer_id = :id', { id: couponId })
            .andWhere('v.customer_id IS NULL')
            .getOne();
        if (existing) return;
        await this.voucherRepo.save(
            this.voucherRepo.create({
                tenantId,
                offerId: couponId,
                customerId: null,
                code: coupon.code ?? '',
                qrToken: randomUUID(),
                status: 'template',
                expiresAt: coupon.validUntil ?? null,
                uses: 0,
            }),
        );
    }

    remove(id: number, tenantId: number, allowedBrandIds?: number[] | null) {
        return this.discounts.remove(id, tenantId, allowedBrandIds);
    }

    private computeExpiry(coupon: Discount): Date | null {
        const days = (coupon as { voucherValidityDays?: number | null })
            .voucherValidityDays;
        const until = coupon.validUntil ?? null;
        if (days == null) return until;
        const d = new Date();
        d.setDate(d.getDate() + Number(days));
        if (until && d > until) return until;
        return d;
    }

    /** Mint vouchers for the given customers (idempotent per customer per coupon). */
    async issueVouchers(
        couponId: number,
        tenantId: number,
        customerIds: number[],
    ): Promise<{ issued: number; existing: number }> {
        const coupon = await this.discountRepo.findOne({
            where: { id: couponId, tenantId },
        });
        if (!coupon) throw new NotFoundException('Coupon not found');
        if ((coupon as { offerKind?: string }).offerKind !== 'coupon')
            throw new BadRequestException('Not a coupon');
        if (!Array.isArray(customerIds) || customerIds.length === 0)
            throw new BadRequestException('customer_ids required');
        let issued = 0;
        let existing = 0;
        for (const cid of customerIds) {
            const already = await this.voucherRepo.findOne({
                where: { offerId: couponId, customerId: Number(cid) },
            });
            if (already) {
                existing += 1;
                continue;
            }
            await this.voucherRepo.save(
                this.voucherRepo.create({
                    tenantId,
                    offerId: couponId,
                    customerId: Number(cid),
                    code: coupon.code ?? '',
                    qrToken: randomUUID(),
                    status: 'active',
                    expiresAt: this.computeExpiry(coupon),
                    uses: 0,
                }),
            );
            issued += 1;
        }
        return { issued, existing };
    }

    /**
     * On customer registration, mint a voucher for every active coupon this
     * customer should hold: `new_customer` coupons (the welcome offer) AND
     * `all`-audience coupons (offered to everyone, so new sign-ups get one too).
     * Non-fatal / idempotent.
     */
    async awardNewCustomerVouchers(
        tenantId: number,
        customerId: number,
    ): Promise<void> {
        const now = new Date();
        const coupons = await this.discountRepo.find({
            where: { tenantId, isActive: true },
        });
        for (const c of coupons) {
            if ((c as { offerKind?: string }).offerKind !== 'coupon') continue;
            const aud = (c as { audience?: string }).audience;
            if (aud !== 'new_customer' && aud !== 'all') continue;
            if (c.validFrom && now < c.validFrom) continue;
            if (c.validUntil && now > c.validUntil) continue;
            const exists = await this.voucherRepo.findOne({
                where: { offerId: c.id, customerId },
            });
            if (exists) continue;
            await this.voucherRepo.save(
                this.voucherRepo.create({
                    tenantId,
                    offerId: c.id,
                    customerId,
                    code: c.code ?? '',
                    qrToken: randomUUID(),
                    status: 'active',
                    expiresAt: this.computeExpiry(c),
                    uses: 0,
                }),
            );
        }
    }

    /**
     * POS: all vouchers a customer holds (active / used / expired) with validity,
     * looked up by phone. Marks expired lazily in the response.
     */
    async customerVouchers(tenantId: number, phone: string) {
        const normalized = normalizePakistaniPhone(phone) ?? phone.trim();
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) return { customer: null, vouchers: [] };
        const vs = await this.voucherRepo.find({
            where: { customerId: customer.id },
            order: { grantedAt: 'DESC' },
        });
        const offerIds = [...new Set(vs.map((v) => v.offerId))];
        const offers = offerIds.length
            ? await this.discountRepo.find({ where: { id: In(offerIds) } })
            : [];
        const byId = new Map(offers.map((o) => [o.id, o]));
        const now = new Date();
        return {
            customer: { id: customer.id, name: customer.name, phone: customer.phone },
            vouchers: vs.map((v) => {
                const o = byId.get(v.offerId);
                const expired = !!v.expiresAt && v.expiresAt < now;
                const status =
                    v.status !== 'active' ? v.status : expired ? 'expired' : 'active';
                return {
                    id: v.id,
                    reference: `VCH-${v.id}`,
                    code: v.code,
                    qr_token: v.qrToken,
                    title: o?.name ?? 'Voucher',
                    type: o?.type ?? null,
                    value: o != null ? Number(o.value) : null,
                    min_order_amount: o?.minOrderAmount != null ? Number(o.minOrderAmount) : null,
                    status,
                    uses: v.uses,
                    per_customer_limit:
                        (o as { perCustomerLimit?: number | null } | undefined)?.perCustomerLimit ?? null,
                    granted_at: v.grantedAt?.toISOString() ?? null,
                    expires_at: v.expiresAt?.toISOString() ?? null,
                    last_used_at: v.lastUsedAt?.toISOString() ?? null,
                };
            }),
        };
    }

    async listVouchers(couponId: number, tenantId: number) {
        const rows = await this.voucherRepo.find({
            where: { offerId: couponId, tenantId },
            order: { grantedAt: 'DESC' },
        });
        const custIds = [
            ...new Set(rows.map((r) => r.customerId).filter((id): id is number => id != null)),
        ];
        const customers = custIds.length
            ? await this.customerRepo.find({ where: { id: In(custIds) } })
            : [];
        const byId = new Map(customers.map((c) => [c.id, c]));
        return rows.map((v) => ({
            id: v.id,
            reference: v.customerId == null ? 'TEMPLATE' : `VCH-${v.id}`,
            is_template: v.customerId == null,
            code: v.code,
            qr_token: v.qrToken,
            customer_id: v.customerId,
            customer_name: v.customerId == null ? null : (byId.get(v.customerId)?.name ?? null),
            customer_phone: v.customerId == null ? null : (byId.get(v.customerId)?.phone ?? null),
            status: v.status,
            uses: v.uses,
            granted_at: v.grantedAt?.toISOString() ?? null,
            expires_at: v.expiresAt?.toISOString() ?? null,
            last_used_at: v.lastUsedAt?.toISOString() ?? null,
        }));
    }

    /** Usage report for a coupon (redemptions + value + merchant/bank split). */
    async report(couponId: number, tenantId: number) {
        const rows = await this.realizationRepo.find({
            where: { offerId: couponId, tenantId },
            order: { createdAt: 'DESC' },
        });
        const active = rows.filter((r) => r.reversedAt == null);
        return {
            total_redemptions: active.length,
            reversed: rows.length - active.length,
            total_value: active.reduce((s, r) => s + Number(r.amount), 0),
            rows: rows.map((r) => ({
                id: r.id,
                order_id: r.orderId,
                customer_id: r.customerId,
                customer_phone: r.customerPhone,
                source: r.source,
                amount: Number(r.amount),
                created_at: r.createdAt?.toISOString() ?? null,
                reversed_at: r.reversedAt?.toISOString() ?? null,
            })),
        };
    }
}
