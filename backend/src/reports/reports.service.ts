import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { Order } from '../entities/order.entity';
import { BankCard } from '../entities/bank-card.entity';
import { StaffDiscount } from '../entities/staff-discount.entity';
import { User } from '../entities/user.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Shift } from '../entities/shift.entity';
import { Payment } from '../entities/payment.entity';
import { BrandOrderRating } from '../entities/brand-order-rating.entity';
import { RiderOrderRating } from '../entities/rider-order-rating.entity';
import { RiderPresence } from '../entities/rider-presence.entity';
import { InventoryOnHand } from '../entities/inventory-on-hand.entity';
import { WastageEvent } from '../entities/wastage-event.entity';
import { discountFilterSql, isDiscountFilter } from '../common/discount-filter';

/**
 * Nudges a per-stage discount split so it adds up to the total exactly.
 *
 * Each stage's share is rounded on its own, so five roundings can drift a
 * paisa or two away from the total printed beside them — and a breakdown that
 * does not sum to its own total reads as a bug to whoever is reconciling it.
 * The drift lands on the largest stage, where it is proportionally smallest.
 */
export function reconcileDiscountBreakdown<K extends string>(
    parts: Record<K, number>,
    total: number,
): Record<K, number> {
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const keys = Object.keys(parts) as K[];
    if (keys.length === 0) return parts;
    const out = { ...parts };
    const drift = round2(total - keys.reduce((n, k) => n + out[k], 0));
    if (drift === 0) return out;
    const biggest = keys.reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[biggest] = round2(out[biggest] + drift);
    return out;
}

