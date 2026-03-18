import {
    Injectable,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Shift } from '../entities/shift.entity';
import { Payment } from '../entities/payment.entity';

@Injectable()
export class ReportsService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem)
        private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(Shift) private shiftRepo: Repository<Shift>,
        @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    ) {}

    private resolveDayRange(filters: {
        date_from?: string;
        date_to?: string;
    }): { dateFrom: Date; dateTo: Date } {
        const dateFrom = filters.date_from
            ? new Date(filters.date_from)
            : new Date(new Date().setHours(0, 0, 0, 0));
        let dateTo: Date;
        if (filters.date_to) {
            dateTo = new Date(filters.date_to);
            dateTo.setHours(23, 59, 59, 999);
        } else {
            dateTo = new Date();
            dateTo.setHours(23, 59, 59, 999);
        }
        return { dateFrom, dateTo };
    }

    async dayOverview(
        tenantId: number | null,
        filters: { branch_id?: number; date_from?: string; date_to?: string },
        allowedBranchIds?: number[] | null,
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
            paymentsByMethodQb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (filters.branch_id)
            paymentsByMethodQb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
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
            date_to:
                filters.date_to ?? new Date().toISOString().slice(0, 10),
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
        filters: { branch_id?: number; date_from?: string; date_to?: string },
        allowedBranchIds?: number[] | null,
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
            limit?: number;
            date_from?: string;
            date_to?: string;
        },
        allowedBranchIds?: number[] | null,
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

        return qb.getRawMany();
    }

    async shiftSummary(
        tenantId: number | null,
        filters: { branch_id?: number; date_from?: string; date_to?: string },
        allowedBranchIds?: number[] | null,
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
        const { dateFrom, dateTo } = this.resolveDayRange(filters);

        const qb = this.shiftRepo
            .createQueryBuilder('s')
            .leftJoinAndSelect('s.branch', 'b')
            .leftJoinAndSelect('s.user', 'u')
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

        const shiftsList = await qb.getMany();
        return shiftsList.map((s) => {
            const sRel = s as typeof s & {
                branch?: { name: string };
                user?: { name: string };
            };
            return {
                id: s.id,
                branch_id: s.branchId,
                branch_name: sRel.branch?.name,
                user_name: sRel.user?.name,
                shift_number: s.shiftNumber,
                opening_cash: Number(s.openingCash),
                closing_cash:
                    s.closingCash != null ? Number(s.closingCash) : null,
                expected_cash:
                    s.expectedCash != null ? Number(s.expectedCash) : null,
                status: s.status,
                opened_at: s.openedAt?.toISOString() ?? null,
                closed_at: s.closedAt?.toISOString() ?? null,
            };
        });
    }
}
