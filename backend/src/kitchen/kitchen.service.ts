import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { ShiftsService } from '../shifts/shifts.service';

/** Statuses shown on KDS (includes 'placed' so new orders appear immediately). Queue order: newest first (placedAt DESC). */
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
        filters: { station_id?: number; status?: string; category_id?: number },
    ) {
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.orderItems', 'oi')
            .leftJoinAndSelect('oi.menuItem', 'mi')
            .leftJoinAndSelect('mi.category', 'cat')
            .leftJoinAndSelect('oi.addons', 'oa')
            .leftJoinAndSelect('oa.addon', 'a')
            .leftJoinAndSelect('oi.variant', 'v')
            .where('o.branchId = :branchId', { branchId })
            .andWhere('o.status IN (:...statuses)', {
                statuses: KITCHEN_STATUSES,
            })
            .orderBy('o.placedAt', 'DESC')
            .addOrderBy('o.id', 'DESC');
        if (filters.status) {
            qb.andWhere('o.status = :status', { status: filters.status });
        }
        if (filters.category_id) {
            qb.andWhere('mi.categoryId = :categoryId', {
                categoryId: filters.category_id,
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
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        return {
            order_number: order.orderNumber,
            order_type: order.orderType,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            delivery_address: order.deliveryAddress,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    name: oi.nameSnapshot ?? oi.menuItem?.name,
                    quantity: oi.quantity,
                    price:
                        oi.priceSnapshot != null
                            ? Number(oi.priceSnapshot)
                            : Number(oi.unitPrice),
                    notes: oi.notes,
                    variant_name: oi.variant?.name ?? null,
                    addons:
                        oi.addons
                            ?.map((a) => ({
                                name: a.addon?.name ?? '',
                                quantity: a.quantity ?? 1,
                            }))
                            .filter((a) => a.name) ?? [],
                })) ?? [],
        };
    }

    private toKitchenOrder(order: Order) {
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_type: order.orderType,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            status: order.status,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => {
                    type OI = typeof oi & {
                        menuItem?: { name: string };
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