@Injectable()
export class ReportsService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem)
        private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(Shift) private shiftRepo: Repository<Shift>,
        @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
        @InjectRepository(BrandOrderRating)
        private brandRatingRepo: Repository<BrandOrderRating>,
        @InjectRepository(RiderOrderRating)
        private riderRatingRepo: Repository<RiderOrderRating>,
        @InjectRepository(RiderPresence)
        private riderPresenceRepo: Repository<RiderPresence>,
        @InjectRepository(InventoryOnHand)
        private inventoryOnHandRepo: Repository<InventoryOnHand>,
        @InjectRepository(WastageEvent)
        private wastageRepo: Repository<WastageEvent>,
    ) {}

    /**
     * Build the reporting window from a date (YYYY-MM-DD) plus an optional
     * time-of-day (HH:mm), both read in the SERVER's local clock — which is the
     * branch clock (all branches are Asia/Karachi).
     *
     * Reading the date locally matters: `new Date('2026-06-16')` is parsed as UTC
     * midnight per spec, which in a UTC+5 branch is 05:00 local — so the old code
     * silently dropped the first five hours of the opening day while ending the
     * range at local 23:59. A window the user sets to 09:00 has to mean 09:00 to
     * them, so both bounds are now built from local components.
     */
    private resolveDayRange(filters: {
        date_from?: string;
        date_to?: string;
        time_from?: string;
        time_to?: string;
    }): { dateFrom: Date; dateTo: Date } {
        const atLocal = (
            ymd: string | undefined,
            hms: string | undefined,
            fallback: () => Date,
            endOfDay: boolean,
        ): Date => {
            const dayParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
                (ymd ?? '').trim(),
            );
            if (!dayParts) return fallback();
            const [, y, m, d] = dayParts;
            const timeParts = /^(\d{1,2}):(\d{2})$/.exec((hms ?? '').trim());
            const hh = timeParts
                ? Math.min(23, +timeParts[1])
                : endOfDay
                  ? 23
                  : 0;
            const mm = timeParts
                ? Math.min(59, +timeParts[2])
                : endOfDay
                  ? 59
                  : 0;
            // Seconds belong to the BOUND, never to whether a time was supplied: a
            // start of 18:00 must include 18:00:30, so it opens at :00; an end of
            // 17:30 must too, so it closes at :59.999.
            const ss = endOfDay ? 59 : 0;
            const ms = endOfDay ? 999 : 0;
            return new Date(+y, +m - 1, +d, hh, mm, ss, ms);
        };

        const dateFrom = atLocal(
            filters.date_from,
            filters.time_from,
            () => new Date(new Date().setHours(0, 0, 0, 0)),
            false,
        );
        const dateTo = atLocal(
            filters.date_to,
            filters.time_to,
            () => {
                const d = new Date();
                d.setHours(23, 59, 59, 999);
                return d;
            },
            true,
        );
        return { dateFrom, dateTo };
    }

    /**
     * Throws if the caller asked for a specific branch they are not allowed to
     * see. Mirrors the inline checks used by the existing report methods.
     */
    private assertBranchAccess(
        allowedBranchIds: number[] | null | undefined,
        branchId?: number,
    ): void {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            branchId != null &&
            !allowedBranchIds.includes(branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
    }

    /**
     * Throws if the caller asked for a specific brand they are not allowed to
     * see (brand-locked users may only report on their own brands).
     */
    private assertBrandAccess(
        allowedBrandIds: number[] | null | undefined,
        brandId?: number,
    ): void {
        if (
            allowedBrandIds != null &&
            brandId != null &&
            !allowedBrandIds.includes(brandId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
    }

    /**
     * Applies the shared tenant + branch-allowlist + single-branch filter to a
     * query builder whose order/scoped alias is `alias`. The alias entity must
     * expose `tenantId` and `branchId` columns.
     */
    private applyOrderScope<T extends ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        alias: string,
        tenantId: number | null,
        allowedBranchIds: number[] | null | undefined,
        branchId?: number,
        allowedBrandIds?: number[] | null,
        brandId?: number,
    ): SelectQueryBuilder<T> {
        if (tenantId != null)
            qb.andWhere(`${alias}.tenantId = :tenantId`, { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            qb.andWhere(`${alias}.branchId IN (:...allowedBranchIds)`, {
                allowedBranchIds,
            });
        }
        if (branchId)
            qb.andWhere(`${alias}.branchId = :branchId`, { branchId });
        this.applyBrandScope(qb, alias, allowedBrandIds, brandId);
        return qb;
    }

    /**
     * Brand filter for any query with an orders-like alias exposing brandId:
     * brand-locked users are restricted to their brands, and an explicit
     * brand_id report filter narrows further.
     */
    private applyBrandScope<T extends ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        alias: string,
        allowedBrandIds?: number[] | null,
        brandId?: number,
    ): SelectQueryBuilder<T> {
        if (allowedBrandIds != null) {
            qb.andWhere(`${alias}.brandId IN (:...allowedBrandIds)`, {
                allowedBrandIds,
            });
        }
        if (brandId) {
            qb.andWhere(`${alias}.brandId = :reportBrandId`, {
                reportBrandId: brandId,
            });
        }
        return qb;
    }

    private formatDay(d: Date): string {
        return d.toISOString().slice(0, 10);
    }

    /** Completed-order financial aggregate over a date range (KPIs / deltas). */
    private async kpiAggregate(
        range: { dateFrom: Date; dateTo: Date },
        tenantId: number | null,
        allowedBranchIds: number[] | null | undefined,
        branchId?: number,
        allowedBrandIds?: number[] | null,
        brandId?: number,
    ): Promise<{
        completed_orders: number;
        total_revenue: number;
        total_sales: number;
        total_discounts: number;
        promo_discounts: number;
        order_discounts: number;
        coupon_discounts: number;
        card_discounts: number;
        staff_discounts: number;
        total_tax: number;
        total_service_charge: number;
        total_delivery_fee: number;
    }> {
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .where("o.status = 'completed'")
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', range)
            .select('COUNT(*)', 'completed_orders')
            .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'total_revenue')
            .addSelect('COALESCE(SUM(o.subtotal), 0)', 'total_sales')
            .addSelect('COALESCE(SUM(o.discountAmount), 0)', 'total_discounts')
            // The split behind total_discounts. Card discounts are bank-funded;
            // the rest come out of the merchant's own margin, and one lumped
            // number cannot tell those apart.
            .addSelect(
                'COALESCE(SUM(o.promoDiscountAmount), 0)',
                'promo_discounts',
            )
            .addSelect(
                'COALESCE(SUM(o.orderDiscountAmount), 0)',
                'order_discounts',
            )
            .addSelect(
                'COALESCE(SUM(o.couponDiscountAmount), 0)',
                'coupon_discounts',
            )
            .addSelect(
                'COALESCE(SUM(o.cardDiscountAmount), 0)',
                'card_discounts',
            )
            // Discretion at the till, not an offer the cart earned — the one
            // slice of the discount total a manager can act on directly.
            .addSelect(
                'COALESCE(SUM(o.staffDiscountAmount), 0)',
                'staff_discounts',
            )
            .addSelect('COALESCE(SUM(o.taxAmount), 0)', 'total_tax')
            .addSelect(
                'COALESCE(SUM(o.serviceCharge), 0)',
                'total_service_charge',
            )
            .addSelect('COALESCE(SUM(o.deliveryFee), 0)', 'total_delivery_fee');
        this.applyOrderScope(
            qb,
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        );
        const r = await qb.getRawOne<Record<string, string>>();
        return {
            completed_orders: Number(r?.completed_orders ?? 0),
            total_revenue: Number(r?.total_revenue ?? 0),
            total_sales: Number(r?.total_sales ?? 0),
            total_discounts: Number(r?.total_discounts ?? 0),
            promo_discounts: Number(r?.promo_discounts ?? 0),
            order_discounts: Number(r?.order_discounts ?? 0),
            coupon_discounts: Number(r?.coupon_discounts ?? 0),
            card_discounts: Number(r?.card_discounts ?? 0),
            staff_discounts: Number(r?.staff_discounts ?? 0),
            total_tax: Number(r?.total_tax ?? 0),
            total_service_charge: Number(r?.total_service_charge ?? 0),
            total_delivery_fee: Number(r?.total_delivery_fee ?? 0),
        };
    }

    private pctDelta(curr: number, prev: number): number | null {
        if (!prev) return null;
        return ((curr - prev) / prev) * 100;
    }

    async dayOverview(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            date_from?: string;
            date_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            filters.branch_id != null &&
            !allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);

        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        // Orders by status (placedAt in range)
        const ordersStatusQb = this.orderRepo
            .createQueryBuilder('o')
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('o.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('o.status');
        if (tenantId != null)
            ordersStatusQb.andWhere('o.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            ordersStatusQb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            ordersStatusQb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(
            ordersStatusQb,
            'o',
            allowedBrandIds,
            filters.brand_id,
        );
        const ordersByStatusRows = await ordersStatusQb.getRawMany<{
            status: string;
            count: string;
        }>();

        const orders_by_status: Record<string, number> = {};
        for (const row of ordersByStatusRows) {
            orders_by_status[row.status] = parseInt(row.count ?? '0', 10) || 0;
        }

        // Orders by status + source
        const ordersStatusSourceQb = this.orderRepo
            .createQueryBuilder('o')
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('o.source', 'source')
            .addSelect('o.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('o.source')
            .addGroupBy('o.status');
        if (tenantId != null)
            ordersStatusSourceQb.andWhere('o.tenantId = :tenantId', {
                tenantId,
            });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            ordersStatusSourceQb.andWhere(
                'o.branchId IN (:...allowedBranchIds)',
                {
                    allowedBranchIds,
                },
            );
        }
        if (filters.branch_id)
            ordersStatusSourceQb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(
            ordersStatusSourceQb,
            'o',
            allowedBrandIds,
            filters.brand_id,
        );
        const ordersByStatusSourceRows = await ordersStatusSourceQb.getRawMany<{
            source: string | null;
            status: string;
            count: string;
        }>();

        const orders_by_status_by_source: Record<
            string,
            Record<string, number>
        > = {};
        for (const row of ordersByStatusSourceRows) {
            const src = row.source ?? 'pos';
            if (!orders_by_status_by_source[src])
                orders_by_status_by_source[src] = {};
            orders_by_status_by_source[src][row.status] =
                parseInt(row.count ?? '0', 10) || 0;
        }

        // Payments: based on completed orders completedAt in range
        const paymentsTotalQb = this.paymentRepo
            .createQueryBuilder('p')
            .innerJoin(Order, 'o', 'o.id = p.orderId')
            .andWhere("o.status = 'completed'")
            .andWhere('o.completedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('SUM(p.amount)', 'total');
        if (tenantId != null)
            paymentsTotalQb.andWhere('o.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            paymentsTotalQb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            paymentsTotalQb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(
            paymentsTotalQb,
            'o',
            allowedBrandIds,
            filters.brand_id,
        );
        const paymentsTotalRow = await paymentsTotalQb.getRawOne<{
            total: string | null;
        }>();
        const payments_total = parseFloat(paymentsTotalRow?.total ?? '0') || 0;

        const paymentsByMethodQb = this.paymentRepo
            .createQueryBuilder('p')
            .innerJoin(Order, 'o', 'o.id = p.orderId')
            .andWhere("o.status = 'completed'")
            .andWhere('o.completedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('p.paymentMethod', 'method')
            .addSelect('SUM(p.amount)', 'total')
            .groupBy('p.paymentMethod');
        if (tenantId != null)
            paymentsByMethodQb.andWhere('o.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            paymentsByMethodQb.andWhere(
                'o.branchId IN (:...allowedBranchIds)',
                {
                    allowedBranchIds,
                },
            );
        }
        if (filters.branch_id)
            paymentsByMethodQb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(
            paymentsByMethodQb,
            'o',
            allowedBrandIds,
            filters.brand_id,
        );
        const paymentsByMethodRows = await paymentsByMethodQb.getRawMany<{
            method: string;
            total: string;
        }>();
        const payments_by_method: Record<string, number> = {};
        for (const row of paymentsByMethodRows) {
            payments_by_method[row.method] = parseFloat(row.total ?? '0') || 0;
        }

        const paymentsByMethodSourceQb = this.paymentRepo
            .createQueryBuilder('p')
            .innerJoin(Order, 'o', 'o.id = p.orderId')
            .andWhere("o.status = 'completed'")
            .andWhere('o.completedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('o.source', 'source')
            .addSelect('p.paymentMethod', 'method')
            .addSelect('SUM(p.amount)', 'total')
            .groupBy('o.source')
            .addGroupBy('p.paymentMethod');
        if (tenantId != null)
            paymentsByMethodSourceQb.andWhere('o.tenantId = :tenantId', {
                tenantId,
            });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            paymentsByMethodSourceQb.andWhere(
                'o.branchId IN (:...allowedBranchIds)',
                {
                    allowedBranchIds,
                },
            );
        }
        if (filters.branch_id)
            paymentsByMethodSourceQb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(
            paymentsByMethodSourceQb,
            'o',
            allowedBrandIds,
            filters.brand_id,
        );
        const paymentsByMethodSourceRows =
            await paymentsByMethodSourceQb.getRawMany<{
                source: string | null;
                method: string;
                total: string;
            }>();
        const payments_by_method_by_source: Record<
            string,
            Record<string, number>
        > = {};
        for (const row of paymentsByMethodSourceRows) {
            const src = row.source ?? 'pos';
            if (!payments_by_method_by_source[src])
                payments_by_method_by_source[src] = {};
            payments_by_method_by_source[src][row.method] =
                parseFloat(row.total ?? '0') || 0;
        }

        return {
            date_from:
                filters.date_from ?? new Date().toISOString().slice(0, 10),
            date_to: filters.date_to ?? new Date().toISOString().slice(0, 10),
            branch_id: filters.branch_id ?? null,
            orders_by_status,
            orders_by_status_by_source,
            payments_total,
            payments_by_method,
            payments_by_method_by_source,
        };
    }

    async salesSummary(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            date_from?: string;
            date_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            filters.branch_id != null &&
            !allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .where('o.status = :status', { status: 'completed' })
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            });
        if (tenantId != null)
            qb.andWhere('o.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            qb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            qb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(qb, 'o', allowedBrandIds, filters.brand_id);

        const orders = await qb.getMany();
        const totalRevenue = orders.reduce(
            (s, o) => s + Number(o.totalAmount),
            0,
        );
        const totalSales = orders.reduce((s, o) => s + Number(o.subtotal), 0);
        const totalDiscounts = orders.reduce(
            (s, o) => s + Number(o.discountAmount),
            0,
        );
        // Broken out on the shift because it is the one discount a manager can
        // hold this till accountable for.
        const totalStaffDiscounts = orders.reduce(
            (s, o) => s + Number(o.staffDiscountAmount || 0),
            0,
        );
        const totalServiceCharge = orders.reduce(
            (s, o) => s + Number(o.serviceCharge || 0),
            0,
        );
        const totalDeliveryFee = orders.reduce(
            (s, o) => s + Number(o.deliveryFee || 0),
            0,
        );
        const totalTax = orders.reduce(
            (s, o) => s + Number(o.taxAmount || 0),
            0,
        );

        return {
            total_orders: orders.length,
            total_revenue: totalRevenue,
            total_sales: totalSales,
            total_discounts: totalDiscounts,
            total_staff_discounts: totalStaffDiscounts,
            total_service_charge: totalServiceCharge,
            total_delivery_fee: totalDeliveryFee,
            total_tax: totalTax,
            average_order_value: orders.length
                ? totalRevenue / orders.length
                : 0,
        };
    }

    async topItems(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            limit?: number;
            date_from?: string;
            date_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            filters.branch_id != null &&
            !allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const limit = filters.limit ?? 10;
        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        const qb = this.orderItemRepo
            .createQueryBuilder('oi')
            .innerJoin('oi.order', 'o')
            .leftJoin('oi.menuItem', 'mi')
            .andWhere('o.status = :status', { status: 'completed' })
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('oi.menuItemId', 'menu_item_id')
            .addSelect('MAX(COALESCE(mi.name, oi.nameSnapshot))', 'name')
            .addSelect('SUM(oi.quantity)', 'quantity')
            .addSelect('SUM(oi.subtotal)', 'total_revenue')
            .groupBy('oi.menuItemId')
            .orderBy('SUM(oi.quantity)', 'DESC')
            .limit(limit);
        if (tenantId != null)
            qb.andWhere('o.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            qb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            qb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(qb, 'o', allowedBrandIds, filters.brand_id);

        return qb.getRawMany();
    }

    /**
     * Product-wise sales: one row per menu item over the window, with an
     * optional child split (variant / branch / brand).
     *
     * Two things are worth knowing about the money columns:
     *
     * - `gross_sales` is the sum of the order LINE subtotals, which already
     *   include addon and modifier surcharges (see orders.service —
     *   itemSubtotal accumulates both before the line is stored).
     * - Discounts are only ever stored at ORDER level (orders.discount_amount
     *   and its per-stage split); there is no per-line discount column. So the
     *   `discount` column is a PRO-RATA allocation — each line takes the share
     *   of its order's discount that matches its share of that order's
     *   subtotal. Summed over all lines of an order this lands exactly on the
     *   order's discount_amount, so the report's net total reconciles with
     *   sales-summary.
     *
     * Deal components are counted as themselves: a pizza sold inside a deal
     * lands on the pizza's row, priced at the resolved deal unit price.
     */
    async productSales(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            category_id?: number;
            date_from?: string;
            date_to?: string;
            time_from?: string;
            time_to?: string;
            /** completed (default) | all | excluding_cancelled */
            status?: string;
            /**
             * Restrict to orders that were discounted: any | none, or one
             * stage (promo | order | coupon | card | staff). Filters the
             * ORDERS, not the product rows — "what sold on coupon orders" is
             * the question, and a product's own share may still be zero.
             */
            discount?: string;
            /** child rows under each product */
            split_by?: 'variant' | 'branch' | 'brand' | 'none';
            sort_by?:
                | 'quantity'
                | 'gross_sales'
                | 'net_sales'
                | 'orders'
                | 'name';
            sort_dir?: 'asc' | 'desc';
            limit?: number;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertBranchAccess(allowedBranchIds, filters.branch_id);
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);

        const splitBy = filters.split_by ?? 'variant';
        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        // Each line's slice of its order's discount, weighted by subtotal share.
        // A zero-subtotal order (fully-comped, or a data oddity) divides by
        // nothing rather than blowing up.
        const shareOf = (column: string): string =>
            `COALESCE(SUM(oi.subtotal * (CASE WHEN o.subtotal > 0 THEN o.${column} / o.subtotal ELSE 0 END)), 0)`;
        const discountExpr = shareOf('discountAmount');

        /**
         * The same pro-rata slice, taken per discount stage. The five stages sum
         * to discountAmount on the order, so their shares sum to `discount` here
         * (bar rounding, which is reconciled below) — which is what lets the
         * report answer "which kind of discount did this product give away?"
         * rather than just "how much".
         */
        const DISCOUNT_STAGES = [
            { key: 'promo', column: 'promoDiscountAmount' },
            { key: 'order', column: 'orderDiscountAmount' },
            { key: 'coupon', column: 'couponDiscountAmount' },
            { key: 'card', column: 'cardDiscountAmount' },
            { key: 'staff', column: 'staffDiscountAmount' },
        ] as const;
        type StageKey = (typeof DISCOUNT_STAGES)[number]['key'];
        type Breakdown = Record<StageKey, number>;

        const addDiscountSelects = <T extends ObjectLiteral>(
            qb: SelectQueryBuilder<T>,
        ): SelectQueryBuilder<T> => {
            qb.addSelect(discountExpr, 'discount');
            for (const stage of DISCOUNT_STAGES)
                qb.addSelect(shareOf(stage.column), `discount_${stage.key}`);
            return qb;
        };

        const scoped = (): SelectQueryBuilder<OrderItem> => {
            const qb = this.orderItemRepo
                .createQueryBuilder('oi')
                .innerJoin('oi.order', 'o')
                .leftJoin('oi.menuItem', 'mi')
                .where('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                });
            if (filters.status === 'all') {
                // no status predicate
            } else if (filters.status === 'excluding_cancelled') {
                qb.andWhere("o.status <> 'cancelled'");
            } else {
                qb.andWhere('o.status = :psStatus', { psStatus: 'completed' });
            }
            this.applyOrderScope(
                qb,
                'o',
                tenantId,
                allowedBranchIds,
                filters.branch_id,
                allowedBrandIds,
                filters.brand_id,
            );
            if (isDiscountFilter(filters.discount)) {
                const predicate = discountFilterSql(filters.discount, 'o');
                if (predicate) qb.andWhere(predicate);
            }
            if (filters.category_id)
                qb.andWhere('mi.categoryId = :psCategoryId', {
                    psCategoryId: filters.category_id,
                });
            return qb;
        };

        const rowsQb = scoped()
            .leftJoin('mi.category', 'mc')
            // A menu item hangs off exactly one category, and a category off one
            // brand, so the brand column is a single value per row. Branch is not:
            // the same product sells across branches, hence the count alongside
            // the name (the client shows "N branches" when it is more than one).
            .leftJoin('mc.brand', 'mb')
            .leftJoin('o.branch', 'ob')
            .select('oi.menuItemId', 'menu_item_id')
            .addSelect('MAX(COALESCE(mi.name, oi.nameSnapshot))', 'name')
            .addSelect('MAX(mi.categoryId)', 'category_id')
            .addSelect('MAX(mc.name)', 'category_name')
            .addSelect('MAX(mc.brandId)', 'brand_id')
            .addSelect('MAX(mb.name)', 'brand_name')
            .addSelect('COUNT(DISTINCT o.branchId)', 'branch_count')
            .addSelect('MIN(ob.name)', 'branch_name')
            .addSelect('COALESCE(SUM(oi.quantity), 0)', 'quantity')
            .addSelect('COUNT(DISTINCT o.id)', 'orders')
            .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'gross_sales')
            .groupBy('oi.menuItemId');
        addDiscountSelects(rowsQb);

        const childQb =
            splitBy === 'none'
                ? null
                : splitBy === 'branch'
                  ? scoped()
                        .leftJoin('o.branch', 'b')
                        .select('oi.menuItemId', 'menu_item_id')
                        .addSelect('o.branchId', 'child_id')
                        .addSelect('MAX(b.name)', 'child_name')
                        .addSelect('COALESCE(SUM(oi.quantity), 0)', 'quantity')
                        .addSelect('COUNT(DISTINCT o.id)', 'orders')
                        .addSelect(
                            'COALESCE(SUM(oi.subtotal), 0)',
                            'gross_sales',
                        )
                        .groupBy('oi.menuItemId')
                        .addGroupBy('o.branchId')
                  : splitBy === 'brand'
                    ? scoped()
                          .leftJoin('o.brand', 'br')
                          .select('oi.menuItemId', 'menu_item_id')
                          .addSelect('o.brandId', 'child_id')
                          .addSelect('MAX(br.name)', 'child_name')
                          .addSelect(
                              'COALESCE(SUM(oi.quantity), 0)',
                              'quantity',
                          )
                          .addSelect('COUNT(DISTINCT o.id)', 'orders')
                          .addSelect(
                              'COALESCE(SUM(oi.subtotal), 0)',
                              'gross_sales',
                          )
                          .groupBy('oi.menuItemId')
                          .addGroupBy('o.brandId')
                    : scoped()
                          .leftJoin('oi.variant', 'v')
                          .select('oi.menuItemId', 'menu_item_id')
                          .addSelect('oi.variantId', 'child_id')
                          .addSelect('MAX(v.name)', 'child_name')
                          .addSelect(
                              'COALESCE(SUM(oi.quantity), 0)',
                              'quantity',
                          )
                          .addSelect('COUNT(DISTINCT o.id)', 'orders')
                          .addSelect(
                              'COALESCE(SUM(oi.subtotal), 0)',
                              'gross_sales',
                          )
                          .groupBy('oi.menuItemId')
                          .addGroupBy('oi.variantId');

        if (childQb) addDiscountSelects(childQb);

        const [rawRows, rawChildren] = await Promise.all([
            rowsQb.getRawMany<Record<string, string | number | null>>(),
            childQb
                ? childQb.getRawMany<Record<string, string | number | null>>()
                : Promise.resolve([]),
        ]);

        const round2 = (n: number): number => Math.round(n * 100) / 100;
        const toMoney = (v: string | number | null | undefined): number =>
            round2(Number(v ?? 0));

        const breakdownOf = (
            raw: Record<string, string | number | null>,
            discount: number,
        ): Breakdown =>
            reconcileDiscountBreakdown(
                Object.fromEntries(
                    DISCOUNT_STAGES.map((stage) => [
                        stage.key,
                        toMoney(raw[`discount_${stage.key}`]),
                    ]),
                ) as Breakdown,
                discount,
            );

        const childrenByItem = new Map<
            number,
            Array<{
                id: number | null;
                name: string;
                quantity: number;
                orders: number;
                gross_sales: number;
                discount: number;
                discount_breakdown: Breakdown;
                net_sales: number;
            }>
        >();
        for (const c of rawChildren) {
            const itemId = Number(c.menu_item_id);
            const gross = toMoney(c.gross_sales);
            const discount = toMoney(c.discount);
            const list = childrenByItem.get(itemId) ?? [];
            list.push({
                id: c.child_id == null ? null : Number(c.child_id),
                name:
                    (c.child_name as string | null) ??
                    (splitBy === 'variant' ? 'Regular' : 'Unassigned'),
                quantity: Number(c.quantity ?? 0),
                orders: Number(c.orders ?? 0),
                gross_sales: gross,
                discount,
                discount_breakdown: breakdownOf(c, discount),
                net_sales: round2(gross - discount),
            });
            childrenByItem.set(itemId, list);
        }
        for (const list of childrenByItem.values())
            list.sort((a, b) => b.quantity - a.quantity);

        let rows = rawRows.map((r) => {
            const gross = toMoney(r.gross_sales);
            const discount = toMoney(r.discount);
            const menuItemId = Number(r.menu_item_id);
            return {
                menu_item_id: menuItemId,
                name: (r.name as string | null) ?? 'Unknown item',
                category_id:
                    r.category_id == null ? null : Number(r.category_id),
                category_name: (r.category_name as string | null) ?? null,
                brand_id: r.brand_id == null ? null : Number(r.brand_id),
                brand_name: (r.brand_name as string | null) ?? null,
                branch_count: Number(r.branch_count ?? 0),
                branch_name: (r.branch_name as string | null) ?? null,
                quantity: Number(r.quantity ?? 0),
                orders: Number(r.orders ?? 0),
                gross_sales: gross,
                discount,
                discount_breakdown: breakdownOf(r, discount),
                net_sales: round2(gross - discount),
                children: childrenByItem.get(menuItemId) ?? [],
            };
        });

        const totals = rows.reduce(
            (acc, r) => {
                acc.quantity += r.quantity;
                acc.gross_sales += r.gross_sales;
                acc.discount += r.discount;
                acc.net_sales += r.net_sales;
                for (const stage of DISCOUNT_STAGES)
                    acc.discount_breakdown[stage.key] +=
                        r.discount_breakdown[stage.key];
                return acc;
            },
            {
                quantity: 0,
                orders: 0,
                gross_sales: 0,
                discount: 0,
                discount_breakdown: Object.fromEntries(
                    DISCOUNT_STAGES.map((s) => [s.key, 0]),
                ) as Breakdown,
                net_sales: 0,
            },
        );
        totals.gross_sales = round2(totals.gross_sales);
        totals.discount = round2(totals.discount);
        totals.net_sales = round2(totals.net_sales);
        for (const stage of DISCOUNT_STAGES)
            totals.discount_breakdown[stage.key] = round2(
                totals.discount_breakdown[stage.key],
            );
        // Order count is per-order, not per-line: summing the row counts would
        // count an order once for every distinct product on it.
        totals.orders = await scoped()
            .select('COUNT(DISTINCT o.id)', 'c')
            .getRawOne<{ c: string }>()
            .then((r) => Number(r?.c ?? 0));

        const sortBy = filters.sort_by ?? 'net_sales';
        const dir = filters.sort_dir === 'asc' ? 1 : -1;
        rows.sort((a, b) =>
            sortBy === 'name'
                ? a.name.localeCompare(b.name) * dir
                : (Number(a[sortBy]) - Number(b[sortBy])) * dir,
        );
        if (filters.limit && filters.limit > 0)
            rows = rows.slice(0, filters.limit);

        // Local components, not toISOString(): the range bounds are built on the
        // branch clock, and a UTC render would echo back the previous day.
        const localDay = (d: Date): string =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        return {
            split_by: splitBy,
            status: filters.status ?? 'completed',
            discount: isDiscountFilter(filters.discount)
                ? filters.discount
                : null,
            date_from: localDay(dateFrom),
            date_to: localDay(dateTo),
            totals,
            rows,
        };
    }

    /**
     * Order-wise trend feed: every order in the window as its own chart point
     * (newest `limit` fetched, served oldest→newest), plus UNCAPPED totals
     * covering the whole selection, not just the plotted tail. order_count is
     * all-status (matching the Total-orders KPI); completed_revenue is
     * completed-only (matching the Revenue KPI), so the headline figures
     * agree with the KPI tiles beside them.
     */
    async orderSeries(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            limit?: number;
            date_from?: string;
            date_to?: string;
            time_from?: string;
            time_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            filters.branch_id != null &&
            !allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const limit = Math.min(1000, Math.max(1, filters.limit ?? 200));
        const { dateFrom, dateTo } = this.resolveDayRange(filters);
        const scoped = () =>
            this.applyOrderScope(
                this.orderRepo
                    .createQueryBuilder('o')
                    .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                        dateFrom,
                        dateTo,
                    }),
                'o',
                tenantId,
                allowedBranchIds,
                filters.branch_id,
                allowedBrandIds,
                filters.brand_id,
            );
        const [totals, rows] = await Promise.all([
            scoped()
                .select('COUNT(*)', 'order_count')
                .addSelect(
                    "COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.totalAmount ELSE 0 END), 0)",
                    'completed_revenue',
                )
                .getRawOne<{
                    order_count: string;
                    completed_revenue: string;
                }>(),
            scoped()
                .leftJoin('o.brand', 'brand')
                .select('o.id', 'id')
                .addSelect('o.orderNumber', 'order_number')
                .addSelect('o.placedAt', 'placed_at')
                .addSelect('o.totalAmount', 'total_amount')
                .addSelect('o.status', 'status')
                .addSelect('o.orderType', 'order_type')
                .addSelect('o.brandId', 'brand_id')
                .addSelect('brand.name', 'brand_name')
                .orderBy('o.placedAt', 'DESC')
                .addOrderBy('o.id', 'DESC')
                .limit(limit)
                .getRawMany<{
                    id: number;
                    order_number: string;
                    placed_at: Date;
                    total_amount: string;
                    status: string;
                    order_type: string;
                    brand_id: number | null;
                    brand_name: string | null;
                }>(),
        ]);
        return {
            order_count: Number(totals?.order_count ?? 0),
            completed_revenue: Number(totals?.completed_revenue ?? 0),
            orders: rows
                .slice()
                .reverse()
                .map((r) => ({
                    order_number: r.order_number,
                    placed_at:
                        r.placed_at instanceof Date
                            ? r.placed_at.toISOString()
                            : String(r.placed_at),
                    total_amount: Number(r.total_amount),
                    status: r.status,
                    order_type: r.order_type,
                    brand_id: r.brand_id == null ? null : Number(r.brand_id),
                    brand_name: r.brand_name ?? null,
                })),
        };
    }

    async shiftSummary(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            date_from?: string;
            date_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            filters.branch_id != null &&
            !allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        const qb = this.shiftRepo
            .createQueryBuilder('s')
            .leftJoinAndSelect('s.branch', 'b')
            .leftJoinAndSelect('s.user', 'u')
            .leftJoinAndSelect('s.brand', 'shiftBrand')
            .innerJoin('s.branch', 'b')
            .innerJoin('b.branchBrands', 'bb')
            .innerJoin('bb.brand', 'br')
            .andWhere('s.openedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .orderBy('s.openedAt', 'DESC');
        if (tenantId != null)
            qb.andWhere('br.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            qb.andWhere('s.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            qb.andWhere('s.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        this.applyBrandScope(qb, 's', allowedBrandIds, filters.brand_id);

        const shiftsList = await qb.getMany();
        // Cash handed out of the till mid-shift (voided entries excluded). A
        // closed shift's expected_cash is already net of it; reporting the
        // figure separately keeps opening/closing/expected reconcilable.
        const cashOutByShift = new Map<number, number>();
        if (shiftsList.length > 0) {
            const rows = await this.shiftRepo.manager.query<
                { shift_id: number; total: string | null }[]
            >(
                `SELECT shift_id, COALESCE(SUM(amount), 0) AS total
                 FROM shift_cash_outs
                 WHERE shift_id = ANY($1::int[]) AND voided_at IS NULL
                 GROUP BY shift_id`,
                [shiftsList.map((s) => s.id)],
            );
            for (const r of rows)
                cashOutByShift.set(
                    Number(r.shift_id),
                    parseFloat(r.total ?? '0') || 0,
                );
        }
        return shiftsList.map((s) => {
            const sRel = s as typeof s & {
                branch?: { name: string };
                user?: { name: string };
            };
            return {
                id: s.id,
                branch_id: s.branchId,
                branch_name: sRel.branch?.name,
                brand_id: s.brandId ?? null,
                brand_name: s.brand?.name ?? null,
                user_name: sRel.user?.name,
                shift_number: s.shiftNumber,
                opening_cash: Number(s.openingCash),
                closing_cash:
                    s.closingCash != null ? Number(s.closingCash) : null,
                expected_cash:
                    s.expectedCash != null ? Number(s.expectedCash) : null,
                cash_out_total: cashOutByShift.get(s.id) ?? 0,
                status: s.status,
                opened_at: s.openedAt?.toISOString() ?? null,
                closed_at: s.closedAt?.toISOString() ?? null,
            };
        });
    }

    /**
     * Consolidated payload for the admin dashboard: KPIs (+ deltas vs the
     * previous equal-length window), order/payment breakdowns, a daily
     * time-series, top items, delivery ops and ratings. All aggregates run in
     * parallel and are scoped by tenant + branch allowlist.
     */
    /**
     * Where the discounts actually went: split by offer type, and — for the
     * bank-funded ones — by which card earned them.
     *
     * `cards` counts every completed order paid with a card, not just discounted
     * ones, so a card whose offer rarely triggers (min spend too high, window too
     * narrow) shows up as traffic with little discount rather than vanishing.
     */
    async discountsBreakdown(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            date_from?: string;
            date_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertBranchAccess(allowedBranchIds, filters.branch_id);
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const range = this.resolveDayRange(filters);

        const totals = await this.kpiAggregate(
            range,
            tenantId,
            allowedBranchIds,
            filters.branch_id,
            allowedBrandIds,
            filters.brand_id,
        );

        const cardsQb = this.orderRepo
            .createQueryBuilder('o')
            .innerJoin(BankCard, 'bc', 'bc.id = o.bankCardId')
            .where("o.status = 'completed'")
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', range)
            .andWhere('o.bankCardId IS NOT NULL')
            .select('bc.id', 'card_id')
            .addSelect('bc.name', 'card_name')
            .addSelect('bc.bank', 'bank')
            .addSelect('COUNT(*)', 'orders')
            .addSelect(
                'COUNT(*) FILTER (WHERE o.card_discount_amount > 0)',
                'discounted_orders',
            )
            .addSelect(
                'COALESCE(SUM(o.cardDiscountAmount), 0)',
                'total_discount',
            )
            .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'total_revenue')
            .groupBy('bc.id')
            .addGroupBy('bc.name')
            .addGroupBy('bc.bank')
            .orderBy('SUM(o.cardDiscountAmount)', 'DESC');
        this.applyOrderScope(
            cardsQb,
            'o',
            tenantId,
            allowedBranchIds,
            filters.branch_id,
            allowedBrandIds,
            filters.brand_id,
        );
        const cardRows =
            await cardsQb.getRawMany<Record<string, string | null>>();

        // Who granted staff discounts, and how much. Unlike every other stage
        // this one has a person behind it, so it is grouped by that person
        // rather than by offer — "Rs. 40k given away" is not actionable,
        // "Rs. 28k of it by one till" is.
        const staffQb = this.orderRepo
            .createQueryBuilder('o')
            .innerJoin(User, 'u', 'u.id = o.staffDiscountBy')
            .where("o.status = 'completed'")
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', range)
            .andWhere('o.staffDiscountAmount > 0')
            .select('u.id', 'user_id')
            .addSelect('u.name', 'user_name')
            .addSelect('COUNT(*)', 'orders')
            .addSelect(
                'COALESCE(SUM(o.staffDiscountAmount), 0)',
                'total_discount',
            )
            .addSelect('COALESCE(SUM(o.subtotal), 0)', 'total_subtotal')
            .addSelect('MAX(o.staffDiscountAmount)', 'largest_discount')
            .groupBy('u.id')
            .addGroupBy('u.name')
            .orderBy('SUM(o.staffDiscountAmount)', 'DESC');
        this.applyOrderScope(
            staffQb,
            'o',
            tenantId,
            allowedBranchIds,
            filters.branch_id,
            allowedBrandIds,
            filters.brand_id,
        );
        const staffRows =
            await staffQb.getRawMany<Record<string, string | null>>();

        // Which preset was used, so a well-named catalog ("10% – Long wait")
        // doubles as the reason breakdown. Presets deleted since are grouped
        // under a null id rather than dropped.
        const presetQb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoin(StaffDiscount, 'sd', 'sd.id = o.staffDiscountId')
            .where("o.status = 'completed'")
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', range)
            .andWhere('o.staffDiscountAmount > 0')
            .select('o.staffDiscountId', 'preset_id')
            .addSelect('sd.name', 'preset_name')
            .addSelect('o.staffDiscountType', 'preset_type')
            .addSelect('o.staffDiscountValue', 'preset_value')
            .addSelect('COUNT(*)', 'orders')
            .addSelect(
                'COALESCE(SUM(o.staffDiscountAmount), 0)',
                'total_discount',
            )
            .groupBy('o.staffDiscountId')
            .addGroupBy('sd.name')
            .addGroupBy('o.staffDiscountType')
            .addGroupBy('o.staffDiscountValue')
            .orderBy('SUM(o.staffDiscountAmount)', 'DESC');
        this.applyOrderScope(
            presetQb,
            'o',
            tenantId,
            allowedBranchIds,
            filters.branch_id,
            allowedBrandIds,
            filters.brand_id,
        );
        const presetRows =
            await presetQb.getRawMany<Record<string, string | null>>();

        const merchantFunded =
            totals.promo_discounts +
            totals.order_discounts +
            totals.coupon_discounts +
            totals.staff_discounts;
        return {
            date_from: range.dateFrom.toISOString(),
            date_to: range.dateTo.toISOString(),
            total_discounts: totals.total_discounts,
            /** Comes out of your own margin. */
            merchant_funded: merchantFunded,
            /** Funded by the bank, via a card offer. */
            bank_funded: totals.card_discounts,
            by_type: {
                product_promotion: totals.promo_discounts,
                discount: totals.order_discounts,
                coupon: totals.coupon_discounts,
                card: totals.card_discounts,
                staff_discount: totals.staff_discounts,
            },
            /** Staff give-aways by the person who granted them. */
            staff: staffRows.map((r) => {
                const orders = Number(r.orders ?? 0);
                const total = Number(r.total_discount ?? 0);
                const subtotal = Number(r.total_subtotal ?? 0);
                return {
                    user_id: Number(r.user_id),
                    user_name: r.user_name,
                    orders,
                    total_discount: total,
                    /** Discounted turnover, so the give-away has a denominator. */
                    total_subtotal: subtotal,
                    /** Average share of the bill given away, as a percentage. */
                    avg_percent:
                        subtotal > 0
                            ? Math.round((total / subtotal) * 10000) / 100
                            : 0,
                    largest_discount: Number(r.largest_discount ?? 0),
                };
            }),
            /** Staff give-aways by preset — the "why", when presets are named for it. */
            staff_by_preset: presetRows.map((r) => ({
                preset_id: r.preset_id != null ? Number(r.preset_id) : null,
                /** Null once the preset is deleted; the snapshot below survives. */
                preset_name: r.preset_name,
                preset_type: r.preset_type,
                preset_value:
                    r.preset_value != null ? Number(r.preset_value) : null,
                orders: Number(r.orders ?? 0),
                total_discount: Number(r.total_discount ?? 0),
            })),
            cards: cardRows.map((r) => {
                const orders = Number(r.orders ?? 0);
                const discounted = Number(r.discounted_orders ?? 0);
                return {
                    card_id: Number(r.card_id),
                    card_name: r.card_name,
                    bank: r.bank,
                    orders,
                    discounted_orders: discounted,
                    /** Paid with the card but earned nothing from its offer. */
                    missed_orders: orders - discounted,
                    total_discount: Number(r.total_discount ?? 0),
                    total_revenue: Number(r.total_revenue ?? 0),
                };
            }),
        };
    }

    async dashboardSummary(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            date_from?: string;
            date_to?: string;
            /** 'HH:mm' in branch-local time; omitted = whole day. */
            time_from?: string;
            time_to?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertBranchAccess(allowedBranchIds, filters.branch_id);
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const branchId = filters.branch_id;
        const brandId = filters.brand_id;
        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        // Previous window of equal length, ending the day before this one.
        const spanMs = dateTo.getTime() - dateFrom.getTime();
        const prevTo = new Date(dateFrom.getTime() - 1);
        const prevFrom = new Date(prevTo.getTime() - spanMs);

        const scope = (qb: SelectQueryBuilder<Order>) =>
            this.applyOrderScope(
                qb,
                'o',
                tenantId,
                allowedBranchIds,
                branchId,
                allowedBrandIds,
                brandId,
            );

        // 1. KPI aggregate (current) + previous-period aggregate for deltas
        const kpiCurrentP = this.kpiAggregate(
            { dateFrom, dateTo },
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        );
        const kpiPrevP = this.kpiAggregate(
            { dateFrom: prevFrom, dateTo: prevTo },
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        );

        // 1b. Per-brand sales breakdown (orders are single-brand): the owner
        // sees what each brand is selling; brand-locked users see their own.
        const salesByBrandP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .innerJoin('o.brand', 'sbb')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('o.brandId', 'brand_id')
                .addSelect('MAX(sbb.name)', 'brand_name')
                .addSelect('COUNT(*)', 'orders')
                .addSelect(
                    "SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END)",
                    'completed_orders',
                )
                .addSelect(
                    "COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.totalAmount ELSE 0 END), 0)",
                    'revenue',
                )
                .groupBy('o.brandId')
                .orderBy('revenue', 'DESC'),
        ).getRawMany<{
            brand_id: number;
            brand_name: string;
            orders: string;
            completed_orders: string;
            revenue: string;
        }>();

        // 1c. Per-branch sales breakdown: used by brand-specific dashboards
        // (one brand across multiple branches) in place of the per-brand table.
        const salesByBranchP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .innerJoin('o.branch', 'sbr')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('o.branchId', 'branch_id')
                .addSelect('MAX(sbr.name)', 'branch_name')
                .addSelect('COUNT(*)', 'orders')
                .addSelect(
                    "SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END)",
                    'completed_orders',
                )
                .addSelect(
                    "COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.totalAmount ELSE 0 END), 0)",
                    'revenue',
                )
                .groupBy('o.branchId')
                .orderBy('revenue', 'DESC'),
        ).getRawMany<{
            branch_id: number;
            branch_name: string;
            orders: string;
            completed_orders: string;
            revenue: string;
        }>();

        // 2. Orders by status (all statuses, in range)
        const ordersByStatusP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('o.status', 'status')
                .addSelect('COUNT(*)', 'count')
                .groupBy('o.status'),
        ).getRawMany<{ status: string; count: string }>();

        // 3. Orders by type
        const ordersByTypeP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('o.orderType', 'type')
                .addSelect('COUNT(*)', 'count')
                .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'revenue')
                .groupBy('o.orderType'),
        ).getRawMany<{ type: string; count: string; revenue: string }>();

        // 4. Orders by source
        const ordersBySourceP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('o.source', 'source')
                .addSelect('COUNT(*)', 'count')
                .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'revenue')
                .groupBy('o.source'),
        ).getRawMany<{ source: string; count: string; revenue: string }>();

        // 5. Payments by method (completed orders, completedAt in range)
        const paymentsByMethodP = this.applyOrderScope(
            this.paymentRepo
                .createQueryBuilder('p')
                .innerJoin(Order, 'o', 'o.id = p.orderId')
                .andWhere("o.status = 'completed'")
                .andWhere('o.completedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('p.paymentMethod', 'method')
                .addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
                .addSelect('COUNT(*)', 'count')
                .groupBy('p.paymentMethod'),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawMany<{ method: string; amount: string; count: string }>();

        // 6. Daily time-series
        const timeSeriesP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select("TO_CHAR(o.placedAt, 'YYYY-MM-DD')", 'day')
                .addSelect('COUNT(*)', 'orders')
                .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'revenue')
                .addSelect(
                    "COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.totalAmount ELSE 0 END), 0)",
                    'completed_revenue',
                )
                .addSelect(
                    "SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END)",
                    'completed_orders',
                )
                .groupBy("TO_CHAR(o.placedAt, 'YYYY-MM-DD')")
                .orderBy('day', 'ASC'),
        ).getRawMany<{
            day: string;
            orders: string;
            revenue: string;
            completed_revenue: string;
            completed_orders: string;
        }>();

        // 7. Top items (completed orders, by quantity)
        const topItemsP = this.applyOrderScope(
            this.orderItemRepo
                .createQueryBuilder('oi')
                .innerJoin('oi.order', 'o')
                .leftJoin('oi.menuItem', 'mi')
                .andWhere("o.status = 'completed'")
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('oi.menuItemId', 'menu_item_id')
                .addSelect('MAX(COALESCE(mi.name, oi.nameSnapshot))', 'name')
                .addSelect('SUM(oi.quantity)', 'quantity')
                .addSelect('SUM(oi.subtotal)', 'total_revenue')
                .groupBy('oi.menuItemId')
                .orderBy('SUM(oi.quantity)', 'DESC')
                .limit(10),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawMany<{
            menu_item_id: number;
            name: string;
            quantity: string;
            total_revenue: string;
        }>();

        // 8. Delivery ops: counts by delivery status (delivery orders in range)
        const deliveryByStatusP = scope(
            this.orderRepo
                .createQueryBuilder('o')
                .andWhere("o.orderType = 'delivery'")
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select("COALESCE(o.deliveryStatus, 'unassigned')", 'status')
                .addSelect('COUNT(*)', 'count')
                .groupBy("COALESCE(o.deliveryStatus, 'unassigned')"),
        ).getRawMany<{ status: string; count: string }>();

        // 8b. Live rider presence (a "now" snapshot, not date filtered)
        const presenceQb = this.riderPresenceRepo
            .createQueryBuilder('rp')
            .select('COUNT(*) FILTER (WHERE rp.isCheckedIn = true)', 'active')
            .addSelect('COUNT(*) FILTER (WHERE rp.isPaused = true)', 'paused');
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            presenceQb.andWhere('rp.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (branchId)
            presenceQb.andWhere('rp.branchId = :branchId', { branchId });
        const presenceP = presenceQb.getRawOne<{
            active: string;
            paused: string;
        }>();

        // 9. Ratings (scoped via the joined order)
        const brandAvgP = this.applyOrderScope(
            this.brandRatingRepo
                .createQueryBuilder('r')
                .innerJoin(Order, 'o', 'o.id = r.orderId')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('AVG(r.stars)', 'avg')
                .addSelect('COUNT(*)', 'count'),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawOne<{ avg: string | null; count: string }>();

        const riderAvgP = this.applyOrderScope(
            this.riderRatingRepo
                .createQueryBuilder('r')
                .innerJoin(Order, 'o', 'o.id = r.orderId')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('AVG(r.stars)', 'avg')
                .addSelect('COUNT(*)', 'count'),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawOne<{ avg: string | null; count: string }>();

        // Per-brand rating breakdown (brand ratings are scoped to each brand).
        const brandByP = this.applyOrderScope(
            this.brandRatingRepo
                .createQueryBuilder('r')
                .innerJoin(Order, 'o', 'o.id = r.orderId')
                .innerJoin('brands', 'b', 'b.id = r.brandId')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('r.brandId', 'id')
                .addSelect('MAX(b.name)', 'name')
                .addSelect('AVG(r.stars)', 'avg')
                .addSelect('COUNT(*)', 'count')
                .groupBy('r.brandId')
                .orderBy('AVG(r.stars)', 'DESC'),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawMany<{
            id: number;
            name: string;
            avg: string;
            count: string;
        }>();

        // Per-rider rating breakdown (rider ratings are per individual rider).
        const riderByP = this.applyOrderScope(
            this.riderRatingRepo
                .createQueryBuilder('r')
                .innerJoin(Order, 'o', 'o.id = r.orderId')
                .innerJoin('users', 'u', 'u.id = r.riderUserId')
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('r.riderUserId', 'id')
                .addSelect('MAX(u.name)', 'name')
                .addSelect('AVG(r.stars)', 'avg')
                .addSelect('COUNT(*)', 'count')
                .groupBy('r.riderUserId')
                .orderBy('AVG(r.stars)', 'DESC'),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawMany<{
            id: number;
            name: string;
            avg: string;
            count: string;
        }>();

        const brandCommentsP = this.applyOrderScope(
            this.brandRatingRepo
                .createQueryBuilder('r')
                .innerJoin(Order, 'o', 'o.id = r.orderId')
                .andWhere('r.comment IS NOT NULL')
                .andWhere("r.comment <> ''")
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('r.stars', 'stars')
                .addSelect('r.comment', 'comment')
                .addSelect('r.createdAt', 'created_at')
                .orderBy('r.createdAt', 'DESC')
                .limit(5),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawMany<{ stars: number; comment: string; created_at: Date }>();

        const riderCommentsP = this.applyOrderScope(
            this.riderRatingRepo
                .createQueryBuilder('r')
                .innerJoin(Order, 'o', 'o.id = r.orderId')
                .andWhere('r.comment IS NOT NULL')
                .andWhere("r.comment <> ''")
                .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                    dateFrom,
                    dateTo,
                })
                .select('r.stars', 'stars')
                .addSelect('r.comment', 'comment')
                .addSelect('r.createdAt', 'created_at')
                .orderBy('r.createdAt', 'DESC')
                .limit(5),
            'o',
            tenantId,
            allowedBranchIds,
            branchId,
            allowedBrandIds,
            brandId,
        ).getRawMany<{ stars: number; comment: string; created_at: Date }>();

        const [
            kpiCurrent,
            kpiPrev,
            salesByBrandRaw,
            salesByBranchRaw,
            ordersByStatusRaw,
            ordersByTypeRaw,
            ordersBySourceRaw,
            paymentsByMethodRaw,
            timeSeriesRaw,
            topItemsRaw,
            deliveryByStatusRaw,
            presence,
            brandAvg,
            riderAvg,
            brandBy,
            riderBy,
            brandComments,
            riderComments,
        ] = await Promise.all([
            kpiCurrentP,
            kpiPrevP,
            salesByBrandP,
            salesByBranchP,
            ordersByStatusP,
            ordersByTypeP,
            ordersBySourceP,
            paymentsByMethodP,
            timeSeriesP,
            topItemsP,
            deliveryByStatusP,
            presenceP,
            brandAvgP,
            riderAvgP,
            brandByP,
            riderByP,
            brandCommentsP,
            riderCommentsP,
        ]);

        const orders_by_status = ordersByStatusRaw.map((r) => ({
            status: r.status,
            count: Number(r.count),
        }));
        const totalOrders = orders_by_status.reduce((s, r) => s + r.count, 0);

        // Dense, zero-filled daily series for a continuous chart axis. Iterate
        // in UTC over calendar-date strings so the keys line up exactly with
        // the SQL TO_CHAR(...) day strings (no local-vs-UTC drift).
        const seriesMap = new Map(timeSeriesRaw.map((r) => [r.day, r]));
        const time_series: Array<{
            day: string;
            orders: number;
            revenue: number;
            completed_revenue: number;
            completed_orders: number;
        }> = [];
        const startDayStr = filters.date_from ?? this.formatDay(dateFrom);
        const lastDay = filters.date_to ?? this.formatDay(dateTo);
        const cursor = new Date(`${startDayStr}T00:00:00.000Z`);
        // Cap the fill to avoid pathological ranges.
        for (let i = 0; i < 400; i++) {
            const day = cursor.toISOString().slice(0, 10);
            const row = seriesMap.get(day);
            time_series.push({
                day,
                orders: Number(row?.orders ?? 0),
                revenue: Number(row?.revenue ?? 0),
                completed_revenue: Number(row?.completed_revenue ?? 0),
                completed_orders: Number(row?.completed_orders ?? 0),
            });
            if (day === lastDay) break;
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        const recent_comments = [
            ...brandComments.map((c) => ({
                type: 'brand' as const,
                stars: Number(c.stars),
                comment: c.comment,
                created_at:
                    c.created_at instanceof Date
                        ? c.created_at.toISOString()
                        : String(c.created_at),
            })),
            ...riderComments.map((c) => ({
                type: 'rider' as const,
                stars: Number(c.stars),
                comment: c.comment,
                created_at:
                    c.created_at instanceof Date
                        ? c.created_at.toISOString()
                        : String(c.created_at),
            })),
        ]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 5);

        const avgBrand = brandAvg?.avg != null ? Number(brandAvg.avg) : null;
        const avgRider = riderAvg?.avg != null ? Number(riderAvg.avg) : null;
        const activeRiders = Number(presence?.active ?? 0);

        return {
            date_from: filters.date_from ?? this.formatDay(dateFrom),
            date_to: filters.date_to ?? this.formatDay(dateTo),
            branch_id: branchId ?? null,
            brand_id: brandId ?? null,
            sales_by_brand: salesByBrandRaw.map((r) => ({
                brand_id: r.brand_id,
                brand_name: r.brand_name,
                orders: Number(r.orders),
                completed_orders: Number(r.completed_orders),
                revenue: Number(r.revenue),
            })),
            sales_by_branch: salesByBranchRaw.map((r) => ({
                branch_id: r.branch_id,
                branch_name: r.branch_name,
                orders: Number(r.orders),
                completed_orders: Number(r.completed_orders),
                revenue: Number(r.revenue),
            })),
            kpis: {
                total_revenue: kpiCurrent.total_revenue,
                completed_orders: kpiCurrent.completed_orders,
                total_orders: totalOrders,
                average_order_value: kpiCurrent.completed_orders
                    ? kpiCurrent.total_revenue / kpiCurrent.completed_orders
                    : 0,
                completion_rate: totalOrders
                    ? kpiCurrent.completed_orders / totalOrders
                    : 0,
                total_discounts: kpiCurrent.total_discounts,
                /**
                 * The split behind total_discounts. `card` is funded by the bank;
                 * the other three come out of the merchant's own margin.
                 */
                discount_breakdown: {
                    product_promotion: kpiCurrent.promo_discounts,
                    discount: kpiCurrent.order_discounts,
                    coupon: kpiCurrent.coupon_discounts,
                    card: kpiCurrent.card_discounts,
                    staff_discount: kpiCurrent.staff_discounts,
                    merchant_funded:
                        kpiCurrent.promo_discounts +
                        kpiCurrent.order_discounts +
                        kpiCurrent.coupon_discounts +
                        kpiCurrent.staff_discounts,
                    bank_funded: kpiCurrent.card_discounts,
                },
                total_tax: kpiCurrent.total_tax,
                total_service_charge: kpiCurrent.total_service_charge,
                total_delivery_fee: kpiCurrent.total_delivery_fee,
                active_riders: activeRiders,
                avg_brand_rating: avgBrand,
                avg_rider_rating: avgRider,
            },
            deltas: {
                revenue_pct: this.pctDelta(
                    kpiCurrent.total_revenue,
                    kpiPrev.total_revenue,
                ),
                orders_pct: this.pctDelta(
                    kpiCurrent.completed_orders,
                    kpiPrev.completed_orders,
                ),
                aov_pct: this.pctDelta(
                    kpiCurrent.completed_orders
                        ? kpiCurrent.total_revenue / kpiCurrent.completed_orders
                        : 0,
                    kpiPrev.completed_orders
                        ? kpiPrev.total_revenue / kpiPrev.completed_orders
                        : 0,
                ),
            },
            orders_by_status,
            orders_by_type: ordersByTypeRaw.map((r) => ({
                type: r.type,
                count: Number(r.count),
                revenue: Number(r.revenue),
            })),
            orders_by_source: ordersBySourceRaw.map((r) => ({
                source: r.source,
                count: Number(r.count),
                revenue: Number(r.revenue),
            })),
            payments_by_method: paymentsByMethodRaw.map((r) => ({
                method: r.method,
                amount: Number(r.amount),
                count: Number(r.count),
            })),
            time_series,
            top_items: topItemsRaw.map((r) => ({
                menu_item_id: r.menu_item_id,
                name: r.name,
                quantity: Number(r.quantity),
                total_revenue: Number(r.total_revenue),
            })),
            delivery: {
                by_status: deliveryByStatusRaw.map((r) => ({
                    status: r.status,
                    count: Number(r.count),
                })),
                active_riders: activeRiders,
                paused_riders: Number(presence?.paused ?? 0),
            },
            ratings: {
                avg_brand: avgBrand,
                brand_count: Number(brandAvg?.count ?? 0),
                avg_rider: avgRider,
                rider_count: Number(riderAvg?.count ?? 0),
                by_brand: brandBy.map((r) => ({
                    id: r.id,
                    name: r.name,
                    avg: Number(r.avg),
                    count: Number(r.count),
                })),
                by_rider: riderBy.map((r) => ({
                    id: r.id,
                    name: r.name,
                    avg: Number(r.avg),
                    count: Number(r.count),
                })),
                recent_comments,
            },
        };
    }

    /** Most recent orders in the range (feed for the dashboard). */
    async recentOrders(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            date_from?: string;
            date_to?: string;
            /** 'HH:mm' in branch-local time; omitted = whole day. */
            time_from?: string;
            time_to?: string;
            limit?: number;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertBranchAccess(allowedBranchIds, filters.branch_id);
        this.assertBrandAccess(allowedBrandIds, filters.brand_id);
        const { dateFrom, dateTo } = this.resolveDayRange(filters);
        const limit = filters.limit ?? 15;

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('o.id', 'id')
            .addSelect('o.orderNumber', 'order_number')
            .addSelect('o.orderType', 'order_type')
            .addSelect('o.source', 'source')
            .addSelect('o.status', 'status')
            .addSelect('o.deliveryStatus', 'delivery_status')
            .addSelect('o.totalAmount', 'total_amount')
            .addSelect('o.customerName', 'customer_name')
            .addSelect('o.placedAt', 'placed_at')
            .orderBy('o.placedAt', 'DESC')
            .limit(limit);
        this.applyOrderScope(
            qb,
            'o',
            tenantId,
            allowedBranchIds,
            filters.branch_id,
            allowedBrandIds,
            filters.brand_id,
        );
        const rows = await qb.getRawMany<{
            id: number;
            order_number: string;
            order_type: string;
            source: string;
            status: string;
            delivery_status: string | null;
            total_amount: string;
            customer_name: string | null;
            placed_at: Date;
        }>();
        return rows.map((r) => ({
            id: r.id,
            order_number: r.order_number,
            order_type: r.order_type,
            source: r.source,
            status: r.status,
            delivery_status: r.delivery_status,
            total_amount: Number(r.total_amount),
            customer_name: r.customer_name,
            placed_at:
                r.placed_at instanceof Date
                    ? r.placed_at.toISOString()
                    : String(r.placed_at),
        }));
    }

    /** Low-stock items (vs effective reorder point) and recent wastage. */
    async inventoryAlerts(
        tenantId: number | null,
        filters: { branch_id?: number; date_from?: string; date_to?: string },
        allowedBranchIds?: number[] | null,
    ) {
        this.assertBranchAccess(allowedBranchIds, filters.branch_id);
        const { dateFrom, dateTo } = this.resolveDayRange(filters);
        const branchId = filters.branch_id;

        // Low stock: total on-hand (summed across locations) per item+branch
        // is at/under the effective reorder point (branch override, else item
        // default). Only items that have a reorder point defined.
        const effectiveReorder =
            'MAX(COALESCE(s.reorderPoint, it.defaultReorderPoint))';
        const lowQb = this.inventoryOnHandRepo
            .createQueryBuilder('ioh')
            .innerJoin('inventory_items', 'it', 'it.id = ioh.inventoryItemId')
            .leftJoin(
                'inventory_item_branch_settings',
                's',
                's.inventoryItemId = ioh.inventoryItemId AND s.branchId = ioh.branchId AND s.tenantId = ioh.tenantId',
            )
            .select('ioh.inventoryItemId', 'item_id')
            .addSelect('MAX(it.name)', 'name')
            .addSelect('ioh.branchId', 'branch_id')
            .addSelect('SUM(ioh.qty)', 'qty')
            .addSelect(effectiveReorder, 'reorder_point')
            .groupBy('ioh.inventoryItemId')
            .addGroupBy('ioh.branchId')
            .having(`${effectiveReorder} IS NOT NULL`)
            .andHaving(`SUM(ioh.qty) <= ${effectiveReorder}`)
            .orderBy(`${effectiveReorder} - SUM(ioh.qty)`, 'DESC')
            .limit(10);
        if (tenantId != null)
            lowQb.andWhere('ioh.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            lowQb.andWhere('ioh.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (branchId) lowQb.andWhere('ioh.branchId = :branchId', { branchId });

        const wasteQb = this.wastageRepo
            .createQueryBuilder('w')
            .innerJoin('inventory_items', 'it', 'it.id = w.inventoryItemId')
            .andWhere('w.createdAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            })
            .select('w.inventoryItemId', 'item_id')
            .addSelect('it.name', 'name')
            .addSelect('w.qty', 'qty')
            .addSelect('w.reason', 'reason')
            .addSelect('w.createdAt', 'created_at')
            .orderBy('w.createdAt', 'DESC')
            .limit(10);
        if (tenantId != null)
            wasteQb.andWhere('w.tenantId = :tenantId', { tenantId });
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            wasteQb.andWhere('w.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (branchId) wasteQb.andWhere('w.branchId = :branchId', { branchId });

        const [lowRaw, wasteRaw] = await Promise.all([
            lowQb.getRawMany<{
                item_id: number;
                name: string;
                branch_id: number;
                qty: string;
                reorder_point: string;
            }>(),
            wasteQb.getRawMany<{
                item_id: number;
                name: string;
                qty: string;
                reason: string;
                created_at: Date;
            }>(),
        ]);

        return {
            low_stock: lowRaw.map((r) => ({
                item_id: r.item_id,
                name: r.name,
                branch_id: r.branch_id,
                qty: Number(r.qty),
                reorder_point: Number(r.reorder_point),
            })),
            recent_wastage: wasteRaw.map((r) => ({
                item_id: r.item_id,
                name: r.name,
                qty: Number(r.qty),
                reason: r.reason,
                created_at:
                    r.created_at instanceof Date
                        ? r.created_at.toISOString()
                        : String(r.created_at),
            })),
        };
    }
}
