import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { transitionStatus, raw } from '../common/db-concurrency';
import { Order } from '../entities/order.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { OrdersService } from '../orders/orders.service';
import { PushNotificationService } from '../push-notifications/push-notification.service';

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
        private dataSource: DataSource,
        private shiftsService: ShiftsService,
        private ordersService: OrdersService,
        private pushNotificationService: PushNotificationService,
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
        /** Brand lock of the requesting user (null = unrestricted). Enforced server-side. */
        allowedBrandIds: number[] | null = null,
    ) {
        if (
            allowedBrandIds != null &&
            filters.brand_id != null &&
            !allowedBrandIds.includes(filters.brand_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        const includeCompleted =
            filters.include_completed === true ||
            filters.status === 'completed';
        const statuses = includeCompleted
            ? KITCHEN_STATUSES
            : KITCHEN_STATUSES.filter((s) => s !== 'completed');

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.rider', 'rider')
            .leftJoinAndSelect('o.orderItems', 'oi')
            .leftJoinAndSelect('oi.menuItem', 'mi')
            .leftJoinAndSelect('mi.brand', 'miBrand')
            .leftJoinAndSelect('mi.category', 'cat')
            .leftJoinAndSelect('oi.addons', 'oa')
            .leftJoinAndSelect('oa.addon', 'a')
            .leftJoinAndSelect('oi.modifiers', 'om')
            .leftJoinAndSelect('om.modifier', 'omod')
            .leftJoinAndSelect('omod.modifierGroup', 'omg')
            .leftJoinAndSelect('oi.variant', 'v')
            .leftJoinAndSelect('oi.dealMenuItem', 'odeal')
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
        } else if (allowedBrandIds != null) {
            // Brand-locked staff only ever see their own brand's tickets,
            // even when the client omits the brand_id filter.
            qb.andWhere('o.brandId IN (:...allowedBrandIds)', {
                allowedBrandIds,
            });
        }
        const orders = await qb.getMany();
        return orders.map((o) => this.toKitchenOrder(o));
    }

    /** Brand-locked staff cannot see or act on another brand's order. */
    private assertBrandAccess(
        order: { brandId?: number | null },
        allowedBrandIds: number[] | null,
    ) {
        if (allowedBrandIds == null) return;
        if (order.brandId == null || !allowedBrandIds.includes(order.brandId)) {
            throw new NotFoundException('Order not found');
        }
    }

    async getOrder(
        id: number,
        branchId: number,
        allowedBrandIds: number[] | null = null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id, branchId },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.brand',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
                'orderItems.modifiers.modifier.modifierGroup',
                'orderItems.dealMenuItem',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        this.assertBrandAccess(order, allowedBrandIds);
        return this.toKitchenOrder(order);
    }

    async updateStatus(
        id: number,
        branchId: number,
        status: string,
        allowedBrandIds: number[] | null = null,
    ) {
        if (!KITCHEN_STATUSES.includes(status)) {
            throw new ForbiddenException(
                `Invalid kitchen status: ${status}. Use: accepted, preparing, ready, completed`,
            );
        }
        const order = await this.orderRepo.findOne({ where: { id, branchId } });
        if (!order) throw new NotFoundException('Order not found');
        this.assertBrandAccess(order, allowedBrandIds);
        const previousStatus = order.status;
        // Atomic, lock-serialised transition: shift-cash is credited exactly once
        // even if two KDS terminals (or a double-tap) complete the same order.
        const changed = await transitionStatus(
            this.dataSource,
            'orders',
            id,
            status,
            {
                set: () =>
                    status === 'completed'
                        ? { completed_at: raw('now()') }
                        : {},
            },
        );
        if (changed !== null) {
            order.status = status;
            if (status === 'completed') {
                await this.shiftsService.addCompletedOrderAmount(
                    branchId,
                    Number(order.totalAmount),
                    order.brandId ?? null,
                );
            }
        }
        await this.ordersService.triggerAutoAssignAfterStatusChange(
            id,
            previousStatus,
        );
        if (status === 'accepted' && previousStatus !== 'accepted') {
            this.pushNotificationService.notifyConsumerOrder(
                order,
                'kitchen_accepted',
            );
        }
        return this.getOrder(id, branchId);
    }

    async getKotPayload(
        id: number,
        branchId: number,
        allowedBrandIds: number[] | null = null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id, branchId },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.brand',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
                'orderItems.modifiers.modifier.modifierGroup',
                'orderItems.dealMenuItem',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        this.assertBrandAccess(order, allowedBrandIds);
        type OI = (typeof order.orderItems)[0] & {
            menuItem?: { name: string; brand?: { name: string } };
        };
        const sortedItems = [...(order.orderItems ?? [])].sort(
            (a, b) => a.id - b.id,
        );
        return {
            order_number: order.orderNumber,
            source: order.source,
            order_type: order.orderType,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            delivery_address: order.deliveryAddress,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                sortedItems.map((oi) => {
                    const mi = (oi as OI).menuItem;
                    return {
                        name: oi.nameSnapshot ?? oi.menuItem?.name,
                        deal_id: oi.dealId ?? null,
                        deal_slot_index: oi.dealSlotIndex ?? null,
                        deal_name: oi.dealMenuItem?.name ?? null,
                        quantity: oi.quantity,
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
                        modifiers:
                            oi.modifiers
                                ?.map((m) => ({
                                    name:
                                        m.nameSnapshot ??
                                        m.modifier?.name ??
                                        '',
                                    quantity: m.quantity ?? 1,
                                    group:
                                        m.modifier?.modifierGroup?.name ?? null,
                                }))
                                .filter((m) => m.name) ?? [],
                    };
                }) ?? [],
        };
    }

    private toKitchenOrder(order: Order) {
        // Stable cart order (matches the customer invoice) — the join-based
        // query can otherwise return items in an arbitrary order.
        const sortedItems = [...(order.orderItems ?? [])].sort(
            (a, b) => a.id - b.id,
        );
        // Orders are single-brand, so show the brand once at the order level.
        const brandName =
            sortedItems
                .map(
                    (oi) =>
                        (oi as { menuItem?: { brand?: { name?: string } } })
                            .menuItem?.brand?.name,
                )
                .find(Boolean) ?? null;
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_group_id: order.orderGroupId ?? null,
            brand_id: order.brandId ?? null,
            brand_name: brandName,
            source: order.source,
            order_type: order.orderType,
            table_number: order.tableNumber,
            customer_name: order.customerName,
            status: order.status,
            placed_at: order.placedAt?.toISOString() ?? null,
            rider_id: order.riderId ?? null,
            rider: order.rider
                ? { id: order.rider.id, name: order.rider.name }
                : null,
            items:
                sortedItems.map((oi) => {
                    type OI = typeof oi & {
                        menuItem?: { name: string; brand?: { name: string } };
                        variant?: { name: string };
                        addons?: Array<{
                            addon?: { name: string };
                            quantity?: number;
                        }>;
                        modifiers?: Array<{
                            nameSnapshot?: string | null;
                            modifier?: {
                                name: string;
                                modifierGroup?: { name?: string };
                            };
                            quantity?: number;
                        }>;
                    };
                    const o = oi as OI;
                    return {
                        id: oi.id,
                        name: oi.nameSnapshot ?? o.menuItem?.name,
                        deal_id: oi.dealId ?? null,
                        deal_slot_index: oi.dealSlotIndex ?? null,
                        deal_name: oi.dealMenuItem?.name ?? null,
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
                        modifiers:
                            o.modifiers
                                ?.map((m) => ({
                                    name:
                                        m.nameSnapshot ??
                                        m.modifier?.name ??
                                        '',
                                    quantity: m.quantity ?? 1,
                                    group:
                                        m.modifier?.modifierGroup?.name ?? null,
                                }))
                                .filter((m) => m.name) ?? [],
                    };
                }) ?? [],
        };
    }
}
