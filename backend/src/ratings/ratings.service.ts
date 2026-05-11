import {
    Injectable,
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { RiderOrderRating } from '../entities/rider-order-rating.entity';
import { BrandOrderRating } from '../entities/brand-order-rating.entity';
import { Customer } from '../entities/customer.entity';
import { OrdersService } from '../orders/orders.service';
import { BrandsService } from '../brands/brands.service';
import { normalizePakistaniPhone } from '../utils/phone';

function assertStars(stars: unknown): number {
    if (!Number.isInteger(stars) || typeof stars !== 'number') {
        throw new BadRequestException('stars must be an integer from 1 to 5');
    }
    if (stars < 1 || stars > 5) {
        throw new BadRequestException('stars must be between 1 and 5');
    }
    return stars;
}

@Injectable()
export class RatingsService {
    constructor(
        @InjectRepository(Order)
        private readonly orderRepo: Repository<Order>,
        @InjectRepository(RiderOrderRating)
        private readonly riderRatingRepo: Repository<RiderOrderRating>,
        @InjectRepository(BrandOrderRating)
        private readonly brandRatingRepo: Repository<BrandOrderRating>,
        private readonly ordersService: OrdersService,
        private readonly brandsService: BrandsService,
        private readonly dataSource: DataSource,
    ) {}

    assertCustomerOwnsOrder(order: Order, customer: Customer): void {
        if (order.customerId != null) {
            if (order.customerId !== customer.id) {
                throw new ForbiddenException('You do not have access to this order');
            }
            return;
        }
        const normalizedOrderPhone = normalizePakistaniPhone(
            order.customerPhone ?? '',
        );
        const normalizedCustomerPhone = normalizePakistaniPhone(
            customer.phone ?? '',
        );
        if (
            !normalizedOrderPhone ||
            normalizedOrderPhone !== normalizedCustomerPhone
        ) {
            throw new ForbiddenException('You do not have access to this order');
        }
    }

    assertRiderRatingEligible(order: Order): void {
        if (order.riderId == null) {
            throw new BadRequestException(
                'This order has no rider; rider rating is not available',
            );
        }
        if (order.deliveryStatus !== 'delivered') {
            throw new BadRequestException(
                'You can only rate the rider after the order has been delivered',
            );
        }
    }

    assertBrandRatingEligible(order: Order): void {
        if (order.status !== 'completed') {
            throw new BadRequestException(
                'You can only rate the order after it is completed',
            );
        }
        if (
            order.orderType === 'delivery' &&
            order.deliveryStatus !== 'delivered'
        ) {
            throw new BadRequestException(
                'You can only rate this delivery order after it has been delivered',
            );
        }
    }

    resolveBrandIdForRating(
        order: Order,
        items: OrderItem[],
        bodyBrandId?: number | null,
    ): number {
        const lineBrandIds = [
            ...new Set(
                items
                    .map((i) => i.brandId)
                    .filter((id): id is number => id != null),
            ),
        ];
        if (order.brandId != null) {
            if (
                bodyBrandId != null &&
                Number.isInteger(bodyBrandId) &&
                bodyBrandId !== order.brandId
            ) {
                throw new BadRequestException(
                    'brand_id does not match this order brand',
                );
            }
            return order.brandId;
        }
        if (bodyBrandId == null || !Number.isInteger(bodyBrandId)) {
            if (lineBrandIds.length === 0) {
                throw new BadRequestException(
                    'This order has no brand on its line items; brand rating is not available',
                );
            }
            if (lineBrandIds.length > 1) {
                throw new BadRequestException(
                    'brand_id is required when the order contains multiple brands',
                );
            }
            return lineBrandIds[0];
        }
        if (!lineBrandIds.includes(bodyBrandId)) {
            throw new BadRequestException(
                'brand_id is not part of this order line items',
            );
        }
        return bodyBrandId;
    }

    private collectOrderItemIdsForBrand(
        items: OrderItem[],
        brandId: number,
    ): number[] {
        return items
            .filter((i) => i.brandId === brandId)
            .map((i) => i.id)
            .sort((a, b) => a - b);
    }

    private collectAllOrderItemIds(
        items: OrderItem[],
    ): number[] {
        return items.map((i) => i.id).sort((a, b) => a - b);
    }

    private toRiderRatingRow(r: RiderOrderRating) {
        return {
            id: r.id,
            order_id: r.orderId,
            customer_id: r.customerId,
            rider_user_id: r.riderUserId,
            stars: r.stars,
            order_item_ids: r.orderItemIds ?? [],
            created_at: r.createdAt?.toISOString() ?? null,
            updated_at: r.updatedAt?.toISOString() ?? null,
        };
    }

    private toBrandRatingRow(r: BrandOrderRating) {
        return {
            id: r.id,
            order_id: r.orderId,
            brand_id: r.brandId,
            customer_id: r.customerId,
            stars: r.stars,
            order_item_ids: r.orderItemIds ?? [],
            created_at: r.createdAt?.toISOString() ?? null,
            updated_at: r.updatedAt?.toISOString() ?? null,
        };
    }

    async upsertRiderRating(
        orderId: number,
        customer: Customer,
        starsRaw: unknown,
    ) {
        const stars = assertStars(starsRaw);
        return this.dataSource.transaction(async (manager) => {
            const order = await manager.findOne(Order, {
                where: { id: orderId },
                relations: ['orderItems'],
            });
            if (!order) throw new NotFoundException('Order not found');
            this.assertCustomerOwnsOrder(order, customer);
            this.assertRiderRatingEligible(order);
            const riderUserId = order.riderId as number;
            const orderItemIds = this.collectAllOrderItemIds(
                order.orderItems ?? [],
            );
            let row = await manager.findOne(RiderOrderRating, {
                where: { orderId },
            });
            if (!row) {
                row = manager.create(RiderOrderRating, {
                    orderId,
                    customerId: customer.id,
                    riderUserId,
                    stars,
                    orderItemIds,
                });
            } else {
                row.stars = stars;
                row.riderUserId = riderUserId;
                row.orderItemIds = orderItemIds;
            }
            const saved = await manager.save(RiderOrderRating, row);
            return this.toRiderRatingRow(saved);
        });
    }

    async upsertBrandRating(
        orderId: number,
        customer: Customer,
        starsRaw: unknown,
        bodyBrandId?: number | null,
    ) {
        const stars = assertStars(starsRaw);
        return this.dataSource.transaction(async (manager) => {
            const order = await manager.findOne(Order, {
                where: { id: orderId },
                relations: ['orderItems'],
            });
            if (!order) throw new NotFoundException('Order not found');
            this.assertCustomerOwnsOrder(order, customer);
            this.assertBrandRatingEligible(order);
            const items = order.orderItems ?? [];
            const brandId = this.resolveBrandIdForRating(
                order,
                items,
                bodyBrandId,
            );
            const orderItemIds = this.collectOrderItemIdsForBrand(
                items,
                brandId,
            );
            let row = await manager.findOne(BrandOrderRating, {
                where: { orderId, brandId },
            });
            if (!row) {
                row = manager.create(BrandOrderRating, {
                    orderId,
                    brandId,
                    customerId: customer.id,
                    stars,
                    orderItemIds,
                });
            } else {
                row.stars = stars;
                row.orderItemIds = orderItemIds;
            }
            const saved = await manager.save(BrandOrderRating, row);
            return this.toBrandRatingRow(saved);
        });
    }

    async getMyRatingsForOrder(orderId: number, customer: Customer) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');
        this.assertCustomerOwnsOrder(order, customer);
        const rider = await this.riderRatingRepo.findOne({
            where: { orderId, customerId: customer.id },
        });
        const brands = await this.brandRatingRepo.find({
            where: { orderId, customerId: customer.id },
            order: { brandId: 'ASC' },
        });
        return {
            rider_rating: rider ? this.toRiderRatingRow(rider) : null,
            brand_ratings: brands.map((b) => this.toBrandRatingRow(b)),
        };
    }

    async assertRiderBelongsToTenantOrIsRider(
        riderUserId: number,
        tenantId: number | null,
    ): Promise<void> {
        if (tenantId != null) {
            const riders = await this.ordersService.listRiders(tenantId);
            if (!riders.some((r) => r.id === riderUserId)) {
                throw new ForbiddenException(
                    'Rider is not part of your tenant or is not a rider',
                );
            }
            return;
        }
        const rows: Array<{ ok: number }> = await this.dataSource.query(
            `SELECT 1 AS ok
             FROM branch_users bu
             INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
             WHERE bu.user_id = $1
             LIMIT 1`,
            [riderUserId],
        );
        if (rows.length === 0) {
            throw new ForbiddenException('User is not a rider');
        }
    }

    /**
     * Admin POS: ratings for this order only. No customer identifiers or review text.
     * Includes all-time public brand averages for context (same numbers as consumer brand APIs).
     */
    async getOrderRatingsForAdmin(
        orderId: number,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: tenantId != null ? { id: orderId, tenantId } : { id: orderId },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(order.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }

        const riderRow = await this.riderRatingRepo.findOne({
            where: { orderId },
        });
        const brandRows = await this.brandRatingRepo.find({
            where: { orderId },
            relations: ['brand'],
            order: { brandId: 'ASC' },
        });

        const brandIds = brandRows.map((r) => r.brandId);
        const aggregates =
            brandIds.length > 0
                ? await this.brandsService.getRatingAggregatesForBrandIds(
                      brandIds,
                  )
                : new Map<
                      number,
                      {
                          rating_average: number | null;
                          rating_count: number;
                      }
                  >();

        return {
            rider_rating: riderRow
                ? {
                      stars: riderRow.stars,
                      rated_at: riderRow.updatedAt?.toISOString() ?? null,
                  }
                : null,
            brand_ratings: brandRows.map((r) => {
                const pub = aggregates.get(r.brandId);
                return {
                    brand_id: r.brandId,
                    brand_name: r.brand?.name ?? null,
                    order_stars: r.stars,
                    order_rated_at: r.updatedAt?.toISOString() ?? null,
                    public_rating_average: pub?.rating_average ?? null,
                    public_rating_count: pub?.rating_count ?? 0,
                };
            }),
        };
    }

    async listRiderRatingsForAdmin(
        riderUserId: number,
        tenantId: number | null,
        options: { limit: number; offset: number },
    ) {
        await this.assertRiderBelongsToTenantOrIsRider(riderUserId, tenantId);
        const qb = this.riderRatingRepo
            .createQueryBuilder('r')
            .innerJoinAndSelect('r.order', 'o')
            .where('r.riderUserId = :riderUserId', { riderUserId });
        if (tenantId != null) {
            qb.andWhere('o.tenantId = :tenantId', { tenantId });
        }
        qb.orderBy('r.createdAt', 'DESC')
            .take(options.limit)
            .skip(options.offset);
        const [rows, total] = await qb.getManyAndCount();
        return {
            items: rows.map((r) => ({
                id: r.id,
                order_id: r.orderId,
                order_number: r.order?.orderNumber ?? '',
                stars: r.stars,
                order_item_ids: r.orderItemIds ?? [],
                created_at: r.createdAt?.toISOString() ?? null,
            })),
            total,
            limit: options.limit,
            offset: options.offset,
        };
    }
}
