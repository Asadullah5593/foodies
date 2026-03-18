import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { ShiftsService } from '../shifts/shifts.service';

/** Statuses shown on KDS (includes 'placed' so new orders appear immediately). */
const KITCHEN_STATUSES = [
    'placed',
    'accepted',
    'preparing',
    'ready',
    'completed',
];

@Injectable()
export class KitchenService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        private shiftsService: ShiftsService,
    ) {}

    async listOrders(
        branchId: number,
        filters: {
            station_id?: number;
            status?: string;
            category_id?: number;
            /** When set, only orders for this brand (for back kitchen brand-specific view). */
            brand_id?: number;
            /** Date filter (YYYY-MM-DD), inclusive. */
            date_from?: string;
            /** Date filter (YYYY-MM-DD), inclusive. */
            date_to?: string;
            /** When true, include completed orders in the list. */
            include_completed?: boolean;
        },
    ) {
        const includeCompleted =
            filters.include_completed === true || filters.status === 'completed';
        const statuses = includeCompleted
            ? KITCHEN_STATUSES
            : KITCHEN_STATUSES.filter((s) => s !== 'completed');

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.orderItems', 'oi')
            .leftJoinAndSelect('oi.menuItem', 'mi')
            .leftJoinAndSelect('mi.brand', 'miBrand')
            .leftJoinAndSelect('mi.category', 'cat')
            .leftJoinAndSelect('oi.addons', 'oa')
            .leftJoinAndSelect('oa.addon', 'a')
            .leftJoinAndSelect('oi.variant', 'v')
            .where('o.branchId = :branchId', { branchId })
            .andWhere('o.status IN (:...statuses)', {
                statuses,
            })
            // Queue order: oldest first, new orders append to end.
            .orderBy('o.placedAt', 'ASC')
            .addOrderBy('o.id', 'ASC');
        if (filters.status) {
            qb.andWhere('o.status = :status', { status: filters.status });
        }
        if (filters.date_from) {
            qb.andWhere('date(o.placedAt) >= :dateFrom', {
                dateFrom: filters.date_from,
            });
        }
        if (filters.date_to) {
            qb.andWhere('date(o.placedAt) <= :dateTo', {
                dateTo: filters.date_to,
            });
        }
        if (filters.category_id) {
            qb.andWhere('mi.categoryId = :categoryId', {
                categoryId: filters.category_id,
            });
        }
        if (filters.brand_id != null) {
            qb.andWhere('o.brandId = :brandId', {
                brandId: filters.brand_id,
            });
        }
        const orders = await qb.getMany();
        return orders.map((o) => this.toKitchenOrder(o));
    }

    async getOrder(id: number, branchId: number) {
        const order = await this.orderRepo.findOne({
            where: { id, branchId },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.brand',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        return this.toKitchenOrder(order);
    }

    async updateStatus(id: number, branchId: number, status: string) {
        if (!KITCHEN_STATUSES.includes(status)) {
            throw new ForbiddenException(
                `Invalid kitchen status: ${status}. Use: accepted, preparing, ready, completed`,
            );
        }
        const order = await this.orderRepo.findOne({ where: { id, branchId } });
        if (!order) throw new NotFoundException('Order not found');
        order.status = status;
        if (status === 'completed') {
            order.completedAt = new Date();
            await this.orderRepo.save(order);
            await this.shiftsService.addCompletedOrderAmount(
                branchId,
                Number(order.totalAmount),
            );
        } else {
            await this.orderRepo.save(order);
        }
        return this.getOrder(id, branchId);
    }

    async getKotPayload(id: number, branchId: number) {
        const order = await this.orderRepo.findOne({
            where: { id, branchId },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.brand',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        type OI = (typeof order.orderItems)[0] & { menuItem?: { name: string; brand?: { name: string } } };
        return {
            order_number: order.orderNumber,
            order_type: order.orderType,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            delivery_address: order.deliveryAddress,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => {
                    const mi = (oi as OI).menuItem;
                    return {
                        name: oi.nameSnapshot ?? oi.menuItem?.name,
                        quantity: oi.quantity,
                        price:
                            oi.priceSnapshot != null
                                ? Number(oi.priceSnapshot)
                                : Number(oi.unitPrice),
                        notes: oi.notes,
                        variant_name: oi.variant?.name ?? null,
                        brand_name: mi?.brand?.name ?? null,
                        addons:
                            oi.addons
                                ?.map((a) => ({
                                    name: a.addon?.name ?? '',
                                    quantity: a.quantity ?? 1,
                                }))
                                .filter((a) => a.name) ?? [],
                    };
                }) ?? [],
        };
    }

    private toKitchenOrder(order: Order) {
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_group_id: order.orderGroupId ?? null,
            brand_id: order.brandId ?? null,
            order_type: order.orderType,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            status: order.status,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => {
                    type OI = typeof oi & {
                        menuItem?: { name: string; brand?: { name: string } };
                        variant?: { name: string };
                        addons?: Array<{
                            addon?: { name: string };
                            quantity?: number;
                        }>;
                    };
                    const o = oi as OI;
                    return {
                        id: oi.id,
                        name: oi.nameSnapshot ?? o.menuItem?.name,
                        quantity: oi.quantity,
                        notes: oi.notes,
                        variant_name: o.variant?.name ?? null,
                        brand_name: o.menuItem?.brand?.name ?? null,
                        addons:
                            o.addons
                                ?.map((a) => ({
                                    name: a.addon?.name ?? '',
                                    quantity: a.quantity ?? 1,
                                }))
                                .filter((a) => a.name) ?? [],
                    };
                }) ?? [],
        };
    }
}
