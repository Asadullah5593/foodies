import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Shift } from '../entities/shift.entity';

@Injectable()
export class ReportsService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem)
        private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(Shift) private shiftRepo: Repository<Shift>,
    ) {}

    async salesSummary(
        tenantId: number | null,
        filters: { branch_id?: number; date_from?: string; date_to?: string },
    ) {
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

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .where('o.status = :status', { status: 'completed' })
            .andWhere('o.placedAt BETWEEN :dateFrom AND :dateTo', {
                dateFrom,
                dateTo,
            });
        if (tenantId != null)
            qb.andWhere('o.tenantId = :tenantId', { tenantId });
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
    ) {
        const limit = filters.limit ?? 10;
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
        if (filters.branch_id)
            qb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });

        return qb.getRawMany();
    }

    async shiftSummary(
        tenantId: number | null,
        filters: { branch_id?: number; date_from?: string; date_to?: string },
    ) {
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
