import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    ConflictException,
    UnprocessableEntityException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderItemAddon } from '../entities/order-item-addon.entity';
import { OrderItemModifier } from '../entities/order-item-modifier.entity';
import { Branch } from '../entities/branch.entity';
import { Brand } from '../entities/brand.entity';
import { Tenant } from '../entities/tenant.entity';
import { Discount } from '../entities/discount.entity';
import {
    offerAllowedOnChannel,
    sourceToOfferChannel,
} from '../discounts/offer-preview.util';
import { InvoiceTemplatesService } from '../invoices/invoice-templates.service';
import { User } from '../entities/user.entity';
import { MenuService } from '../menu/menu.service';
import {
    LoyaltyService,
    mapSourceToWalletType,
} from '../loyalty/loyalty.service';
import { ShiftsService } from '../shifts/shifts.service';
import { BranchesService } from '../branches/branches.service';
import { CustomersService } from '../customers/customers.service';
import { InventoryConsumptionService } from '../inventory/inventory-consumption.service';
import { normalizePakistaniPhone } from '../utils/phone';
import { assertMenuItemAvailableForOrderType } from '../utils/menu-order-type';
import {
    priceModifiersForLine,
    type PricingModifierGroup,
} from '../menu/modifier-pricing';
import {
    getBranchClock,
    isWithinSchedule,
    type BranchClock,
} from '../utils/branch-schedule';
import {
    bogoUnitDiscounts,
    priceBogoComponents,
    validateBogoComponents,
    isComponentAllowedInSlot,
    round2 as bogoRound2,
    type BogoComponentConstraint,
} from './bogo-pricing';
import {
    resolveGstRates,
    computeTenderTax,
    type TenderSplit,
} from './tax-pricing';
import { RiderDispatchState } from '../entities/rider-dispatch-state.entity';
import { RiderAssignmentLedger } from '../entities/rider-assignment-ledger.entity';
import { RiderOpsMetricsService } from '../rider-hrm/rider-ops-metrics.service';
import {
    freshnessState,
    selectRiderForBatchableOrder,
    riderPassesTierCap,
    type DeliveryTier,
} from './dispatch.utils';
import {
    buildDeliveryOptions,
    defaultTierKey,
    isDeliveryTierKey,
    resolveChosenTierFee,
    type DeliveryOption,
} from './delivery-tier.utils';
import { resolveRiderBrandScope } from './rider-brand-scope.util';
import { PushNotificationService } from '../push-notifications/push-notification.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
    transitionStatus,
    raw,
    isUniqueViolation,
    advisoryXactLock,
    AdvisoryLock,
} from '../common/db-concurrency';
import {
    runOfferEngine,
    round2 as oround2,
    EngineLine,
    EngineStage,
    OfferStageKind,
} from './offer-engine';
import { resolveOfferSettings, OfferSettings } from './offer-settings';

/** The tax rate (fraction, e.g. 0.15) to print, chosen by the tender the tax was based on. */
function effectiveTaxRate(o: {
    taxBasis?: string | null;
    taxRateCash?: number | null;
    taxRateCard?: number | null;
}): number | null {
    const cash = o.taxRateCash != null ? Number(o.taxRateCash) : null;
    const card = o.taxRateCard != null ? Number(o.taxRateCard) : null;
    if (o.taxBasis === 'card') return card ?? cash;
    if (o.taxBasis === 'cash') return cash ?? card;
    return cash ?? card; // split/unknown → cash (never under-states)
}

/**
 * Method-of-payment line for the printed invoice: distinct methods of the
 * order's completed tenders ("cash", "card", "cash + card" for split bills);
 * null when nothing has been tendered yet.
 */
function invoicePaymentMethod(
    payments?: Array<{ paymentMethod: string; status: string }> | null,
): string | null {
    const done = (payments ?? []).filter((p) => p.status === 'completed');
    const methods = [
        ...new Set(done.map((p) => p.paymentMethod).filter(Boolean)),
    ];
    return methods.length ? methods.join(' + ') : null;
}

/** Internal signal: a concurrent placement with the same idempotency key already
 * created this group, so createOrder should return it instead of a fresh order. */
class IdempotentReplay extends Error {
    constructor(public readonly orderGroupId: string) {
        super('idempotent-replay');
    }
}

@Injectable()
export class OrdersService {
    private readonly logger = new Logger(OrdersService.name);

    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem)
        private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(OrderItemAddon)
        private orderItemAddonRepo: Repository<OrderItemAddon>,
        @InjectRepository(OrderItemModifier)
        private orderItemModifierRepo: Repository<OrderItemModifier>,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
        @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
        @InjectRepository(Discount) private discountRepo: Repository<Discount>,
        @InjectRepository(User) private userRepo: Repository<User>,
        @InjectRepository(RiderAssignmentLedger)
        private riderAssignmentLedgerRepo: Repository<RiderAssignmentLedger>,
        private menuService: MenuService,
        private loyaltyService: LoyaltyService,
        private shiftsService: ShiftsService,
        private branchesService: BranchesService,
        private customersService: CustomersService,
        private inventoryConsumptionService: InventoryConsumptionService,
        private riderOpsMetrics: RiderOpsMetricsService,
        private dataSource: DataSource,
        private pushNotificationService: PushNotificationService,
        private notificationsService: NotificationsService,
        private invoiceTemplatesService: InvoiceTemplatesService,
    ) {}

    /**
     * Notify the till/cashier (per role-targeting config) that an online order —
     * app, web or kiosk — has landed and needs accepting. POS orders are placed by
     * the till itself and produce no notification. Fire-and-forget.
     */
    private async dispatchOnlineOrderNotifications(orderIds: number[]) {
        if (orderIds.length === 0) return;
        const orders = await this.orderRepo.find({
            where: { id: In(orderIds) },
        });
        for (const order of orders) {
            if (order.source === 'pos') continue;
            void this.notificationsService
                .dispatch({
                    tenantId: order.tenantId,
                    branchId: order.branchId,
                    brandId: order.brandId ?? null,
                    type: 'order.placed.online',
                    title: `New ${order.source === 'kiosk' ? 'kiosk' : 'online'} order #${order.orderNumber}`,
                    body:
                        `${order.orderType}` +
                        (order.customerName ? ` · ${order.customerName}` : '') +
                        ` · ${Number(order.totalAmount).toFixed(2)}`,
                    data: {
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        orderType: order.orderType,
                        source: order.source,
                        totalAmount: Number(order.totalAmount),
                        customerName: order.customerName,
                    },
                })
                .catch((e) =>
                    this.logger.error(
                        `Failed to dispatch order notification for order ${order.id}: ${String(e)}`,
                    ),
                );
        }
    }

    private haversineKm(
        lat1: number,
        lng1: number,
        lat2: number,
        lng2: number,
    ): number {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLng / 2) *
                Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /** Distance (km) from a branch's stored coords to a drop-off; null if any coord is missing. */
    private dropoffDistanceKm(
        branch: Branch,
        lat: number | null,
        lng: number | null,
    ): number | null {
        if (
            lat == null ||
            lng == null ||
            branch.latitude == null ||
            branch.longitude == null
        ) {
            return null;
        }
        return this.haversineKm(
            Number(branch.latitude),
            Number(branch.longitude),
            lat,
            lng,
        );
    }

    /**
     * Resolve the delivery fee + tier snapshot for one (branch, brand) at a drop-off,
     * enforcing the radius gate and tier availability. Non-delivery → 0. Brand without
     * tier-based delivery → legacy flat fee. Tier brand with no drop-off coords (e.g. POS)
     * → flat-fee fallback. Throws 422 outside radius / unavailable tier, 400 for a missing
     * or invalid tier on a tier-enabled brand.
     */
    private resolveDeliveryForBrand(
        branch: Branch,
        brand: Brand,
        orderType: string,
        dropLat: number | null,
        dropLng: number | null,
        chosenTier: string | undefined,
    ): {
        fee: number;
        tier: string | null;
        etaMin: number | null;
        etaMax: number | null;
    } {
        if (orderType !== 'delivery') {
            return { fee: 0, tier: null, etaMin: null, etaMax: null };
        }
        const flatFee = Number(brand?.deliveryFlatFee) || 0;
        if (!brand?.deliveryTiersEnabled || !brand.deliveryTiers) {
            return { fee: flatFee, tier: null, etaMin: null, etaMax: null };
        }
        const distanceKm = this.dropoffDistanceKm(branch, dropLat, dropLng);
        if (distanceKm == null) {
            // No coordinates to price/gate a tier (e.g. POS delivery) → flat-fee fallback.
            return { fee: flatFee, tier: null, etaMin: null, etaMax: null };
        }
        if (distanceKm > Number(branch.deliveryRadiusKm)) {
            throw new UnprocessableEntityException(
                'Delivery address is outside this branch’s delivery range.',
            );
        }
        if (!chosenTier || !isDeliveryTierKey(chosenTier)) {
            throw new BadRequestException(
                'A valid delivery_tier is required for this brand.',
            );
        }
        const resolved = resolveChosenTierFee(
            brand.deliveryTiers,
            chosenTier,
            distanceKm,
        );
        if (!resolved) {
            throw new UnprocessableEntityException(
                'Selected delivery option is not available for this address.',
            );
        }
        return {
            fee: resolved.fee,
            tier: chosenTier,
            etaMin: resolved.etaMin,
            etaMax: resolved.etaMax,
        };
    }

    private async createAssignmentLedgerEntry(input: {
        tenantId: number;
        branchId: number;
        orderId: number;
        eventType: 'auto' | 'manual' | 'change' | 'failed';
        selectedRiderUserId: number | null;
        eligibleRiderUserIds?: number[];
        skippedRiders?: Array<Record<string, unknown>>;
        reasonCode?: string | null;
        reasonDetail?: string | null;
        assignmentRequestId?: string | null;
        createdBy?: number | null;
    }) {
        await this.riderAssignmentLedgerRepo.save(
            this.riderAssignmentLedgerRepo.create({
                tenantId: input.tenantId,
                branchId: input.branchId,
                orderId: input.orderId,
                eventType: input.eventType,
                selectedRiderUserId: input.selectedRiderUserId,
                eligibleRiderUserIds: input.eligibleRiderUserIds ?? [],
                skippedRiders: input.skippedRiders ?? [],
                reasonCode: input.reasonCode ?? null,
                reasonDetail: input.reasonDetail ?? null,
                assignmentRequestId: input.assignmentRequestId ?? null,
                createdBy: input.createdBy ?? null,
            }),
        );
    }

    private humanizeDispatchSkipReason(reason: string): string {
        const labels: Record<string, string> = {
            user_inactive: 'user is inactive',
            not_checked_in: 'not checked in',
            paused: 'paused',
            checked_in_elsewhere: 'checked in at another branch',
            heartbeat_stale: 'heartbeat is stale',
            location_stale: 'live location is stale',
            active_order_cap: 'already at active order limit',
            below_min_rating: 'below minimum rating',
            below_min_timely_rate: 'below minimum timely rate',
            outside_branch_radius: 'outside branch delivery radius',
        };
        return labels[reason] ?? reason.replace(/_/g, ' ');
    }

    private async buildDispatchFailureMessage(
        latestFailure: RiderAssignmentLedger | null,
    ): Promise<string> {
        const fallback =
            latestFailure?.reasonDetail ??
            'No eligible riders were available for automatic assignment';
        const skipped = Array.isArray(latestFailure?.skippedRiders)
            ? latestFailure.skippedRiders
            : [];
        if (skipped.length === 0) return fallback;

        const riderIds = skipped
            .map((item) =>
                typeof item?.rider_user_id === 'number'
                    ? item.rider_user_id
                    : Number(item?.rider_user_id),
            )
            .filter((value) => Number.isFinite(value));
        const riders =
            riderIds.length > 0
                ? await this.userRepo.findBy({ id: In(riderIds) })
                : [];
        const riderNames = new Map(
            riders.map((rider) => [
                rider.id,
                rider.name?.trim() || `Rider #${rider.id}`,
            ]),
        );

        const detail = skipped
            .slice(0, 4)
            .map((item) => {
                const riderId =
                    typeof item?.rider_user_id === 'number'
                        ? item.rider_user_id
                        : Number(item?.rider_user_id);
                const reasonList = Array.isArray(item?.reasons)
                    ? item.reasons
                          .map((reason) =>
                              typeof reason === 'string'
                                  ? this.humanizeDispatchSkipReason(reason)
                                  : null,
                          )
                          .filter((reason): reason is string => !!reason)
                    : [];
                const riderLabel = Number.isFinite(riderId)
                    ? (riderNames.get(riderId) ?? `Rider #${riderId}`)
                    : 'A rider';
                return `${riderLabel}: ${reasonList.join(', ') || 'not eligible'}`;
            })
            .join('; ');
        const remaining =
            skipped.length > 4 ? `; +${skipped.length - 4} more rider(s)` : '';
        return `${fallback}. ${detail}${remaining}`;
    }

    /** A brand-locked admin may only act on orders of their own brand. */
    private assertOrderBrandAllowed(
        order: Order,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        if (allowedBrandIds == null) return;
        if (order.brandId == null || !allowedBrandIds.includes(order.brandId)) {
            throw new ForbiddenException(
                "You do not have access to this order's brand",
            );
        }
    }

    /** The rider must be linked (owned/shared) to the order's brand. */
    private async assertRiderLinkedToBrand(
        tenantId: number,
        brandId: number | null,
        riderId: number,
    ): Promise<void> {
        if (brandId == null) {
            throw new BadRequestException(
                'Order has no brand; cannot validate rider brand access',
            );
        }
        const result: unknown = await this.dataSource.query(
            `SELECT 1 AS ok FROM rider_brands
             WHERE rider_user_id = $1 AND brand_id = $2 AND tenant_id = $3
             LIMIT 1`,
            [riderId, brandId, tenantId],
        );
        const rows = result as Array<{ ok: number }>;
        if (rows.length === 0) {
            throw new BadRequestException(
                "This rider is not available for the order's brand",
            );
        }
    }

    private async resolveEligibleRidersForAutoDispatch(
        manager: DataSource['manager'],
        tenantId: number,
        branchId: number,
        brandId: number,
        effectiveTier: DeliveryTier,
        maxBatchSize: number,
    ): Promise<{
        eligible: Array<{ riderId: number; activeOrders: number }>;
        skipped: Array<Record<string, unknown>>;
    }> {
        const branch = await manager.findOne(Branch, {
            where: { id: branchId },
        });
        if (!branch) return { eligible: [], skipped: [] };

        const rows: Array<{
            rider_user_id: number;
            status: string;
            max_active_orders: number | null;
            min_rating: string | null;
            min_timely_rate: string | null;
            active_orders: string;
            has_priority_active: boolean | null;
            rating_avg: string | null;
            timely_rate: string | null;
            is_checked_in: boolean | null;
            is_paused: boolean | null;
            branch_id: number | null;
            last_heartbeat_at: Date | null;
            last_location_at: Date | null;
            last_latitude: string | null;
            last_longitude: string | null;
        }> = await manager.query(
            `SELECT DISTINCT u.id AS rider_user_id,
                    u.status,
                    rp.max_active_orders,
                    rp.min_rating::text,
                    rp.min_timely_rate::text,
                    COALESCE(ao.active_orders, 0)::text AS active_orders,
                    COALESCE(ao.has_priority_active, false) AS has_priority_active,
                    rr.rating_avg::text,
                    tr.timely_rate::text,
                    prs.is_checked_in,
                    prs.is_paused,
                    prs.branch_id,
                    prs.last_heartbeat_at,
                    prs.last_location_at,
                    prs.last_latitude::text,
                    prs.last_longitude::text
             FROM users u
             INNER JOIN branch_users bu ON bu.user_id = u.id AND bu.branch_id = $2
             INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
             INNER JOIN rider_brands rbr ON rbr.rider_user_id = u.id AND rbr.brand_id = $3 AND rbr.tenant_id = $1
             LEFT JOIN rider_profiles rp ON rp.user_id = u.id AND rp.tenant_id = $1
             LEFT JOIN rider_presences prs ON prs.rider_user_id = u.id
             LEFT JOIN (
                 SELECT o.rider_id AS rider_user_id,
                        COUNT(*) AS active_orders,
                        bool_or(o.delivery_tier = 'priority') AS has_priority_active
                 FROM orders o
                 WHERE o.tenant_id = $1
                   AND o.delivery_status IN ('accepted', 'picked_up')
                   AND o.status <> 'cancelled'
                 GROUP BY o.rider_id
             ) ao ON ao.rider_user_id = u.id
             LEFT JOIN (
                 SELECT ror.rider_user_id, AVG(ror.stars) AS rating_avg
                 FROM rider_order_ratings ror
                 INNER JOIN orders o ON o.id = ror.order_id AND o.tenant_id = $1
                 GROUP BY ror.rider_user_id
             ) rr ON rr.rider_user_id = u.id
             LEFT JOIN (
                 SELECT o.rider_id AS rider_user_id,
                        (100.0 * COUNT(*) FILTER (
                            WHERE o.completed_at IS NOT NULL
                              AND EXTRACT(EPOCH FROM (o.completed_at - o.placed_at)) / 60 <= 45
                        ) / NULLIF(COUNT(*), 0)) AS timely_rate
                 FROM orders o
                 WHERE o.tenant_id = $1
                   AND o.delivery_status = 'delivered'
                 GROUP BY o.rider_id
             ) tr ON tr.rider_user_id = u.id`,
            [tenantId, branchId, brandId],
        );

        const skipped: Array<Record<string, unknown>> = [];
        const eligible: Array<{ riderId: number; activeOrders: number }> = [];
        const branchLat =
            branch.latitude != null ? Number(branch.latitude) : null;
        const branchLng =
            branch.longitude != null ? Number(branch.longitude) : null;
        const radiusKm = Number(branch.deliveryRadiusKm ?? 10);
        for (const row of rows) {
            const riderId = Number(row.rider_user_id);
            const activeOrders = Number(row.active_orders ?? 0);
            const hasPriorityActive = row.has_priority_active === true;
            const minRating =
                row.min_rating != null ? Number(row.min_rating) : null;
            const minTimelyRate =
                row.min_timely_rate != null
                    ? Number(row.min_timely_rate)
                    : null;
            const ratingAvg =
                row.rating_avg != null ? Number(row.rating_avg) : null;
            const timelyRate =
                row.timely_rate != null ? Number(row.timely_rate) : null;
            const reasons: string[] = [];
            if (row.status !== 'active') reasons.push('user_inactive');
            if (!row.is_checked_in) reasons.push('not_checked_in');
            if (row.is_paused) reasons.push('paused');
            if (row.branch_id != null && Number(row.branch_id) !== branchId) {
                reasons.push('checked_in_elsewhere');
            }
            if (!freshnessState(row.last_heartbeat_at, 90))
                reasons.push('heartbeat_stale');
            if (!freshnessState(row.last_location_at, 120))
                reasons.push('location_stale');
            if (
                !riderPassesTierCap(
                    { activeOrders, hasPriorityActive },
                    effectiveTier,
                    maxBatchSize,
                )
            ) {
                reasons.push(
                    hasPriorityActive && effectiveTier !== 'priority'
                        ? 'priority_locked'
                        : 'active_order_cap',
                );
            }
            if (minRating != null && ratingAvg != null && ratingAvg < minRating)
                reasons.push('below_min_rating');
            if (
                minTimelyRate != null &&
                timelyRate != null &&
                timelyRate < minTimelyRate
            )
                reasons.push('below_min_timely_rate');
            if (
                branchLat != null &&
                branchLng != null &&
                row.last_latitude != null &&
                row.last_longitude != null
            ) {
                const dist = this.haversineKm(
                    branchLat,
                    branchLng,
                    Number(row.last_latitude),
                    Number(row.last_longitude),
                );
                if (dist > radiusKm) reasons.push('outside_branch_radius');
            }
            if (reasons.length > 0) {
                skipped.push({ rider_user_id: riderId, reasons });
                continue;
            }
            eligible.push({ riderId, activeOrders });
        }
        return {
            eligible: eligible.sort((a, b) => a.riderId - b.riderId),
            skipped,
        };
    }

    private async autoAssignRiderForOrder(
        orderId: number,
        options?: {
            assignmentRequestId?: string | null;
            reasonHint?: string | null;
        },
    ): Promise<void> {
        const started = Date.now();
        const assignmentRequestId =
            options?.assignmentRequestId ?? `auto-${orderId}`;
        let didAssign = false;
        await this.dataSource.transaction(async (manager) => {
            const existingLedger = await manager.findOne(
                RiderAssignmentLedger,
                {
                    where: { assignmentRequestId },
                },
            );
            if (existingLedger) return;

            const order = await manager.findOne(Order, {
                where: { id: orderId },
            });
            if (!order) return;
            if (order.orderType !== 'delivery' || order.riderId != null) return;
            // Brand-scoped dispatch requires a brand on the order.
            if (order.brandId == null) {
                this.riderOpsMetrics.inc('auto_assignment_no_eligible_riders');
                await manager.save(
                    manager.create(RiderAssignmentLedger, {
                        tenantId: order.tenantId,
                        branchId: order.branchId,
                        orderId: order.id,
                        eventType: 'failed',
                        assignmentRequestId,
                        selectedRiderUserId: null,
                        eligibleRiderUserIds: [],
                        skippedRiders: [],
                        reasonCode: 'no_brand',
                        reasonDetail:
                            'Order has no brand; brand-scoped dispatch cannot select a rider',
                    }),
                );
                return;
            }
            const brandId = order.brandId;
            const brand = await manager.findOne(Brand, {
                where: { id: brandId },
            });
            const effectiveTier: DeliveryTier =
                order.deliveryTier === 'priority' ||
                order.deliveryTier === 'saver'
                    ? order.deliveryTier
                    : 'standard';
            const maxBatchSize =
                brand?.deliveryTiersEnabled === true
                    ? Math.max(
                          1,
                          Number(brand.deliveryTiers?.maxBatchSize ?? 1),
                      )
                    : 1;

            const { eligible, skipped } =
                await this.resolveEligibleRidersForAutoDispatch(
                    manager,
                    order.tenantId,
                    order.branchId,
                    brandId,
                    effectiveTier,
                    maxBatchSize,
                );

            if (eligible.length === 0) {
                this.riderOpsMetrics.inc('auto_assignment_no_eligible_riders');
                await manager.save(
                    manager.create(RiderAssignmentLedger, {
                        tenantId: order.tenantId,
                        branchId: order.branchId,
                        orderId: order.id,
                        eventType: 'failed',
                        assignmentRequestId,
                        selectedRiderUserId: null,
                        eligibleRiderUserIds: [],
                        skippedRiders: skipped,
                        reasonCode: 'no_eligible_riders',
                        reasonDetail:
                            'No eligible riders matched attendance/presence constraints',
                    }),
                );
                return;
            }

            let state = await manager
                .createQueryBuilder(RiderDispatchState, 's')
                .setLock('pessimistic_write')
                .where(
                    's.tenant_id = :tenantId AND s.branch_id = :branchId AND s.brand_id = :brandId',
                    {
                        tenantId: order.tenantId,
                        branchId: order.branchId,
                        brandId,
                    },
                )
                .getOne();
            if (!state) {
                state = await manager.save(
                    manager.create(RiderDispatchState, {
                        tenantId: order.tenantId,
                        branchId: order.branchId,
                        brandId,
                        lastAssignedRiderUserId: null,
                        lastAssignedAt: null,
                    }),
                );
                state = await manager
                    .createQueryBuilder(RiderDispatchState, 's')
                    .setLock('pessimistic_write')
                    .where('s.id = :id', { id: state.id })
                    .getOne();
            }
            if (!state) return;

            const selectedRiderId = selectRiderForBatchableOrder(
                eligible,
                state.lastAssignedRiderUserId,
                effectiveTier,
            );
            if (selectedRiderId == null) return;

            // Serialize on the selected rider across ALL assignment paths (manual
            // assign/change/group + other auto-dispatch streams that share this rider
            // across brands), so the live-load re-check below is not a stale read and
            // a shared rider cannot be double-booked.
            await advisoryXactLock(
                manager,
                AdvisoryLock.RIDER_ASSIGNMENT,
                selectedRiderId,
            );

            // Concurrency guard: a parallel dispatch from another brand stream sharing this
            // rider could have filled them since eligibility was resolved. Re-validate the
            // selected rider's live load inside the txn before committing.
            const liveCounts: Array<{
                active_orders: string;
                has_priority_active: boolean | null;
            }> = await manager.query(
                `SELECT COUNT(*) AS active_orders,
                        COALESCE(bool_or(o.delivery_tier = 'priority'), false) AS has_priority_active
                 FROM orders o
                 WHERE o.tenant_id = $1 AND o.rider_id = $2
                   AND o.delivery_status IN ('accepted', 'picked_up')
                   AND o.status <> 'cancelled'`,
                [order.tenantId, selectedRiderId],
            );
            const liveActive = Number(liveCounts[0]?.active_orders ?? 0);
            const livePriority = liveCounts[0]?.has_priority_active === true;
            if (
                !riderPassesTierCap(
                    {
                        activeOrders: liveActive,
                        hasPriorityActive: livePriority,
                    },
                    effectiveTier,
                    maxBatchSize,
                )
            ) {
                this.riderOpsMetrics.inc('auto_assignment_no_eligible_riders');
                await manager.save(
                    manager.create(RiderAssignmentLedger, {
                        tenantId: order.tenantId,
                        branchId: order.branchId,
                        orderId: order.id,
                        eventType: 'failed',
                        assignmentRequestId,
                        selectedRiderUserId: null,
                        eligibleRiderUserIds: eligible.map((e) => e.riderId),
                        skippedRiders: skipped,
                        reasonCode: 'rider_filled_concurrently',
                        reasonDetail:
                            'Selected rider reached capacity before commit; will retry',
                    }),
                );
                return;
            }

            order.riderId = selectedRiderId;
            order.deliveryStatus = 'accepted';
            order.deliveryFailedReason = null;
            await manager.save(order);
            didAssign = true;

            state.lastAssignedRiderUserId = selectedRiderId;
            state.lastAssignedAt = new Date();
            await manager.save(state);

            await manager.save(
                manager.create(RiderAssignmentLedger, {
                    tenantId: order.tenantId,
                    branchId: order.branchId,
                    orderId: order.id,
                    eventType: 'auto',
                    assignmentRequestId,
                    selectedRiderUserId: selectedRiderId,
                    eligibleRiderUserIds: eligible.map((e) => e.riderId),
                    skippedRiders: skipped,
                    reasonCode: options?.reasonHint ?? 'auto_round_robin',
                    reasonDetail:
                        effectiveTier === 'priority'
                            ? 'Priority order dispatched to an idle rider'
                            : maxBatchSize > 1
                              ? 'Assigned with opportunistic batching'
                              : 'Assigned through strict round-robin',
                }),
            );
            this.riderOpsMetrics.inc('auto_assignment_success');
        });
        if (didAssign) {
            const order = await this.orderRepo.findOne({
                where: { id: orderId },
            });
            if (order) {
                this.pushNotificationService.notifyConsumerOrder(
                    order,
                    'rider_assigned',
                );
                this.pushNotificationService.notifyRiderNewAssignment(order);
            }
        }
        this.riderOpsMetrics.observe(
            'assignment_latency_ms',
            Date.now() - started,
        );
    }

    /**
     * Kitchen/KDS updates order status directly; call this after save so delivery
     * auto-dispatch matches Admin status transitions.
     */
    async triggerAutoAssignAfterStatusChange(
        orderId: number,
        previousStatus: string,
    ): Promise<void> {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) return;
        await this.maybeAutoAssignDeliveryOnPreparing(order, previousStatus);
    }

    private async maybeAutoAssignDeliveryOnPreparing(
        order: Order,
        previousStatus: string,
    ): Promise<void> {
        if (order.orderType !== 'delivery') return;
        if (order.status !== 'preparing') return;
        if (previousStatus !== 'placed' && previousStatus !== 'accepted')
            return;
        if (order.riderId != null) return;
        // Saver orders are held and dispatched by the delivery-dispatch cron after their
        // hold window, not on the preparing transition.
        if (order.deliveryTier === 'saver') return;
        try {
            await this.autoAssignRiderForOrder(order.id);
        } catch (e) {
            this.riderOpsMetrics.inc('auto_assignment_error');
            this.logger.error(
                `Auto rider assignment failed for order ${order.id} on entering preparing`,
                e instanceof Error ? e.stack : undefined,
            );
        }
    }

    /**
     * Cron entry (delivery-dispatch.job): (re)dispatch tiered delivery orders that are now ripe.
     * - priority: dispatch as soon as placed (retry until a dedicated rider is reserved).
     * - standard: retry once the kitchen has started (status 'preparing').
     * - saver: dispatch only after both 'preparing' and the brand's saver hold window.
     * Each attempt uses a unique assignmentRequestId so the ledger dedup never blocks retries;
     * double-assignment is still prevented by the in-txn order.riderId guard.
     */
    async sweepDeliveryDispatch(): Promise<{
        attempted: number;
        assigned: number;
    }> {
        const candidates = await this.orderRepo.find({
            where: {
                orderType: 'delivery',
                riderId: IsNull(),
                deliveryStatus: IsNull(),
                status: In(['placed', 'preparing']),
                deliveryTier: In(['saver', 'standard', 'priority']),
            },
            order: { placedAt: 'ASC' },
            take: 500,
        });
        const brandHoldCache = new Map<number, number>();
        const nowMs = Date.now();
        let attempted = 0;
        let assigned = 0;
        for (const order of candidates) {
            const tier = order.deliveryTier;
            if (tier == null) continue;
            if (tier === 'standard' && order.status !== 'preparing') continue;
            if (tier === 'saver') {
                if (order.status !== 'preparing') continue;
                let holdMinutes = order.brandId
                    ? brandHoldCache.get(order.brandId)
                    : 8;
                if (holdMinutes === undefined && order.brandId) {
                    const brand = await this.dataSource.manager.findOne(Brand, {
                        where: { id: order.brandId },
                    });
                    holdMinutes = Math.max(
                        0,
                        Number(brand?.deliveryTiers?.saverHoldMinutes ?? 8),
                    );
                    brandHoldCache.set(order.brandId, holdMinutes);
                }
                const placedMs = order.placedAt
                    ? new Date(order.placedAt).getTime()
                    : nowMs;
                if (nowMs - placedMs < (holdMinutes ?? 8) * 60_000) continue;
            }
            attempted += 1;
            const reasonHint =
                tier === 'priority'
                    ? 'auto_priority_immediate'
                    : tier === 'saver'
                      ? 'auto_saver_sweep'
                      : 'auto_standard_retry';
            try {
                await this.autoAssignRiderForOrder(order.id, {
                    assignmentRequestId: `sweep-${order.id}-${randomUUID()}`,
                    reasonHint,
                });
                const refreshed = await this.orderRepo.findOne({
                    where: { id: order.id },
                });
                if (refreshed?.riderId != null) assigned += 1;
            } catch (e) {
                this.riderOpsMetrics.inc('auto_assignment_error');
                this.logger.error(
                    `Delivery sweep dispatch failed for order ${order.id}`,
                    e instanceof Error ? e.stack : undefined,
                );
            }
        }
        return { attempted, assigned };
    }

    /** A rider's live active-order load (count + whether any is a priority order). */
    private async getRiderActiveState(
        tenantId: number,
        riderId: number,
        excludeOrderId?: number,
    ): Promise<{ activeOrders: number; hasPriorityActive: boolean }> {
        const rows: Array<{
            active_orders: string;
            has_priority_active: boolean | null;
        }> = await this.orderRepo.query(
            `SELECT COUNT(*) AS active_orders,
                    COALESCE(bool_or(o.delivery_tier = 'priority'), false) AS has_priority_active
             FROM orders o
             WHERE o.tenant_id = $1 AND o.rider_id = $2
               AND o.delivery_status IN ('accepted', 'picked_up')
               AND o.status <> 'cancelled'
               AND ($3::int IS NULL OR o.id <> $3)`,
            [tenantId, riderId, excludeOrderId ?? null],
        );
        return {
            activeOrders: Number(rows[0]?.active_orders ?? 0),
            hasPriorityActive: rows[0]?.has_priority_active === true,
        };
    }

    /** Tier-aware capacity for the order's brand (priority needs idle; standard/saver up to cap). */
    private async resolveOrderTierCap(
        order: Order,
    ): Promise<{ effectiveTier: DeliveryTier; maxBatchSize: number }> {
        const effectiveTier: DeliveryTier =
            order.deliveryTier === 'priority' || order.deliveryTier === 'saver'
                ? order.deliveryTier
                : 'standard';
        const brand =
            order.brandId != null
                ? await this.dataSource.manager.findOne(Brand, {
                      where: { id: order.brandId },
                  })
                : null;
        const maxBatchSize =
            brand?.deliveryTiersEnabled === true
                ? Math.max(1, Number(brand.deliveryTiers?.maxBatchSize ?? 1))
                : 1;
        return { effectiveTier, maxBatchSize };
    }

    async retryAutoAssignForAdmin(
        orderId: number,
        tenantId: number,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, tenantId },
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
        this.assertOrderBrandAllowed(order, allowedBrandIds);
        if (order.orderType !== 'delivery') {
            throw new BadRequestException(
                'Automatic rider assignment is only available for delivery orders',
            );
        }
        if (order.riderId != null) {
            throw new BadRequestException(
                'Order already has an assigned rider',
            );
        }
        await this.autoAssignRiderForOrder(orderId, {
            assignmentRequestId: `admin-retry-${orderId}-${randomUUID()}`,
        });
        const refreshed = await this.orderRepo.findOne({
            where: { id: orderId, tenantId },
        });
        if (refreshed?.riderId == null) {
            const latestFailure = await this.riderAssignmentLedgerRepo.findOne({
                where: {
                    orderId,
                    eventType: 'failed',
                },
                order: { createdAt: 'DESC' },
            });
            throw new BadRequestException(
                await this.buildDispatchFailureMessage(latestFailure),
            );
        }
        return this.findForAdmin(orderId, tenantId, allowedBranchIds);
    }

    async createOrder(
        dto: {
            branch_id: number;
            order_type: string;
            table_number?: string;
            customer_name?: string;
            customer_phone?: string;
            delivery_address?: string;
            items: Array<
                | {
                      menu_item_id: number;
                      quantity: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      notes?: string;
                      branch_id?: number;
                  }
                | {
                      deal_menu_item_id: number;
                      quantity: number;
                      components: Array<{
                          slot_index: number;
                          menu_item_id: number;
                          quantity: number;
                          variant_id?: number;
                          addons?: { addon_id: number; quantity?: number }[];
                          modifiers?: {
                              modifier_id: number;
                              quantity?: number;
                          }[];
                          notes?: string;
                      }>;
                      branch_id?: number;
                  }
            >;
            notes?: string;
            discount_code?: string;
            /** Points to redeem as discount (requires customer_phone). */
            loyalty_points_to_redeem?: number;
            /** Tender split for per-tender GST (cash vs card). Omit → cash rate. */
            payment_split?: { cash_amount?: number; card_amount?: number };
            /** Selected bank card (bank_cards id) for card-linked discounts. */
            bank_card_id?: number | null;
            /** When set, must match normalized customer_phone for same tenant. */
            customer_id?: number;
            /** Optional drop-off coordinates (e.g. consumer map picker). */
            latitude?: number;
            longitude?: number;
            /** Optional branch coordinates snapshot (from client). */
            branch_latitude?: number;
            branch_longitude?: number;
            /** Chosen delivery service tier ('saver'|'standard'|'priority') for tier-enabled brands. */
            delivery_tier?: string;
        },
        tenantId: number,
        createdBy: number | null,
        source: 'pos' | 'consumer_app' | 'consumer_web' | 'kiosk' = 'pos',
        loggedInCustomerId: number | null = null,
        /** Brand lock of the creating user (null = unrestricted). Items outside these brands are rejected. */
        allowedBrandIds: number[] | null = null,
        /** Optional client idempotency key — a retry/double-tap returns the same group. */
        idempotencyKey: string | null = null,
    ) {
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        // Idempotent placement: a retried / double-tapped request carrying a key that
        // already produced an order group returns that group instead of creating a
        // second real order (double charge, double stock depletion, double redeem).
        if (idempotencyKey) {
            const existing = await this.orderRepo.findOne({
                where: { tenantId, idempotencyKey },
                select: { id: true, orderGroupId: true },
            });
            if (existing?.orderGroupId) {
                return this.getOrderGroup(existing.orderGroupId);
            }
        }

        // Resolve branch per line (for multi-branch carts). Load all involved branches and their brands.
        // Note: we will expand deal items below, so use dto.items only for initial branch list.
        const lineBranchIds = dto.items.map(
            (line) =>
                (line as { branch_id?: number }).branch_id ?? dto.branch_id,
        );
        const uniqueBranchIds = [...new Set(lineBranchIds)];
        const branches = await this.branchRepo.find({
            where: uniqueBranchIds.map((id) => ({ id })),
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        const branchMap = new Map<
            number,
            {
                branch: (typeof branches)[0];
                brandIds: Set<number>;
                closedBrandIds: Set<number>;
            }
        >();
        type BranchWithBrands = (typeof branches)[0] & {
            branchBrands?: Array<{
                brandId: number;
                brand?: { id: number };
                isOpen?: boolean;
            }>;
        };
        for (const b of branches) {
            const raw = b as BranchWithBrands;
            const brandIds = new Set<number>(
                (raw.branchBrands ?? [])
                    .map((bb) => Number(bb.brandId ?? bb.brand?.id))
                    .filter((id: number) => Number.isFinite(id)),
            );
            // Brands taken offline for online ordering (branch_brands.is_open=false).
            const closedBrandIds = new Set<number>(
                (raw.branchBrands ?? [])
                    .filter((bb) => bb.isOpen === false)
                    .map((bb) => Number(bb.brandId ?? bb.brand?.id))
                    .filter((id: number) => Number.isFinite(id)),
            );
            branchMap.set(b.id, { branch: b, brandIds, closedBrandIds });
        }
        const primaryBranch = branchMap.get(dto.branch_id)?.branch;
        if (!primaryBranch) throw new NotFoundException('Branch not found');

        const expandedItems = await this.expandDealItems(
            dto.branch_id,
            dto.items,
            dto.order_type,
        );

        let customerPhoneNormalized: string | null = null;
        let explicitCustomerId: number | null = null;

        if (source === 'pos') {
            // Customer requirements depend on order type: dine-in is fully
            // optional; takeaway & delivery require a name + phone (delivery
            // also needs a delivery address).
            const customerRequired =
                dto.order_type === 'takeaway' || dto.order_type === 'delivery';
            if (customerRequired) {
                if (!dto.customer_name?.trim()) {
                    throw new BadRequestException(
                        'Customer name is required for takeaway and delivery orders',
                    );
                }
                if (!dto.customer_phone?.trim()) {
                    throw new BadRequestException(
                        'Customer phone is required for takeaway and delivery orders (use Pakistani format: 03XXXXXXXXX)',
                    );
                }
            }
            // Validate/normalize the phone whenever one is provided (required
            // above, or optionally entered for a dine-in order).
            if (dto.customer_phone?.trim()) {
                customerPhoneNormalized = normalizePakistaniPhone(
                    dto.customer_phone.trim(),
                );
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
                    );
                }
            }
            if (dto.order_type === 'delivery') {
                if (!dto.delivery_address?.trim()) {
                    throw new BadRequestException(
                        'Delivery address is required for delivery orders',
                    );
                }
            }
            // Brand-shift availability is checked after items are resolved
            // (shifts are per brand per branch, and the cart's brand is only
            // known once items have been loaded).
        } else {
            if (dto.customer_phone?.trim()) {
                customerPhoneNormalized = normalizePakistaniPhone(
                    dto.customer_phone.trim(),
                );
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
                    );
                }
            }
            if ((dto.loyalty_points_to_redeem ?? 0) > 0) {
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'customer_phone is required to redeem loyalty points',
                    );
                }
            }
            if (dto.customer_id != null) {
                if (!customerPhoneNormalized) {
                    throw new BadRequestException(
                        'customer_phone is required when customer_id is provided',
                    );
                }
                const cust = await this.customersService.findOne(
                    dto.customer_id,
                    tenantId,
                );
                if (cust.phone !== customerPhoneNormalized) {
                    throw new BadRequestException(
                        'customer_id does not match customer_phone',
                    );
                }
                explicitCustomerId = cust.id;
            }
        }

        const lineDetails: {
            menuItemId: number;
            categoryId: number;
            brandId: number;
            branchId: number;
            itemSubtotal: number;
            quantity?: number;
            sizeKey?: string | null;
        }[] = [];
        const itemBrandIds = new Set<number>();
        let subtotal = 0;
        type MenuItemWithAddons = {
            addons?: Array<{ id: number; price: number }>;
        };
        type ExpandedLine = (typeof expandedItems)[number];
        const orderItemInputs: {
            menuItem: MenuItemWithAddons;
            line: ExpandedLine;
            unitPrice: number;
            itemSubtotal: number;
            itemName: string;
            brandId: number;
            branchId: number;
            modifierPricing: ReturnType<typeof priceModifiersForLine>;
            lineSizeKey: string | null;
        }[] = [];

        for (const line of expandedItems) {
            const lineBranchId = line.branch_id ?? dto.branch_id;
            const branchInfo = branchMap.get(lineBranchId);
            if (!branchInfo) continue;

            const menuItem = await this.menuService.findMenuItem(
                line.menu_item_id,
            );
            if (!menuItem) continue;
            assertMenuItemAvailableForOrderType(menuItem, dto.order_type);
            this.assertMenuItemAvailableNow(
                menuItem,
                getBranchClock(
                    (branchInfo.branch as { timezone?: string }).timezone,
                ),
            );
            const menuItemBrandId = Number(
                (menuItem as { brandId?: number; brand?: { id: number } })
                    .brandId ??
                    (menuItem as { brand?: { id: number } }).brand?.id,
            );
            if (
                !Number.isFinite(menuItemBrandId) ||
                !branchInfo.brandIds.has(menuItemBrandId)
            )
                continue;
            if (
                allowedBrandIds != null &&
                !allowedBrandIds.includes(menuItemBrandId)
            ) {
                throw new ForbiddenException(
                    `"${menuItem.name}" belongs to another brand. This till can only sell items of its own brand.`,
                );
            }
            // Re-check availability at commit time (TOCTOU): the item may have been
            // 86'd or hidden online since the menu was loaded for this order.
            await this.menuService.assertBranchItemOrderable(
                lineBranchId,
                line.menu_item_id,
                source,
                menuItem.name,
            );
            // Brand online open/close is online-only (POS is exempt). Re-check it at
            // commit so an order can't slip through for a brand just taken offline.
            if (
                source !== 'pos' &&
                branchInfo.closedBrandIds.has(menuItemBrandId)
            ) {
                throw new BadRequestException(
                    `"${menuItem.name}" is not accepting online orders right now.`,
                );
            }

            let unitPrice: number;
            if (line.deal_unit_price !== undefined) {
                unitPrice = line.deal_unit_price;
            } else {
                unitPrice = await this.menuService.getEffectiveUnitPrice(
                    lineBranchId,
                    line.menu_item_id,
                );
            }
            let lineSizeKey: string | null = null;
            if (line.variant_id) {
                const variant = menuItem.variants?.find(
                    (v) => v.id === line.variant_id,
                );
                if (variant) {
                    // Deal lines carry a fully-resolved deal_unit_price (the variant/size
                    // price is already baked in by expandDealItems), so don't re-add the
                    // variant modifier here — this mirrors the quote path
                    // (computeSubtotalAndLinesWithBrands) and keeps the charged total equal
                    // to the quoted total. Still record sizeKey for size-aware modifier pricing.
                    if (line.deal_unit_price === undefined)
                        unitPrice += Number(variant.priceModifier);
                    lineSizeKey = variant.sizeKey ?? null;
                }
            }
            const quantity = line.quantity ?? 1;
            // A deal line carries one fully-resolved deal_unit_price per emitted unit and the
            // quote path (computeSubtotalAndLinesWithBrands) uses it UN-scaled by quantity, so
            // match that here — otherwise a deal component with quantity>1 would be charged
            // more than it was quoted. Non-deal lines scale by quantity as usual.
            let itemSubtotal =
                line.deal_unit_price !== undefined
                    ? unitPrice
                    : unitPrice * quantity;
            const itemName = menuItem.name;
            if (line.addons?.length) {
                for (const addonLine of line.addons) {
                    const addon = menuItem.addons?.find(
                        (a) => a.id === addonLine.addon_id,
                    );
                    if (addon)
                        itemSubtotal +=
                            Number(addon.price) * (addonLine.quantity ?? 1);
                }
            }
            // Size-aware modifier pricing (per-size surcharge + "first N free"); see modifier-pricing.ts.
            // Modifier cost is added once per line (matches prior behaviour, not scaled by line qty).
            const modifierPricing = priceModifiersForLine({
                modifierGroups: (
                    menuItem as { modifierGroups?: PricingModifierGroup[] }
                ).modifierGroups,
                selections: line.modifiers,
                sizeKey: lineSizeKey,
            });
            itemSubtotal += modifierPricing.total;

            lineDetails.push({
                menuItemId: menuItem.id,
                categoryId: menuItem.categoryId,
                brandId: menuItemBrandId,
                branchId: lineBranchId,
                itemSubtotal,
                quantity: line.quantity ?? 1,
                sizeKey: lineSizeKey,
            });
            itemBrandIds.add(menuItemBrandId);
            subtotal += itemSubtotal;
            orderItemInputs.push({
                menuItem,
                line,
                unitPrice,
                itemSubtotal,
                itemName,
                brandId: menuItemBrandId,
                branchId: lineBranchId,
                modifierPricing,
                lineSizeKey,
            });
        }

        if (lineDetails.length === 0)
            throw new BadRequestException('No valid items in order');

        // Multi-brand separation: every order is single-brand. POS, kiosk and
        // consumer-app reject mixed carts outright; consumer_web mixed carts
        // are auto-split into one order per brand (sharing an orderGroupId),
        // so each persisted order is still single-brand.
        if (
            (source === 'kiosk' ||
                source === 'consumer_app' ||
                source === 'pos') &&
            itemBrandIds.size > 1
        ) {
            throw new BadRequestException(
                'Items from different brands cannot be combined in one order. Please place a separate order per brand.',
            );
        }
        const orderBrandId =
            itemBrandIds.size === 1 ? [...itemBrandIds][0] : null;

        // POS orders require the brand's shift to be open at each branch
        // (shifts are per brand per branch).
        if (source === 'pos') {
            const branchBrandPairs = new Set(
                lineDetails.map((l) => `${l.branchId}-${l.brandId}`),
            );
            for (const pair of branchBrandPairs) {
                const [bid, brid] = pair.split('-').map(Number);
                const openShift =
                    await this.shiftsService.findOpenByBranchAndBrand(
                        bid,
                        brid,
                    );
                if (!openShift) {
                    throw new ForbiddenException(
                        `No shift is open for this brand at branch ID ${bid}. Open the brand's shift before placing POS orders.`,
                    );
                }
            }
        }

        // Online channels (app/web) respect the per-(branch,brand) open/close
        // switch. POS is exempt (gated by shifts above); kiosk is gated at submit.
        if (source === 'consumer_app' || source === 'consumer_web') {
            const pairs = new Set(
                lineDetails.map((l) => `${l.branchId}-${l.brandId}`),
            );
            for (const pair of pairs) {
                const [bid, brid] = pair.split('-').map(Number);
                if (!(await this.branchesService.isBrandOpenAt(bid, brid))) {
                    const brand = await this.branchRepo.manager
                        .getRepository(Brand)
                        .findOne({ where: { id: brid } });
                    throw new ConflictException(
                        `${brand?.name ?? 'This brand'} is currently closed at this branch.`,
                    );
                }
            }
        }

        // Resolve discounts at full-cart level and allocate to each line (use primary branch for discount context)
        // Card-linked discounts apply only when the WHOLE bill is paid by the selected card.
        const bankCardId =
            dto.bank_card_id != null ? Number(dto.bank_card_id) : null;
        const fullCardPayment =
            (Number(dto.payment_split?.cash_amount) || 0) <= 0 &&
            (Number(dto.payment_split?.card_amount) || 0) > 0;
        const offerSettings = resolveOfferSettings(
            (tenant as { offerSettings?: OfferSettings | null })
                .offerSettings ?? null,
        );
        const staged = await this.resolveStagedOffers({
            tenantId,
            subtotal,
            source,
            branchId: primaryBranch.id,
            orderBrandId,
            lineDetails,
            couponCode: dto.discount_code?.trim() ?? null,
            customerPhone: customerPhoneNormalized ?? null,
            customerId: loggedInCustomerId ?? null,
            fullCardPayment,
            bankCardId,
            settings: offerSettings,
        });
        const combinedLineDiscount = staged.combinedLineDiscount;
        // Per-line amount for one offer stage (sums to combinedLineDiscount[i]).
        // Lets each brand-order below persist its promo/order/coupon/card split.
        const stageLineAmount = (i: number, kind: string): number =>
            (staged.lineBreakdown?.[i]?.discounts ?? [])
                .filter((d) => d.kind === kind)
                .reduce((s, d) => s + d.amount, 0);
        // Compat shims for the per-brand persistence below (unchanged): auto_ =
        // product-promo + discount + card stages combined; coupon_ = coupon stage.
        const auto = {
            discountAmount: staged.autoDiscountAmount,
            discountCode: null as string | null,
            discountId: staged.discountId,
        };
        const coupon = {
            discountAmount: staged.couponDiscountAmount,
            discountCode: staged.discountCode,
            discountId: staged.discountId,
        };

        const serviceChargeRate = 0;
        // Per-tender GST (Pakistan reduced card/digital rate). The cashier's cash/card split is
        // applied to each brand-order's own base; a branch without per-tender rates falls back to
        // the tenant default (unchanged). No tender info → cash (higher) rate, never under-charges.
        const paymentSplit: TenderSplit = dto.payment_split
            ? {
                  cash: dto.payment_split.cash_amount,
                  card: dto.payment_split.card_amount,
              }
            : null;
        // Delivery fee is per brand: each order in the group charges its own brand's fee
        // (tier×distance when the brand opts into tier-based delivery, else its flat fee).
        const brandById = new Map<number, Brand>();
        for (const { branch: b } of branchMap.values()) {
            const raw = b as { branchBrands?: Array<{ brand?: Brand }> };
            for (const bb of raw.branchBrands ?? []) {
                if (bb.brand) brandById.set(Number(bb.brand.id), bb.brand);
            }
        }
        const orderGroupId = randomUUID();

        // Group line indices by (branchId, brandId) so each branch receives its orders
        const groupKey = (branchId: number, brandId: number) =>
            `${branchId}-${brandId}`;
        const groupToIndices = new Map<string, number[]>();
        lineDetails.forEach((line, idx) => {
            const key = groupKey(line.branchId, line.brandId);
            if (!groupToIndices.has(key)) groupToIndices.set(key, []);
            groupToIndices.get(key)!.push(idx);
        });
        const sortedGroups = [...groupToIndices.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key]) => key);

        // Loyalty redeem: apply to first order in group for supported sources.
        let customerId: number | null = explicitCustomerId;
        if (customerId == null && customerPhoneNormalized) {
            const customer = await this.customersService.findByPhone(
                tenantId,
                customerPhoneNormalized,
            );
            if (customer) customerId = customer.id;
        }
        if (
            customerId == null &&
            customerPhoneNormalized &&
            loggedInCustomerId != null &&
            (source === 'consumer_app' || source === 'consumer_web')
        ) {
            customerId = await this.customersService.resolveCustomerIdForOrder(
                tenantId,
                customerPhoneNormalized,
                loggedInCustomerId,
            );
        }

        let loyaltyDiscountAmount = 0;
        let loyaltyPointsToRedeem = 0;
        const firstKey = sortedGroups[0];
        const firstBrandId = Number(firstKey.split('-')[1]);
        const firstIndices = groupToIndices.get(firstKey)!;
        const firstOrderSubtotal = firstIndices.reduce(
            (s, i) => s + lineDetails[i].itemSubtotal,
            0,
        );
        const firstOrderLineDiscount = firstIndices.reduce(
            (s, i) => s + (combinedLineDiscount[i] ?? 0),
            0,
        );
        const firstOrderAfterDiscount =
            Math.round((firstOrderSubtotal - firstOrderLineDiscount) * 100) /
            100;
        if (
            (source === 'pos' || source === 'consumer_app') &&
            dto.customer_phone?.trim() &&
            (dto.loyalty_points_to_redeem ?? 0) > 0
        ) {
            const preview = await this.loyaltyService.getRedeemPreview(
                tenantId,
                customerPhoneNormalized ?? dto.customer_phone.trim(),
                firstOrderAfterDiscount,
                source,
                firstBrandId,
            );
            if (preview) {
                // Loyalty is the final stage; honour the order cap when
                // capIncludesLoyalty (single-brand only — web splits never redeem).
                const loyaltyCeiling =
                    offerSettings.capIncludesLoyalty &&
                    staged.capRemaining != null
                        ? Math.min(firstOrderAfterDiscount, staged.capRemaining)
                        : firstOrderAfterDiscount;
                const maxPoints =
                    preview.cashValuePerPoint > 0
                        ? Math.floor(loyaltyCeiling / preview.cashValuePerPoint)
                        : 0;
                loyaltyPointsToRedeem = Math.max(
                    0,
                    Math.min(
                        dto.loyalty_points_to_redeem!,
                        preview.redeemablePoints,
                        maxPoints,
                    ),
                );
                loyaltyDiscountAmount =
                    Math.round(
                        loyaltyPointsToRedeem * preview.cashValuePerPoint * 100,
                    ) / 100;
            }
        }

        // Pre-generate both identifiers per (branch, brand) group. Each group is
        // a distinct branch+brand pair = one order, so daily counters don't collide
        // within a single multi-brand placement.
        const identifiersByKey = new Map<
            string,
            { orderId: string; orderNumber: string }
        >();
        for (const key of sortedGroups) {
            const [branchIdStr, brandIdStr] = key.split('-');
            identifiersByKey.set(
                key,
                await this.generateOrderIdentifiers(
                    Number(branchIdStr),
                    Number(brandIdStr),
                ),
            );
        }

        const deliveryLatitude =
            dto.latitude != null && Number.isFinite(Number(dto.latitude))
                ? Number(dto.latitude)
                : null;
        const deliveryLongitude =
            dto.longitude != null && Number.isFinite(Number(dto.longitude))
                ? Number(dto.longitude)
                : null;

        const branchLatitude =
            dto.branch_latitude != null &&
            Number.isFinite(Number(dto.branch_latitude))
                ? Number(dto.branch_latitude)
                : null;
        const branchLongitude =
            dto.branch_longitude != null &&
            Number.isFinite(Number(dto.branch_longitude))
                ? Number(dto.branch_longitude)
                : null;

        const createdOrderIds: number[] = [];
        const priorityOrderIds: number[] = [];
        let firstOrderIdForLoyalty: number | null = null;

        try {
            for (const key of sortedGroups) {
                const [branchIdStr, brandIdStr] = key.split('-');
                const branchId = Number(branchIdStr);
                const brandId = Number(brandIdStr);
                const indices = groupToIndices.get(key)!;
                let { orderId: newOrderId, orderNumber } =
                    identifiersByKey.get(key)!;
                const brandSubtotal = indices.reduce(
                    (s, i) => s + lineDetails[i].itemSubtotal,
                    0,
                );
                const brandDiscountAmount = indices.reduce(
                    (s, i) => s + (combinedLineDiscount[i] ?? 0),
                    0,
                );
                const r2 = (n: number) => Math.round(n * 100) / 100;
                const brandPromoDiscount = r2(
                    indices.reduce(
                        (s, i) => s + stageLineAmount(i, 'product_promotion'),
                        0,
                    ),
                );
                const brandOrderDiscount = r2(
                    indices.reduce(
                        (s, i) => s + stageLineAmount(i, 'discount'),
                        0,
                    ),
                );
                const brandCouponDiscount = r2(
                    indices.reduce(
                        (s, i) => s + stageLineAmount(i, 'coupon'),
                        0,
                    ),
                );
                const brandCardDiscount = r2(
                    indices.reduce(
                        (s, i) => s + stageLineAmount(i, 'card_offer'),
                        0,
                    ),
                );
                const isFirstOrder = key === firstKey;
                let afterDiscount =
                    Math.round((brandSubtotal - brandDiscountAmount) * 100) /
                    100;
                if (isFirstOrder && loyaltyDiscountAmount > 0) {
                    afterDiscount =
                        Math.round(
                            (afterDiscount - loyaltyDiscountAmount) * 100,
                        ) / 100;
                }
                const groupBranch = branchMap.get(branchId)!.branch;
                const gstRates = resolveGstRates(
                    groupBranch as unknown as {
                        gstRateCash?: number | null;
                        gstRateCard?: number | null;
                    },
                    tenant,
                );
                const tax = computeTenderTax(
                    afterDiscount,
                    paymentSplit,
                    gstRates.cash,
                    gstRates.card,
                );
                const brandTax = tax.taxAmount;
                const brandServiceCharge =
                    Math.round(afterDiscount * serviceChargeRate * 100) / 100;
                const groupBrand = brandById.get(brandId);
                const deliveryResolved = groupBrand
                    ? this.resolveDeliveryForBrand(
                          groupBranch,
                          groupBrand,
                          dto.order_type,
                          deliveryLatitude,
                          deliveryLongitude,
                          dto.delivery_tier,
                      )
                    : { fee: 0, tier: null, etaMin: null, etaMax: null };
                const brandDeliveryFee = deliveryResolved.fee;
                const totalAmount =
                    Math.round(
                        (afterDiscount +
                            brandTax +
                            brandServiceCharge +
                            brandDeliveryFee) *
                            100,
                    ) / 100;
                let order: Order;
                // Order number/id sequence is derived from a COUNT, so two orders placed
                // in the same second for the same branch+brand collide on the unique
                // index. Regenerate the sequence and retry instead of failing the whole
                // placement with a 500.
                for (let attempt = 0; ; attempt++) {
                    try {
                        order = await this.orderRepo.save(
                            this.orderRepo.create({
                                tenantId,
                                brandId,
                                orderGroupId,
                                branchId,
                                orderId: newOrderId,
                                orderNumber,
                                orderType: dto.order_type,
                                tableNumber: dto.table_number ?? null,
                                customerName: dto.customer_name ?? null,
                                customerPhone:
                                    customerPhoneNormalized ??
                                    dto.customer_phone?.trim() ??
                                    null,
                                customerId,
                                deliveryAddress: dto.delivery_address ?? null,
                                deliveryLatitude,
                                deliveryLongitude,
                                branchLatitude,
                                branchLongitude,
                                status: 'placed',
                                source,
                                notes: dto.notes ?? null,
                                subtotal: brandSubtotal,
                                discountAmount: brandDiscountAmount,
                                promoDiscountAmount: brandPromoDiscount,
                                orderDiscountAmount: brandOrderDiscount,
                                couponDiscountAmount: brandCouponDiscount,
                                cardDiscountAmount: brandCardDiscount,
                                taxAmount: brandTax,
                                taxRateCash: gstRates.cash,
                                taxRateCard: gstRates.card,
                                taxBasis: tax.basis,
                                serviceCharge: brandServiceCharge,
                                deliveryFee: brandDeliveryFee,
                                deliveryTier: deliveryResolved.tier,
                                deliveryEtaMinMinutes: deliveryResolved.etaMin,
                                deliveryEtaMaxMinutes: deliveryResolved.etaMax,
                                totalAmount,
                                // Persist the user-entered discount code if provided, even if it ends up ineligible.
                                // This matches consumer expectations (they want to see what they tried to apply).
                                discountCode:
                                    dto.discount_code?.trim() ||
                                    coupon.discountCode ||
                                    auto.discountCode ||
                                    null,
                                discountId:
                                    coupon.discountId ??
                                    auto.discountId ??
                                    null,
                                loyaltyPointsRedeemed: isFirstOrder
                                    ? loyaltyPointsToRedeem
                                    : 0,
                                // Carry the idempotency key on the first order of the group only,
                                // so (tenant_id, idempotency_key) stays unique across the group.
                                idempotencyKey: isFirstOrder
                                    ? idempotencyKey
                                    : null,
                                ...(createdBy != null && {
                                    creator: { id: createdBy } as {
                                        id: number;
                                    },
                                }),
                                placedAt: new Date(),
                            }),
                        );
                        break;
                    } catch (e) {
                        if (isUniqueViolation(e)) {
                            const constraint = (
                                e as { driverError?: { constraint?: string } }
                            ).driverError?.constraint;
                            // Concurrent placement with the same idempotency key won the race:
                            // return the group it created instead of a duplicate.
                            if (
                                constraint === 'UQ_orders_tenant_idempotency' &&
                                idempotencyKey
                            ) {
                                const winner = await this.orderRepo.findOne({
                                    where: { tenantId, idempotencyKey },
                                    select: { id: true, orderGroupId: true },
                                });
                                if (winner?.orderGroupId) {
                                    throw new IdempotentReplay(
                                        winner.orderGroupId,
                                    );
                                }
                            }
                            if (attempt < 4) {
                                const regen =
                                    await this.generateOrderIdentifiers(
                                        branchId,
                                        brandId,
                                    );
                                newOrderId = regen.orderId;
                                orderNumber = regen.orderNumber;
                                continue;
                            }
                        }
                        throw e;
                    }
                }
                createdOrderIds.push(order.id);
                if (deliveryResolved.tier === 'priority') {
                    priorityOrderIds.push(order.id);
                }
                if (isFirstOrder && loyaltyPointsToRedeem > 0) {
                    firstOrderIdForLoyalty = order.id;
                }

                const brandInputs = indices.map((i) => orderItemInputs[i]);
                for (const {
                    menuItem,
                    line,
                    unitPrice,
                    itemSubtotal,
                    itemName,
                    brandId: bid,
                    modifierPricing,
                    lineSizeKey,
                } of brandInputs) {
                    const orderItem = await this.orderItemRepo.save(
                        this.orderItemRepo.create({
                            orderId: order.id,
                            menuItemId: line.menu_item_id,
                            brandId: bid,
                            variantId: line.variant_id ?? null,
                            nameSnapshot: itemName,
                            priceSnapshot: unitPrice,
                            quantity: line.quantity ?? 1,
                            unitPrice,
                            subtotal: itemSubtotal,
                            notes: line.notes ?? null,
                            dealId: line.deal_id ?? null,
                            dealSlotIndex: line.deal_slot_index ?? null,
                        }),
                    );
                    if (line.addons?.length) {
                        for (const addonLine of line.addons) {
                            const addon = menuItem.addons?.find(
                                (a: { id: number; price: number }) =>
                                    a.id === addonLine.addon_id,
                            );
                            if (addon) {
                                const addonQty = addonLine.quantity ?? 1;
                                await this.orderItemAddonRepo.save(
                                    this.orderItemAddonRepo.create({
                                        orderItemId: orderItem.id,
                                        addonId: addon.id,
                                        quantity: addonQty,
                                        unitPrice: Number(addon.price),
                                        subtotal:
                                            Number(addon.price) * addonQty,
                                    }),
                                );
                            }
                        }
                    }
                    // Persist one row per modifier from the size-aware pricing result
                    // (priceSnapshot = per-unit size price; freeQuantity = units included free).
                    for (const pm of modifierPricing.lines) {
                        await this.orderItemModifierRepo.save(
                            this.orderItemModifierRepo.create({
                                orderItemId: orderItem.id,
                                modifierId: pm.modifierId,
                                nameSnapshot: pm.name,
                                priceSnapshot: pm.unitPrice,
                                quantity: pm.quantity,
                                freeQuantity: pm.freeQuantity,
                                variantSizeSnapshot: lineSizeKey,
                            }),
                        );
                    }
                }
            }
        } catch (e) {
            // A concurrent placement with the same idempotency key already created
            // this group (and ran its consumption); return it. No cleanup needed:
            // the collision happens on the first order before any row is committed.
            if (e instanceof IdempotentReplay) {
                return this.getOrderGroup(e.orderGroupId);
            }
            throw e;
        }

        // Book the coupon realization (race-safe) before inventory/loyalty side
        // effects. A per-customer/global limit breached in a concurrent race
        // throws → cancel the just-created orders (no consumption posted yet).
        if (
            staged.couponOffer &&
            staged.couponDiscountAmount > 0 &&
            createdOrderIds.length > 0
        ) {
            try {
                await this.enforceAndRecordRealization({
                    tenantId,
                    offer: staged.couponOffer,
                    customerId,
                    customerPhone: customerPhoneNormalized ?? null,
                    orderId: createdOrderIds[0],
                    source,
                    amount: staged.couponDiscountAmount,
                });
            } catch (e) {
                for (const id of createdOrderIds) {
                    try {
                        await this.updateStatus(id, tenantId, 'cancelled');
                    } catch {
                        void 0;
                    }
                }
                throw e;
            }
        }

        if (
            firstOrderIdForLoyalty != null &&
            loyaltyPointsToRedeem > 0 &&
            customerPhoneNormalized
        ) {
            // Deduct inventory (FEFO) for all created orders before applying loyalty redemption,
            // so we never redeem points for an order that later fails stock deduction.
            try {
                for (const id of createdOrderIds) {
                    await this.inventoryConsumptionService.consumeForOrder(id);
                }
                // Redeem INSIDE the same try so a redeem failure also reverses the
                // consumption and cancels the orders — otherwise the order would be
                // committed with a points-discounted total but no matching debit
                // (an un-backed discount on an orphaned live order).
                await this.loyaltyService.redeemForOrder(
                    tenantId,
                    customerPhoneNormalized,
                    firstOrderIdForLoyalty,
                    loyaltyPointsToRedeem,
                    firstOrderAfterDiscount,
                    source,
                    firstBrandId,
                );
            } catch (e) {
                // Best-effort rollback: reverse any consumption already posted and cancel the created orders.
                for (const id of createdOrderIds) {
                    try {
                        await this.inventoryConsumptionService.reverseConsumptionForOrder(
                            id,
                            createdBy,
                        );
                    } catch {
                        void 0;
                    }
                    try {
                        await this.updateStatus(id, tenantId, 'cancelled');
                    } catch {
                        void 0;
                    }
                }
                throw e;
            }
        }

        // If no loyalty redemption block ran, still deduct inventory now.
        if (
            !(
                firstOrderIdForLoyalty != null &&
                loyaltyPointsToRedeem > 0 &&
                customerPhoneNormalized
            )
        ) {
            try {
                for (const id of createdOrderIds) {
                    await this.inventoryConsumptionService.consumeForOrder(id);
                }
            } catch (e) {
                for (const id of createdOrderIds) {
                    try {
                        await this.inventoryConsumptionService.reverseConsumptionForOrder(
                            id,
                            createdBy,
                        );
                    } catch {
                        void 0;
                    }
                    try {
                        await this.updateStatus(id, tenantId, 'cancelled');
                    } catch {
                        void 0;
                    }
                }
                throw e;
            }
        }

        // Priority delivery dispatches immediately at placement (reserves a dedicated rider),
        // rather than waiting for the kitchen 'preparing' transition. Non-fatal on failure —
        // the dispatch sweep retries unassigned priority orders.
        for (const id of priorityOrderIds) {
            try {
                await this.autoAssignRiderForOrder(id, {
                    reasonHint: 'auto_priority_immediate',
                });
            } catch (e) {
                this.riderOpsMetrics.inc('auto_assignment_error');
                this.logger.error(
                    `Priority auto-dispatch failed for order ${id} at placement`,
                    e instanceof Error ? e.stack : undefined,
                );
            }
        }

        const orders = await Promise.all(
            createdOrderIds.map((id) => this.findOne(id)),
        );
        // Notify the till/cashier of incoming online (app/web/kiosk) orders.
        void this.dispatchOnlineOrderNotifications(createdOrderIds);
        const responseWalletType = mapSourceToWalletType(source);
        const loyalty =
            customerPhoneNormalized != null && responseWalletType != null
                ? await this.loyaltyService.getWalletBalance(
                      tenantId,
                      customerPhoneNormalized,
                      responseWalletType,
                      firstBrandId,
                  )
                : null;
        const loyaltyPointsBalance = loyalty?.balance ?? 0;
        return {
            order_group_id: orderGroupId,
            orders: orders.map((o) => ({
                ...o,
                loyalty_points_balance: loyaltyPointsBalance,
            })),
        };
    }

    async findOne(id: number) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'brand',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            notes: order.notes ?? null,
            order_type: order.orderType,
            status: order.status,
            order_group_id: order.orderGroupId ?? null,
            brand_id: order.brandId ?? null,
            brand_name: order.brand?.name ?? null,
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            delivery_tier: order.deliveryTier ?? null,
            delivery_eta_min_minutes: order.deliveryEtaMinMinutes ?? null,
            delivery_eta_max_minutes: order.deliveryEtaMaxMinutes ?? null,
            total_amount: Number(order.totalAmount),
            discount_code: order.discountCode,
            delivery_address: order.deliveryAddress ?? null,
            delivery_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            delivery_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            branch_latitude:
                order.branchLatitude != null
                    ? Number(order.branchLatitude)
                    : null,
            branch_longitude:
                order.branchLongitude != null
                    ? Number(order.branchLongitude)
                    : null,
            customer_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            customer_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    price_snapshot:
                        oi.priceSnapshot != null
                            ? Number(oi.priceSnapshot)
                            : Number(oi.unitPrice),
                    quantity: oi.quantity,
                    notes: oi.notes ?? null,
                    unit_price: Number(oi.unitPrice),
                    subtotal: Number(oi.subtotal),
                    deal_id: oi.dealId ?? null,
                    deal_slot_index: oi.dealSlotIndex ?? null,
                    variant_id: oi.variantId ?? null,
                    variant_name:
                        (oi.variant as { name?: string } | null)?.name ?? null,
                    category:
                        (oi.menuItem as { category?: { name: string } } | null)
                            ?.category?.name ?? null,
                    addons:
                        oi.addons?.map((a) => ({
                            id: a.id,
                            addon_id: a.addonId,
                            name:
                                (a.addon as { name?: string } | undefined)
                                    ?.name ?? null,
                            quantity: a.quantity,
                            unit_price: Number(a.unitPrice),
                            subtotal: Number(a.subtotal),
                        })) ?? [],
                    modifiers:
                        (
                            oi as {
                                modifiers?: Array<{
                                    nameSnapshot: string;
                                    priceSnapshot: number;
                                    quantity?: number | null;
                                    freeQuantity?: number | null;
                                }>;
                            }
                        ).modifiers?.map((m) => ({
                            name: m.nameSnapshot,
                            price: Number(m.priceSnapshot),
                            quantity:
                                (m as { quantity?: number | null }).quantity ??
                                1,
                            free_quantity:
                                (m as { freeQuantity?: number | null })
                                    .freeQuantity ?? 0,
                        })) ?? [],
                })) ?? [],
        };
    }

    /** List orders for consumer by customer phone (order history). */
    async findByCustomerPhone(
        customerPhone: string,
        options?: {
            branchId?: number;
            tenantId?: number;
            limit?: number;
            sources?: Array<'consumer_app' | 'consumer_web' | 'kiosk'>;
        },
    ) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized)
            throw new BadRequestException('Valid phone is required');
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .where('o.customerPhone = :phone', { phone: normalized })
            .orderBy('o.placedAt', 'DESC')
            .take(options?.limit ?? 50);
        const sources =
            options?.sources && options.sources.length > 0
                ? options.sources
                : ['consumer_app'];
        qb.andWhere('o.source IN (:...sources)', { sources });
        if (options?.tenantId != null)
            qb.andWhere('o.tenantId = :tenantId', {
                tenantId: options.tenantId,
            });
        if (options?.branchId != null)
            qb.andWhere('o.branchId = :branchId', {
                branchId: options.branchId,
            });
        const orders = await qb.getMany();
        if (orders.length === 0) return [];

        const orderIds = orders.map((o) => o.id);
        const lineBrandRows = await this.orderItemRepo.find({
            where: { orderId: In(orderIds) },
            select: ['orderId', 'brandId'],
        });
        const brandIdsByOrder = new Map<number, Set<number>>();
        for (const row of lineBrandRows) {
            if (row.brandId == null) continue;
            let set = brandIdsByOrder.get(row.orderId);
            if (!set) {
                set = new Set<number>();
                brandIdsByOrder.set(row.orderId, set);
            }
            set.add(row.brandId);
        }

        return orders.map((o) => {
            const fromLines = brandIdsByOrder.get(o.id);
            const brand_ids = fromLines
                ? [...fromLines].sort((a, b) => a - b)
                : [];
            return {
                id: o.id,
                order_number: o.orderNumber,
                status: o.status,
                total_amount: Number(o.totalAmount),
                placed_at: o.placedAt?.toISOString() ?? null,
                branch_id: o.branchId,
                brand_id: o.brandId ?? null,
                brand_ids,
                loyalty_points_redeemed: o.loyaltyPointsRedeemed ?? 0,
            };
        });
    }

    /** Get full order details for consumer; only if customerPhone matches. */
    async findOneByCustomerPhone(orderId: number, customerPhone: string) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized)
            throw new BadRequestException('Valid phone is required');
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: [
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'brand',
                'payments',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.customerPhone !== normalized)
            throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_type: order.orderType,
            status: order.status,
            order_group_id: order.orderGroupId ?? null,
            brand_id: order.brandId ?? null,
            brand_name: order.brand?.name ?? null,
            customer_id: order.customerId ?? null,
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            delivery_tier: order.deliveryTier ?? null,
            delivery_eta_min_minutes: order.deliveryEtaMinMinutes ?? null,
            delivery_eta_max_minutes: order.deliveryEtaMaxMinutes ?? null,
            total_amount: Number(order.totalAmount),
            discount_code: order.discountCode,
            delivery_address: order.deliveryAddress ?? null,
            delivery_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            delivery_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            branch_latitude:
                order.branchLatitude != null
                    ? Number(order.branchLatitude)
                    : null,
            branch_longitude:
                order.branchLongitude != null
                    ? Number(order.branchLongitude)
                    : null,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            placed_at: order.placedAt?.toISOString() ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    price_snapshot:
                        oi.priceSnapshot != null
                            ? Number(oi.priceSnapshot)
                            : Number(oi.unitPrice),
                    quantity: oi.quantity,
                    notes: oi.notes ?? null,
                    unit_price: Number(oi.unitPrice),
                    subtotal: Number(oi.subtotal),
                    category:
                        (oi.menuItem as { category?: { name: string } } | null)
                            ?.category?.name ?? null,
                })) ?? [],
            payments: (order.payments ?? []).map((p) => ({
                id: p.id,
                payment_method: p.paymentMethod,
                amount: Number(p.amount),
                status: p.status,
                reference_number: p.referenceNumber ?? null,
                paid_at: p.paidAt?.toISOString() ?? null,
            })),
        };
    }

    /** Cancel order by consumer; only if phone matches and status is placed. */
    async cancelByCustomerPhone(orderId: number, customerPhone: string) {
        const normalized = normalizePakistaniPhone(
            typeof customerPhone === 'string' ? customerPhone.trim() : '',
        );
        if (!normalized)
            throw new BadRequestException('Valid phone is required');
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.customerPhone !== normalized)
            throw new NotFoundException('Order not found');
        if (order.status !== 'placed')
            throw new BadRequestException(
                'Only orders with status "placed" can be cancelled',
            );
        await this.updateStatus(order.id, order.tenantId, 'cancelled');
        return { message: 'Order cancelled' };
    }

    /** Get all orders in a group (for viewing a customer's multi-brand order). */
    async getOrderGroup(orderGroupId: string) {
        const orders = await this.orderRepo.find({
            where: { orderGroupId },
            relations: [
                'brand',
                'creator',
                'payments',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
                'orderItems.modifiers.modifier.modifierGroup',
                'orderItems.dealMenuItem',
            ],
            order: { id: 'ASC' },
        });
        if (orders.length === 0)
            throw new NotFoundException('Order group not found');
        return {
            order_group_id: orderGroupId,
            orders: orders.map((o) => ({
                id: o.id,
                order_number: o.orderNumber,
                brand_id: o.brandId,
                brand_name: o.brand?.name ?? null,
                brand_logo_url: o.brand?.logoUrl ?? null,
                status: o.status,
                order_type: o.orderType ?? null,
                table_number: o.tableNumber ?? null,
                notes: o.notes ?? null,
                placed_at: o.placedAt?.toISOString() ?? null,
                customer_name: o.customerName ?? null,
                customer_phone: o.customerPhone ?? null,
                cashier_name:
                    (o.creator as { name?: string } | undefined)?.name ?? null,
                payment_method: invoicePaymentMethod(o.payments),
                subtotal: Number(o.subtotal),
                discount_amount: Number(o.discountAmount),
                promo_discount_amount: Number(o.promoDiscountAmount ?? 0),
                order_discount_amount: Number(o.orderDiscountAmount ?? 0),
                coupon_discount_amount: Number(o.couponDiscountAmount ?? 0),
                card_discount_amount: Number(o.cardDiscountAmount ?? 0),
                discount_code: o.discountCode ?? null,
                tax_amount: Number(o.taxAmount),
                tax_rate: effectiveTaxRate(o),
                tax_basis: o.taxBasis ?? null,
                service_charge: Number(o.serviceCharge),
                delivery_fee: Number(o.deliveryFee),
                delivery_tier: o.deliveryTier ?? null,
                delivery_eta_min_minutes: o.deliveryEtaMinMinutes ?? null,
                delivery_eta_max_minutes: o.deliveryEtaMaxMinutes ?? null,
                total_amount: Number(o.totalAmount),
                items:
                    [...(o.orderItems ?? [])]
                        .sort((a, b) => a.id - b.id)
                        .map((oi) => ({
                            id: oi.id,
                            name_snapshot:
                                oi.nameSnapshot ??
                                (oi.menuItem as { name?: string } | null)?.name,
                            quantity: oi.quantity,
                            notes: oi.notes ?? null,
                            unit_price: Number(oi.unitPrice),
                            subtotal: Number(oi.subtotal),
                            deal_id: oi.dealId ?? null,
                            deal_slot_index: oi.dealSlotIndex ?? null,
                            deal_name: oi.dealMenuItem?.name ?? null,
                            variant_name:
                                (oi.variant as { name?: string } | null)
                                    ?.name ?? null,
                            addons:
                                oi.addons?.map((a) => ({
                                    name: (
                                        a.addon as { name?: string } | undefined
                                    )?.name,
                                    quantity: a.quantity,
                                    unit_price: Number(a.unitPrice),
                                    subtotal: Number(a.subtotal),
                                })) ?? [],
                            modifiers: (() => {
                                const mods =
                                    (
                                        oi as {
                                            modifiers?: Array<{
                                                nameSnapshot: string | null;
                                                priceSnapshot: number | null;
                                                modifier?: {
                                                    id?: number;
                                                    name?: string;
                                                    price?: number;
                                                    modifierGroup?: {
                                                        name?: string;
                                                        visibleWhenModifierIds?:
                                                            | number[]
                                                            | null;
                                                    };
                                                };
                                            }>;
                                        }
                                    ).modifiers ?? [];
                                const byId = new Map(
                                    mods
                                        .filter((x) => x.modifier?.id != null)
                                        .map((x) => [x.modifier!.id!, x]),
                                );
                                const triggerNameOf = (
                                    m: (typeof mods)[number],
                                ): string | null => {
                                    const vw =
                                        m.modifier?.modifierGroup
                                            ?.visibleWhenModifierIds;
                                    if (!vw?.length) return null;
                                    for (const id of vw) {
                                        const t = byId.get(id);
                                        if (t)
                                            return (
                                                t.nameSnapshot ??
                                                t.modifier?.name ??
                                                null
                                            );
                                    }
                                    return null;
                                };
                                return mods.map((m) => ({
                                    triggered_by: triggerNameOf(m),
                                    group:
                                        (
                                            m.modifier as
                                                | {
                                                      modifierGroup?: {
                                                          name?: string;
                                                      };
                                                  }
                                                | undefined
                                        )?.modifierGroup?.name ?? null,
                                    name:
                                        m.nameSnapshot ??
                                        (
                                            m.modifier as
                                                | { name?: string }
                                                | undefined
                                        )?.name ??
                                        null,
                                    unit_price:
                                        m.priceSnapshot != null
                                            ? Number(m.priceSnapshot)
                                            : Number(
                                                  (
                                                      m.modifier as
                                                          | { price?: number }
                                                          | undefined
                                                  )?.price ?? 0,
                                              ),
                                }));
                            })(),
                            category:
                                (
                                    oi.menuItem as {
                                        category?: { name: string };
                                    } | null
                                )?.category?.name ?? null,
                        })) ?? [],
                loyalty_points_earned: o.loyaltyPointsEarned ?? 0,
                loyalty_points_redeemed: o.loyaltyPointsRedeemed ?? 0,
            })),
        };
    }

    /** Per-brand invoice: brand, category, item breakdown for one order. */
    async getOrderInvoice(orderId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: [
                'brand',
                'branch',
                'tenant',
                'creator',
                'payments',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.menuItem.category',
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
        const invoiceTemplate =
            await this.invoiceTemplatesService.resolveActive(
                order.tenantId,
                order.brandId,
            );
        const orderWalletType = mapSourceToWalletType(order.source);
        const loyalty =
            order.customerPhone && orderWalletType != null
                ? await this.loyaltyService.getWalletBalance(
                      order.tenantId,
                      order.customerPhone,
                      orderWalletType,
                      order.brandId,
                  )
                : null;
        const loyaltyBalance = loyalty?.balance ?? 0;
        return {
            order_id: order.id,
            order_number: order.orderNumber,
            order_group_id: order.orderGroupId ?? null,
            brand: order.brand
                ? {
                      id: order.brand.id,
                      name: order.brand.name,
                      logo_url: order.brand.logoUrl ?? null,
                  }
                : null,
            branch: order.branch
                ? { id: order.branch.id, name: order.branch.name }
                : null,
            order_type: order.orderType,
            table_number: order.tableNumber,
            notes: order.notes ?? null,
            placed_at: order.placedAt?.toISOString() ?? null,
            customer_name: order.customerName ?? null,
            customer_phone: order.customerPhone ?? null,
            cashier_name:
                (order.creator as { name?: string } | undefined)?.name ?? null,
            payment_method: invoicePaymentMethod(order.payments),
            items:
                [...(order.orderItems ?? [])]
                    .sort((a, b) => a.id - b.id)
                    .map((oi) => ({
                        category:
                            (
                                oi.menuItem as {
                                    category?: { name: string };
                                } | null
                            )?.category?.name ?? null,
                        name:
                            oi.nameSnapshot ??
                            (oi.menuItem as { name?: string } | null)?.name,
                        quantity: oi.quantity,
                        notes: oi.notes ?? null,
                        unit_price: Number(oi.unitPrice),
                        subtotal: Number(oi.subtotal),
                        deal_id: oi.dealId ?? null,
                        deal_slot_index: oi.dealSlotIndex ?? null,
                        deal_name: oi.dealMenuItem?.name ?? null,
                        variant_name:
                            (oi.variant as { name?: string } | null)?.name ??
                            null,
                        addons:
                            oi.addons?.map((a) => ({
                                name: (a.addon as { name?: string } | undefined)
                                    ?.name,
                                quantity: a.quantity,
                                unit_price: Number(a.unitPrice),
                                subtotal: Number(a.subtotal),
                            })) ?? [],
                        modifiers: (() => {
                            const mods =
                                (
                                    oi as {
                                        modifiers?: Array<{
                                            nameSnapshot: string | null;
                                            priceSnapshot: number | null;
                                            modifier?: {
                                                id?: number;
                                                name?: string;
                                                price?: number;
                                                modifierGroup?: {
                                                    name?: string;
                                                    visibleWhenModifierIds?:
                                                        | number[]
                                                        | null;
                                                };
                                            };
                                        }>;
                                    }
                                ).modifiers ?? [];
                            // Conditional chooser lines (e.g. "Choose your Meal Drink") nest
                            // under the selected option that made them visible, so the receipt
                            // reads "Meal +130 -> milkshake upgrade +250" instead of two
                            // unrelated drink lines.
                            const byId = new Map(
                                mods
                                    .filter((x) => x.modifier?.id != null)
                                    .map((x) => [x.modifier!.id!, x]),
                            );
                            const triggerNameOf = (
                                m: (typeof mods)[number],
                            ): string | null => {
                                const vw =
                                    m.modifier?.modifierGroup
                                        ?.visibleWhenModifierIds;
                                if (!vw?.length) return null;
                                for (const id of vw) {
                                    const t = byId.get(id);
                                    if (t)
                                        return (
                                            t.nameSnapshot ??
                                            t.modifier?.name ??
                                            null
                                        );
                                }
                                return null;
                            };
                            return mods.map((m) => ({
                                triggered_by: triggerNameOf(m),
                                group:
                                    (
                                        m.modifier as
                                            | {
                                                  modifierGroup?: {
                                                      name?: string;
                                                  };
                                              }
                                            | undefined
                                    )?.modifierGroup?.name ?? null,
                                name:
                                    m.nameSnapshot ??
                                    (
                                        m.modifier as
                                            | { name?: string }
                                            | undefined
                                    )?.name ??
                                    null,
                                unit_price:
                                    m.priceSnapshot != null
                                        ? Number(m.priceSnapshot)
                                        : Number(
                                              (
                                                  m.modifier as
                                                      | { price?: number }
                                                      | undefined
                                              )?.price ?? 0,
                                          ),
                            }));
                        })(),
                    })) ?? [],
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            promo_discount_amount: Number(order.promoDiscountAmount ?? 0),
            order_discount_amount: Number(order.orderDiscountAmount ?? 0),
            coupon_discount_amount: Number(order.couponDiscountAmount ?? 0),
            card_discount_amount: Number(order.cardDiscountAmount ?? 0),
            discount_code: order.discountCode ?? null,
            tax_amount: Number(order.taxAmount),
            tax_rate: effectiveTaxRate(order),
            tax_basis: order.taxBasis ?? null,
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            delivery_tier: order.deliveryTier ?? null,
            delivery_eta_min_minutes: order.deliveryEtaMinMinutes ?? null,
            delivery_eta_max_minutes: order.deliveryEtaMaxMinutes ?? null,
            total_amount: Number(order.totalAmount),
            loyalty_points_earned: order.loyaltyPointsEarned ?? 0,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            loyalty_points_remaining: Number(loyaltyBalance ?? 0),
            currency: order.tenant?.defaultCurrency ?? null,
            header: {
                legal_name:
                    order.tenant?.legalName ?? order.tenant?.name ?? null,
                tenant_name: order.tenant?.name ?? null,
                branch_name: order.branch?.name ?? null,
                address: order.branch?.address ?? null,
                phone: order.branch?.phone ?? null,
                email: order.branch?.email ?? null,
            },
            template: invoiceTemplate,
        };
    }

    /** Main customer-facing invoice: breakdown by brand plus gross total. */
    async getOrderGroupMainInvoice(orderGroupId: string) {
        const group = await this.getOrderGroup(orderGroupId);
        const firstOrder = await this.orderRepo.findOne({
            where: { orderGroupId },
            relations: ['tenant', 'branch'],
        });
        const groupWalletType = firstOrder
            ? mapSourceToWalletType(firstOrder.source)
            : null;
        const groupLoyalty =
            firstOrder?.customerPhone && groupWalletType != null
                ? await this.loyaltyService.getWalletBalance(
                      firstOrder.tenantId,
                      firstOrder.customerPhone,
                      groupWalletType,
                      firstOrder.brandId,
                  )
                : null;
        const groupLoyaltyBalance = groupLoyalty?.balance ?? 0;
        const grossTotal = group.orders.reduce(
            (sum, o) => sum + Number(o.total_amount),
            0,
        );
        // Resolve the invoice template. A group is usually single-brand (POS/app);
        // if it spans brands (web split), fall back to the tenant-wide template.
        const brandIds = [...new Set(group.orders.map((o) => o.brand_id))];
        const templateBrandId = brandIds.length === 1 ? brandIds[0] : null;
        const template = await this.invoiceTemplatesService.resolveActive(
            firstOrder?.tenantId ?? null,
            templateBrandId,
        );
        return {
            order_group_id: orderGroupId,
            orders: group.orders.map((o) => ({
                order_id: o.id,
                order_number: o.order_number,
                brand_name: o.brand_name,
                brand_logo_url: o.brand_logo_url,
                order_type: o.order_type,
                table_number: o.table_number,
                notes: o.notes ?? null,
                placed_at: o.placed_at,
                customer_name: o.customer_name,
                customer_phone: o.customer_phone,
                cashier_name: o.cashier_name,
                payment_method: o.payment_method ?? null,
                items: o.items,
                subtotal: o.subtotal,
                discount_amount: o.discount_amount,
                promo_discount_amount: o.promo_discount_amount,
                order_discount_amount: o.order_discount_amount,
                coupon_discount_amount: o.coupon_discount_amount,
                card_discount_amount: o.card_discount_amount,
                discount_code: o.discount_code,
                tax_amount: o.tax_amount,
                tax_rate: o.tax_rate,
                tax_basis: o.tax_basis,
                service_charge: o.service_charge,
                delivery_fee: o.delivery_fee,
                delivery_tier: o.delivery_tier ?? null,
                delivery_eta_min_minutes: o.delivery_eta_min_minutes ?? null,
                delivery_eta_max_minutes: o.delivery_eta_max_minutes ?? null,
                total_amount: o.total_amount,
                loyalty_points_earned: o.loyalty_points_earned ?? 0,
                loyalty_points_redeemed: o.loyalty_points_redeemed ?? 0,
                loyalty_points_remaining: Number(groupLoyaltyBalance ?? 0),
            })),
            gross_total: Math.round(grossTotal * 100) / 100,
            loyalty_points_remaining: Number(groupLoyaltyBalance ?? 0),
            currency: firstOrder?.tenant?.defaultCurrency ?? null,
            header: {
                legal_name:
                    firstOrder?.tenant?.legalName ??
                    firstOrder?.tenant?.name ??
                    null,
                tenant_name: firstOrder?.tenant?.name ?? null,
                branch_name: firstOrder?.branch?.name ?? null,
                address: firstOrder?.branch?.address ?? null,
                phone: firstOrder?.branch?.phone ?? null,
                email: firstOrder?.branch?.email ?? null,
            },
            template,
        };
    }

    async updateStatus(
        id: number,
        tenantId: number | null,
        status: string,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
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
        if (
            allowedBrandIds != null &&
            (order.brandId == null || !allowedBrandIds.includes(order.brandId))
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }

        // Atomic, lock-serialised transition. Only the caller that actually changes
        // the status observes a non-null previousStatus and runs the side effects,
        // so a KDS+POS race or a double-click cannot double-earn loyalty or
        // double-count shift cash, and a complete-vs-cancel race resolves
        // deterministically (the loser is a no-op). completed_at/cancelled_at are set
        // in the same atomic UPDATE; completed_at is cleared when leaving 'completed'.
        const previousStatus = await transitionStatus(
            this.dataSource,
            'orders',
            id,
            status,
            {
                set: (cur) => ({
                    completed_at:
                        status === 'completed'
                            ? raw('now()')
                            : cur === 'completed'
                              ? raw('NULL')
                              : raw('completed_at'),
                    cancelled_at:
                        status === 'cancelled'
                            ? raw('now()')
                            : cur === 'cancelled'
                              ? raw('NULL')
                              : raw('cancelled_at'),
                }),
            },
        );

        if (previousStatus !== null) {
            // Reflect the committed transition on the in-memory entity for the
            // downstream helpers that read order.status.
            order.status = status;
            const leftCompleted =
                previousStatus === 'completed' && status !== 'completed';
            if (leftCompleted) {
                await this.loyaltyService.revokeEarnedPoints(id);
            }
            if (status === 'completed') {
                await this.loyaltyService.earnOnOrderComplete(id);
                await this.shiftsService.addCompletedOrderAmount(
                    order.branchId,
                    Number(order.totalAmount),
                    order.brandId ?? null,
                );
            } else if (status === 'cancelled') {
                // Reverse inventory consumption allocations (if any).
                try {
                    await this.inventoryConsumptionService.reverseConsumptionForOrder(
                        order.id,
                        null,
                    );
                } catch {
                    void 0;
                }
                // Free any coupon redemption booked against this order (restores
                // per-customer/global usage and re-activates the voucher).
                try {
                    await this.reverseCouponRealizations(
                        order.id,
                        'order_cancelled',
                    );
                } catch {
                    void 0;
                }
            }
            await this.maybeAutoAssignDeliveryOnPreparing(
                order,
                previousStatus,
            );
            if (status === 'cancelled' && previousStatus !== 'cancelled') {
                this.pushNotificationService.notifyConsumerOrder(
                    order,
                    'cancelled',
                );
            }
            // Parity with the kitchen accept flow: notify the customer when an
            // order is accepted (e.g. a till accepting an online order).
            if (status === 'accepted' && previousStatus !== 'accepted') {
                this.pushNotificationService.notifyConsumerOrder(
                    order,
                    'kitchen_accepted',
                );
            }
        }
        return this.findForAdmin(id, tenantId);
    }

    async findForAdmin(
        id: number,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
            relations: [
                'branch',
                'brand',
                'creator',
                'rider',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.variant',
                'orderItems.addons',
                'orderItems.addons.addon',
                'orderItems.modifiers',
                'orderItems.modifiers.modifier',
                'orderItems.modifiers.modifier.modifierGroup',
                'orderItems.dealMenuItem',
                'payments',
            ],
        });
        if (
            order &&
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(order.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (
            order &&
            allowedBrandIds != null &&
            (order.brandId == null || !allowedBrandIds.includes(order.brandId))
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        if (!order) throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_type: order.orderType,
            order_group_id: order.orderGroupId ?? null,
            table_number: order.tableNumber,
            notes: order.notes ?? null,
            customer_name: order.customerName,
            customer_phone: order.customerPhone,
            delivery_address: order.deliveryAddress,
            status: order.status,
            rider_id: order.riderId ?? null,
            rider: order.rider
                ? { id: order.rider.id, name: order.rider.name }
                : null,
            delivery_status: order.deliveryStatus ?? null,
            delivery_failed_reason: order.deliveryFailedReason ?? null,
            source: order.source,
            subtotal: Number(order.subtotal),
            discount_amount: Number(order.discountAmount),
            discount_code: order.discountCode,
            loyalty_points_earned: order.loyaltyPointsEarned ?? 0,
            loyalty_points_redeemed: order.loyaltyPointsRedeemed ?? 0,
            tax_amount: Number(order.taxAmount),
            service_charge: Number(order.serviceCharge),
            delivery_fee: Number(order.deliveryFee),
            delivery_tier: order.deliveryTier ?? null,
            delivery_eta_min_minutes: order.deliveryEtaMinMinutes ?? null,
            delivery_eta_max_minutes: order.deliveryEtaMaxMinutes ?? null,
            total_amount: Number(order.totalAmount),
            placed_at: order.placedAt?.toISOString() ?? null,
            completed_at: order.completedAt?.toISOString() ?? null,
            branch: order.branch
                ? {
                      id: order.branch.id,
                      name: order.branch.name,
                      code: order.branch.code,
                  }
                : null,
            brand: order.brand
                ? { id: order.brand.id, name: order.brand.name }
                : null,
            creator: order.creator
                ? { id: order.creator.id, name: order.creator.name }
                : null,
            brand_id: order.brandId ?? null,
            items:
                [...(order.orderItems ?? [])]
                    .sort((a, b) => a.id - b.id)
                    .map((oi) => ({
                        id: oi.id,
                        brand_id: oi.brandId ?? null,
                        name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                        price_snapshot:
                            oi.priceSnapshot != null
                                ? Number(oi.priceSnapshot)
                                : Number(oi.unitPrice),
                        quantity: oi.quantity,
                        notes: oi.notes ?? null,
                        unit_price: Number(oi.unitPrice),
                        subtotal: Number(oi.subtotal),
                        deal_id: oi.dealId ?? null,
                        deal_slot_index: oi.dealSlotIndex ?? null,
                        deal_name: oi.dealMenuItem?.name ?? null,
                        variant_id: oi.variantId ?? null,
                        variant_name:
                            (oi as { variant?: { name: string } }).variant
                                ?.name ?? null,
                        addons:
                            oi.addons?.map((a) => ({
                                name: a.addon?.name,
                                unit_price: Number(a.unitPrice),
                                quantity: a.quantity,
                                subtotal: Number(a.subtotal),
                            })) ?? [],
                        modifiers: (() => {
                            const mods =
                                (
                                    oi as {
                                        modifiers?: Array<{
                                            nameSnapshot: string | null;
                                            priceSnapshot: number | null;
                                            modifier?: {
                                                id?: number;
                                                name?: string;
                                                price?: number;
                                                modifierGroup?: {
                                                    name?: string;
                                                    visibleWhenModifierIds?:
                                                        | number[]
                                                        | null;
                                                };
                                            };
                                        }>;
                                    }
                                ).modifiers ?? [];
                            // Conditional chooser lines (e.g. "Choose your Meal Drink") nest
                            // under the selected option that made them visible, so the receipt
                            // reads "Meal +130 -> milkshake upgrade +250" instead of two
                            // unrelated drink lines.
                            const byId = new Map(
                                mods
                                    .filter((x) => x.modifier?.id != null)
                                    .map((x) => [x.modifier!.id!, x]),
                            );
                            const triggerNameOf = (
                                m: (typeof mods)[number],
                            ): string | null => {
                                const vw =
                                    m.modifier?.modifierGroup
                                        ?.visibleWhenModifierIds;
                                if (!vw?.length) return null;
                                for (const id of vw) {
                                    const t = byId.get(id);
                                    if (t)
                                        return (
                                            t.nameSnapshot ??
                                            t.modifier?.name ??
                                            null
                                        );
                                }
                                return null;
                            };
                            return mods.map((m) => ({
                                triggered_by: triggerNameOf(m),
                                group:
                                    (
                                        m.modifier as
                                            | {
                                                  modifierGroup?: {
                                                      name?: string;
                                                  };
                                              }
                                            | undefined
                                    )?.modifierGroup?.name ?? null,
                                name:
                                    m.nameSnapshot ??
                                    (
                                        m.modifier as
                                            | { name?: string }
                                            | undefined
                                    )?.name ??
                                    null,
                                unit_price:
                                    m.priceSnapshot != null
                                        ? Number(m.priceSnapshot)
                                        : Number(
                                              (
                                                  m.modifier as
                                                      | { price?: number }
                                                      | undefined
                                              )?.price ?? 0,
                                          ),
                            }));
                        })(),
                    })) ?? [],
            payments:
                order.payments?.map((p) => ({
                    id: p.id,
                    method: p.paymentMethod,
                    amount: Number(p.amount),
                    status: p.status,
                    paid_at: p.paidAt?.toISOString() ?? null,
                })) ?? [],
        };
    }

    async findAllAdmin(
        tenantId: number | null,
        filters: {
            branch_id?: number;
            brand_id?: number;
            status?: string;
            order_type?: string;
            date_from?: string;
            date_to?: string;
            has_rider?: boolean;
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
        if (
            allowedBrandIds != null &&
            filters.brand_id != null &&
            !allowedBrandIds.includes(filters.brand_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.branch', 'b')
            .leftJoinAndSelect('o.brand', 'brand')
            .leftJoinAndSelect('o.creator', 'c')
            .leftJoinAndSelect('o.rider', 'rider')
            .leftJoinAndSelect('o.orderItems', 'oi')
            .leftJoinAndSelect('oi.menuItem', 'mi')
            .orderBy('o.createdAt', 'DESC')
            .take(50);

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
        // Brand-locked users only ever see their own brand's orders.
        if (allowedBrandIds != null) {
            qb.andWhere('o.brandId IN (:...allowedBrandIds)', {
                allowedBrandIds,
            });
        }
        if (filters.branch_id)
            qb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        if (filters.brand_id)
            qb.andWhere('o.brandId = :filterBrandId', {
                filterBrandId: filters.brand_id,
            });
        if (filters.status)
            qb.andWhere('o.status = :status', { status: filters.status });
        if (
            filters.order_type &&
            ['delivery', 'dine_in', 'takeaway'].includes(filters.order_type)
        ) {
            qb.andWhere('o.orderType = :orderType', {
                orderType: filters.order_type,
            });
        }
        if (filters.date_from)
            qb.andWhere('date(o.placed_at) >= :dateFrom', {
                dateFrom: filters.date_from,
            });
        if (filters.date_to)
            qb.andWhere('date(o.placed_at) <= :dateTo', {
                dateTo: filters.date_to,
            });
        if (filters.has_rider === true) qb.andWhere('o.riderId IS NOT NULL');

        return qb.getMany();
    }

    /** List users with Rider role for the tenant (from branch_users for tenant's branches). */
    /**
     * Active riders linked to the tenant's brand(s) via rider_brands (the single
     * source of truth for availability). A brand-locked caller is clamped to
     * their own brands; an explicit brandId narrows further (and is rejected if
     * outside the caller's scope). Riders with no brand link never appear.
     */
    async listRiders(
        tenantId: number,
        allowedBrandIds?: number[] | null,
        brandId?: number | null,
    ) {
        const brandScope = resolveRiderBrandScope(brandId, allowedBrandIds);
        const params: unknown[] = [tenantId];
        let brandFilterSql = '';
        if (brandScope != null) {
            params.push(brandScope);
            brandFilterSql = ` AND rb.brand_id = ANY($2::int[])`;
        }
        const rows: Array<{
            id: number;
            name: string;
            email: string | null;
            phone: string | null;
        }> = await this.dataSource.query(
            `SELECT DISTINCT u.id, u.name, u.email, u.phone
             FROM users u
             INNER JOIN rider_brands rb ON rb.rider_user_id = u.id AND rb.tenant_id = $1${brandFilterSql}
             WHERE u.status = 'active'
             ORDER BY u.name`,
            params,
        );
        if (rows.length === 0) return [];

        const riderIds = rows.map((r) => r.id);
        const stats: Array<{
            rider_id: number;
            rating_count: string;
            rating_average: string | null;
        }> = await this.dataSource.query(
            `SELECT ror.rider_user_id AS rider_id,
                    COUNT(*)::text AS rating_count,
                    AVG(ror.stars)::text AS rating_average
             FROM rider_order_ratings ror
             INNER JOIN orders o ON o.id = ror.order_id AND o.tenant_id = $1
             WHERE ror.rider_user_id = ANY($2::int[])
             GROUP BY ror.rider_user_id`,
            [tenantId, riderIds],
        );
        const statMap = new Map<
            number,
            { rating_count: number; rating_average: number | null }
        >();
        for (const s of stats) {
            const rid = Number(s.rider_id);
            const cnt = parseInt(String(s.rating_count), 10) || 0;
            const avgRaw = s.rating_average;
            const avg =
                avgRaw != null && avgRaw !== ''
                    ? Math.round(parseFloat(String(avgRaw)) * 10) / 10
                    : null;
            statMap.set(rid, { rating_count: cnt, rating_average: avg });
        }

        return rows.map((r) => {
            const st = statMap.get(r.id);
            return {
                id: r.id,
                name: r.name,
                email: r.email ?? null,
                phone: r.phone ?? null,
                rating_count: st?.rating_count ?? 0,
                rating_average: st?.rating_average ?? null,
            };
        });
    }

    /** Assign a rider to an order. Admin only. */
    async assignRider(
        orderId: number,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, tenantId },
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
        if (order.orderType !== 'delivery') {
            throw new BadRequestException(
                'Riders can only be assigned to delivery orders',
            );
        }
        this.assertOrderBrandAllowed(order, allowedBrandIds);
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        await this.assertRiderLinkedToBrand(tenantId, order.brandId, riderId);
        // Tier-aware capacity: priority needs an idle rider; standard/saver may batch up to the
        // brand's maxBatchSize and never onto a priority-locked rider.
        const { effectiveTier, maxBatchSize } =
            await this.resolveOrderTierCap(order);
        const previousDeliveryStatus = order.deliveryStatus;
        await this.dataSource.transaction(async (manager) => {
            // Serialize every assignment for this rider so the single-active-order
            // cap check-and-set is atomic across all paths (manual + auto-dispatch).
            await advisoryXactLock(
                manager,
                AdvisoryLock.RIDER_ASSIGNMENT,
                riderId,
            );
            // Re-check capacity UNDER the lock: a concurrent assignment that committed
            // while we waited is now visible.
            const riderState = await this.getRiderActiveState(
                tenantId,
                riderId,
                order.id,
            );
            if (!riderPassesTierCap(riderState, effectiveTier, maxBatchSize)) {
                throw new BadRequestException(
                    effectiveTier === 'priority'
                        ? 'A priority order needs an idle rider; this rider already has an active order.'
                        : riderState.hasPriorityActive
                          ? 'This rider is locked to a priority delivery and cannot take another order.'
                          : `This rider is at capacity (max ${maxBatchSize} active ${maxBatchSize === 1 ? 'order' : 'orders'}).`,
                );
            }
            // Scoped, terminal-state-guarded update (not a full-entity save): never
            // assign a cancelled/completed order or clobber a concurrent status write.
            const res = await manager
                .getRepository(Order)
                .createQueryBuilder()
                .update(Order)
                .set({
                    riderId,
                    deliveryStatus: 'accepted',
                    deliveryFailedReason: null,
                })
                .where('id = :id AND status NOT IN (:...terminal)', {
                    id: order.id,
                    terminal: ['cancelled', 'completed'],
                })
                .execute();
            if (res.affected === 0) {
                throw new BadRequestException(
                    'This order can no longer be assigned (it may have been cancelled or completed).',
                );
            }
            await this.createAssignmentLedgerEntry({
                tenantId,
                branchId: order.branchId,
                orderId: order.id,
                eventType: 'manual',
                selectedRiderUserId: riderId,
                reasonCode: 'manual_assignment',
                reasonDetail: 'Assigned manually by admin',
            });
        });
        order.riderId = riderId;
        order.deliveryStatus = 'accepted';
        if (previousDeliveryStatus !== 'accepted') {
            this.pushNotificationService.notifyConsumerOrder(
                order,
                'rider_assigned',
            );
            this.pushNotificationService.notifyRiderNewAssignment(order);
        }
        return this.findForAdmin(orderId, tenantId, allowedBranchIds);
    }

    /** Change rider only while delivery_status is still 'accepted' (rider has not yet picked up). */
    async changeRider(
        orderId: number,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, tenantId },
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
        if (order.orderType !== 'delivery') {
            throw new BadRequestException(
                'Riders can only be assigned to delivery orders',
            );
        }
        if (order.deliveryStatus !== 'accepted') {
            throw new BadRequestException(
                'Rider can only be changed before they have picked up the order',
            );
        }
        this.assertOrderBrandAllowed(order, allowedBrandIds);
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        await this.assertRiderLinkedToBrand(tenantId, order.brandId, riderId);
        await this.dataSource.transaction(async (manager) => {
            // Serialize on the rider so the single-active-order check-and-set is atomic.
            await advisoryXactLock(
                manager,
                AdvisoryLock.RIDER_ASSIGNMENT,
                riderId,
            );
            // A rider carries exactly one order at a time (excluding this order,
            // which is being reassigned away from its current rider).
            const activeElsewhere = await this.orderRepo
                .createQueryBuilder('o')
                .where('o.tenantId = :tenantId', { tenantId })
                .andWhere('o.riderId = :riderId', { riderId })
                .andWhere("o.deliveryStatus IN ('accepted', 'picked_up')")
                .andWhere('o.id != :orderId', { orderId })
                .getCount();
            if (activeElsewhere > 0) {
                throw new BadRequestException(
                    'This rider already has an active order. A rider can deliver only one order at a time.',
                );
            }
            // Scoped update guarded on still-accepted (pre-pickup) status.
            const res = await manager
                .getRepository(Order)
                .createQueryBuilder()
                .update(Order)
                .set({ riderId })
                .where("id = :id AND delivery_status = 'accepted'", {
                    id: order.id,
                })
                .execute();
            if (res.affected === 0) {
                throw new BadRequestException(
                    'Rider can only be changed before they have picked up the order',
                );
            }
            await this.createAssignmentLedgerEntry({
                tenantId,
                branchId: order.branchId,
                orderId: order.id,
                eventType: 'change',
                selectedRiderUserId: riderId,
                reasonCode: 'manual_change',
                reasonDetail: 'Rider changed manually by admin',
            });
        });
        order.riderId = riderId;
        this.pushNotificationService.notifyRiderNewAssignment(order);
        return this.findForAdmin(orderId, tenantId, allowedBranchIds);
    }

    /** Assign the same rider to all orders in a group. Admin only. */
    async assignRiderToGroup(
        orderGroupId: string,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        const orders = await this.orderRepo.find({
            where: { orderGroupId, tenantId },
        });
        if (orders.length === 0) {
            throw new NotFoundException('Order group not found');
        }
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            const notAllowed = orders.filter(
                (o) => !allowedBranchIds.includes(o.branchId),
            );
            if (notAllowed.length > 0) {
                throw new ForbiddenException(
                    'You do not have access to some orders in this group',
                );
            }
        }
        const nonDelivery = orders.filter((o) => o.orderType !== 'delivery');
        if (nonDelivery.length > 0) {
            throw new BadRequestException(
                'Riders can only be assigned when every order in the group is a delivery order',
            );
        }
        // A rider carries exactly one order at a time — a multi-order group
        // (one order per brand) needs a separate rider per order.
        if (orders.length > 1) {
            throw new BadRequestException(
                'A rider can deliver only one order at a time. Assign a separate rider to each order in this group.',
            );
        }
        for (const order of orders) {
            this.assertOrderBrandAllowed(order, allowedBrandIds);
            await this.assertRiderLinkedToBrand(
                tenantId,
                order.brandId,
                riderId,
            );
        }
        await this.dataSource.transaction(async (manager) => {
            // Serialize on the rider so the single-active-order check-and-set is atomic.
            await advisoryXactLock(
                manager,
                AdvisoryLock.RIDER_ASSIGNMENT,
                riderId,
            );
            const groupActiveCount = await this.orderRepo
                .createQueryBuilder('o')
                .where('o.tenantId = :tenantId', { tenantId })
                .andWhere('o.riderId = :riderId', { riderId })
                .andWhere("o.deliveryStatus IN ('accepted', 'picked_up')")
                .andWhere('o.orderGroupId != :orderGroupId', { orderGroupId })
                .getCount();
            if (groupActiveCount > 0) {
                throw new BadRequestException(
                    'This rider already has an active order. A rider can deliver only one order at a time.',
                );
            }
            for (const order of orders) {
                const res = await manager
                    .getRepository(Order)
                    .createQueryBuilder()
                    .update(Order)
                    .set({
                        riderId,
                        deliveryStatus: 'accepted',
                        deliveryFailedReason: null,
                    })
                    .where('id = :id AND status NOT IN (:...terminal)', {
                        id: order.id,
                        terminal: ['cancelled', 'completed'],
                    })
                    .execute();
                if (res.affected === 0) {
                    throw new BadRequestException(
                        'This order can no longer be assigned (it may have been cancelled or completed).',
                    );
                }
                await this.createAssignmentLedgerEntry({
                    tenantId,
                    branchId: order.branchId,
                    orderId: order.id,
                    eventType: 'manual',
                    selectedRiderUserId: riderId,
                    reasonCode: 'manual_group_assignment',
                    reasonDetail: `Assigned manually for group ${orderGroupId}`,
                });
            }
        });
        for (const order of orders) {
            const previousDeliveryStatus = order.deliveryStatus;
            order.riderId = riderId;
            order.deliveryStatus = 'accepted';
            if (previousDeliveryStatus !== 'accepted') {
                this.pushNotificationService.notifyConsumerOrder(
                    order,
                    'rider_assigned',
                );
                this.pushNotificationService.notifyRiderNewAssignment(order);
            }
        }
        return {
            order_group_id: orderGroupId,
            updated_count: orders.length,
            orders: await Promise.all(
                orders.map((o) =>
                    this.findForAdmin(o.id, tenantId, allowedBranchIds),
                ),
            ),
        };
    }

    /** Change rider for entire group only while all orders have delivery_status 'accepted' (not yet picked up). */
    async changeRiderForGroup(
        orderGroupId: string,
        tenantId: number,
        riderId: number,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const orders = await this.orderRepo.find({
            where: { orderGroupId, tenantId },
        });
        if (orders.length === 0) {
            throw new NotFoundException('Order group not found');
        }
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            const notAllowed = orders.filter(
                (o) => !allowedBranchIds.includes(o.branchId),
            );
            if (notAllowed.length > 0) {
                throw new ForbiddenException(
                    'You do not have access to some orders in this group',
                );
            }
        }
        const nonDeliveryGroup = orders.filter(
            (o) => o.orderType !== 'delivery',
        );
        if (nonDeliveryGroup.length > 0) {
            throw new BadRequestException(
                'Riders can only be assigned when every order in the group is a delivery order',
            );
        }
        const notAccepted = orders.filter(
            (o) => o.deliveryStatus !== 'accepted',
        );
        if (notAccepted.length > 0) {
            throw new BadRequestException(
                'Rider can only be changed for the group before any order has been picked up by the rider',
            );
        }
        const riders = await this.listRiders(tenantId);
        if (!riders.some((r) => r.id === riderId)) {
            throw new BadRequestException('Invalid rider for this tenant');
        }
        for (const order of orders) {
            this.assertOrderBrandAllowed(order, allowedBrandIds);
            await this.assertRiderLinkedToBrand(
                tenantId,
                order.brandId,
                riderId,
            );
        }
        await this.dataSource.transaction(async (manager) => {
            // Serialize on the rider so the single-active-order check-and-set is atomic.
            await advisoryXactLock(
                manager,
                AdvisoryLock.RIDER_ASSIGNMENT,
                riderId,
            );
            // A rider carries exactly one order at a time — reject if the target
            // rider already has an active order outside this group.
            const activeElsewhere = await this.orderRepo
                .createQueryBuilder('o')
                .where('o.tenantId = :tenantId', { tenantId })
                .andWhere('o.riderId = :riderId', { riderId })
                .andWhere("o.deliveryStatus IN ('accepted', 'picked_up')")
                .andWhere('o.orderGroupId != :orderGroupId', { orderGroupId })
                .getCount();
            if (activeElsewhere > 0) {
                throw new BadRequestException(
                    'This rider already has an active order. A rider can deliver only one order at a time.',
                );
            }
            for (const order of orders) {
                const res = await manager
                    .getRepository(Order)
                    .createQueryBuilder()
                    .update(Order)
                    .set({ riderId })
                    .where("id = :id AND delivery_status = 'accepted'", {
                        id: order.id,
                    })
                    .execute();
                if (res.affected === 0) {
                    throw new BadRequestException(
                        'Rider can only be changed for the group before any order has been picked up.',
                    );
                }
                await this.createAssignmentLedgerEntry({
                    tenantId,
                    branchId: order.branchId,
                    orderId: order.id,
                    eventType: 'change',
                    selectedRiderUserId: riderId,
                    reasonCode: 'manual_group_change',
                    reasonDetail: `Rider changed manually for group ${orderGroupId}`,
                });
            }
        });
        return {
            order_group_id: orderGroupId,
            updated_count: orders.length,
        };
    }

    /** Orders assigned to this rider (for rider app). */
    async findAllForRider(riderUserId: number) {
        const orders = await this.orderRepo.find({
            where: { riderId: riderUserId },
            relations: [
                'branch',
                'brand',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
            order: { placedAt: 'DESC' },
        });
        return orders.map((o) => ({
            id: o.id,
            order_number: o.orderNumber,
            order_group_id: o.orderGroupId ?? null,
            status: o.status,
            delivery_status: o.deliveryStatus ?? null,
            delivery_failed_reason: o.deliveryFailedReason ?? null,
            customer_name: o.customerName,
            customer_phone: o.customerPhone,
            delivery_address: o.deliveryAddress,
            delivery_latitude:
                o.deliveryLatitude != null ? Number(o.deliveryLatitude) : null,
            delivery_longitude:
                o.deliveryLongitude != null
                    ? Number(o.deliveryLongitude)
                    : null,
            branch_latitude:
                o.branchLatitude != null ? Number(o.branchLatitude) : null,
            branch_longitude:
                o.branchLongitude != null ? Number(o.branchLongitude) : null,
            placed_at: o.placedAt?.toISOString() ?? null,
            total_amount: Number(o.totalAmount),
            branch: o.branch
                ? {
                      id: o.branch.id,
                      name: o.branch.name,
                      address: o.branch.address,
                      // Backward-compatible keys (existing clients may use them)
                      latitude:
                          o.branch.latitude != null
                              ? Number(o.branch.latitude)
                              : null,
                      longitude:
                          o.branch.longitude != null
                              ? Number(o.branch.longitude)
                              : null,
                  }
                : null,
            brand_name: o.brand?.name ?? null,
            items:
                o.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    quantity: oi.quantity,
                    notes: oi.notes ?? null,
                    unit_price: Number(oi.unitPrice),
                })) ?? [],
        }));
    }

    /** Single order for rider (must be assigned to them). */
    async findForRider(orderId: number, riderUserId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, riderId: riderUserId },
            relations: [
                'branch',
                'brand',
                'orderItems',
                'orderItems.menuItem',
                'orderItems.addons',
                'orderItems.addons.addon',
            ],
        });
        if (!order) throw new NotFoundException('Order not found');
        return {
            id: order.id,
            order_number: order.orderNumber,
            order_group_id: order.orderGroupId ?? null,
            status: order.status,
            delivery_status: order.deliveryStatus ?? null,
            delivery_failed_reason: order.deliveryFailedReason ?? null,
            customer_name: order.customerName,
            customer_phone: order.customerPhone,
            delivery_address: order.deliveryAddress,
            delivery_latitude:
                order.deliveryLatitude != null
                    ? Number(order.deliveryLatitude)
                    : null,
            delivery_longitude:
                order.deliveryLongitude != null
                    ? Number(order.deliveryLongitude)
                    : null,
            branch_latitude:
                order.branchLatitude != null
                    ? Number(order.branchLatitude)
                    : null,
            branch_longitude:
                order.branchLongitude != null
                    ? Number(order.branchLongitude)
                    : null,
            placed_at: order.placedAt?.toISOString() ?? null,
            total_amount: Number(order.totalAmount),
            branch: order.branch
                ? {
                      id: order.branch.id,
                      name: order.branch.name,
                      address: order.branch.address,
                      // Backward-compatible keys (existing clients may use them)
                      latitude:
                          order.branch.latitude != null
                              ? Number(order.branch.latitude)
                              : null,
                      longitude:
                          order.branch.longitude != null
                              ? Number(order.branch.longitude)
                              : null,
                  }
                : null,
            brand_name: order.brand?.name ?? null,
            items:
                order.orderItems?.map((oi) => ({
                    id: oi.id,
                    name_snapshot: oi.nameSnapshot ?? oi.menuItem?.name,
                    quantity: oi.quantity,
                    notes: oi.notes ?? null,
                    unit_price: Number(oi.unitPrice),
                    addons:
                        oi.addons?.map((a) => ({
                            name: a.addon?.name,
                            quantity: a.quantity,
                        })) ?? [],
                })) ?? [],
        };
    }

    /** Rider updates delivery status. Allowed: accepted, picked_up, delivered, delivery_failed (reason required). */
    async updateDeliveryStatus(
        orderId: number,
        riderUserId: number,
        deliveryStatus: string,
        deliveryFailedReason?: string | null,
    ) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, riderId: riderUserId },
        });
        if (!order) throw new NotFoundException('Order not found');
        const previousDeliveryStatus = order.deliveryStatus;
        const allowed = [
            'accepted',
            'picked_up',
            'delivered',
            'delivery_failed',
        ];
        if (!allowed.includes(deliveryStatus)) {
            throw new BadRequestException(
                `Invalid delivery status. Allowed: ${allowed.join(', ')}`,
            );
        }
        if (deliveryStatus === 'delivery_failed') {
            const reason =
                typeof deliveryFailedReason === 'string'
                    ? deliveryFailedReason.trim()
                    : '';
            if (!reason) {
                throw new BadRequestException(
                    'Delivery failed reason is required',
                );
            }
            order.deliveryFailedReason = reason;
        } else {
            order.deliveryFailedReason = null;
        }
        order.deliveryStatus = deliveryStatus;
        // Scoped update for the delivery fields — avoids a full-entity save
        // clobbering a concurrent order mutation (lost update).
        await this.orderRepo.update(
            { id: order.id },
            {
                deliveryStatus,
                deliveryFailedReason: order.deliveryFailedReason ?? null,
            },
        );
        if (deliveryStatus === 'delivered') {
            // Atomic completion transition: loyalty earn + shift-cash credit fire
            // exactly once even if a POS 'complete' or a retried 'delivered' event
            // races this delivery confirmation.
            const prevStatus = await transitionStatus(
                this.dataSource,
                'orders',
                order.id,
                'completed',
                { set: () => ({ completed_at: raw('now()') }) },
            );
            order.status = 'completed';
            if (prevStatus !== null) {
                await this.loyaltyService.earnOnOrderComplete(order.id);
                await this.shiftsService.addCompletedOrderAmount(
                    order.branchId,
                    Number(order.totalAmount),
                    order.brandId ?? null,
                );
            }
        }
        if (
            deliveryStatus === 'picked_up' &&
            previousDeliveryStatus !== 'picked_up'
        ) {
            this.pushNotificationService.notifyConsumerOrder(
                order,
                'picked_up',
            );
        } else if (
            deliveryStatus === 'delivered' &&
            previousDeliveryStatus !== 'delivered'
        ) {
            this.pushNotificationService.notifyConsumerOrder(
                order,
                'delivered',
            );
        }
        return this.findForRider(orderId, riderUserId);
    }

    /**
     * Quote/preview: same calculation as createOrder but no persistence.
     * Returns original amount (subtotal), discount_amount, tax, service_charge, delivery_fee, total_amount.
     */
    async quote(
        dto: {
            branch_id: number;
            order_type: string;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                modifiers?: { modifier_id: number; quantity?: number }[];
            }[];
            discount_code?: string;
            customer_phone?: string;
            loyalty_points_to_redeem?: number;
            /** Tender split for per-tender GST (cash vs card). Omit → cash rate. */
            payment_split?: { cash_amount?: number; card_amount?: number };
            /** Selected bank card (bank_cards id) for card-linked discounts. */
            bank_card_id?: number | null;
            /** Drop-off coords — required to price/return delivery tiers. */
            latitude?: number;
            longitude?: number;
            /** Optional chosen tier; when omitted the scalar delivery_fee uses the default tier. */
            delivery_tier?: string;
        },
        tenantId: number,
        source: 'pos' | 'consumer_app' | 'consumer_web' | 'kiosk' = 'pos',
        /** Brand lock of the requesting user (null = unrestricted). */
        allowedBrandIds: number[] | null = null,
    ) {
        const branch = await this.branchRepo.findOne({
            where: { id: dto.branch_id },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        type BranchWithBrands = Branch & { branchBrands?: unknown[] };
        if (!branch || !(branch as BranchWithBrands).branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        const expandedQuoteItems = await this.expandDealItems(
            dto.branch_id,
            dto.items as Array<
                | {
                      menu_item_id: number;
                      quantity?: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      branch_id?: number;
                  }
                | {
                      deal_menu_item_id: number;
                      quantity?: number;
                      components: Array<{
                          slot_index: number;
                          menu_item_id: number;
                          quantity?: number;
                          variant_id?: number;
                          addons?: { addon_id: number; quantity?: number }[];
                          modifiers?: {
                              modifier_id: number;
                              quantity?: number;
                          }[];
                      }>;
                      branch_id?: number;
                  }
            >,
            dto.order_type,
        );
        const { subtotal, lineDetails, orderBrandId } =
            await this.computeSubtotalAndLinesWithBrands(
                dto.branch_id,
                expandedQuoteItems,
                dto.order_type,
            );

        // Multi-brand separation (mirrors createOrder): brand-locked users may
        // only quote their own brand; kiosk/consumer-app carts are single-brand.
        const quotedBrandIds = new Set(lineDetails.map((l) => l.brandId));
        if (allowedBrandIds != null) {
            for (const brandId of quotedBrandIds) {
                if (!allowedBrandIds.includes(brandId)) {
                    throw new ForbiddenException(
                        'This till can only sell items of its own brand.',
                    );
                }
            }
        }
        if (
            (source === 'kiosk' ||
                source === 'consumer_app' ||
                source === 'pos') &&
            quotedBrandIds.size > 1
        ) {
            throw new BadRequestException(
                'Items from different brands cannot be combined in one order. Please place a separate order per brand.',
            );
        }

        const bankCardId =
            dto.bank_card_id != null ? Number(dto.bank_card_id) : null;
        const fullCardPayment =
            (Number(dto.payment_split?.cash_amount) || 0) <= 0 &&
            (Number(dto.payment_split?.card_amount) || 0) > 0;
        const offerSettings = resolveOfferSettings(
            (tenant as { offerSettings?: OfferSettings | null })
                .offerSettings ?? null,
        );
        const staged = await this.resolveStagedOffers({
            tenantId,
            subtotal,
            source,
            branchId: branch.id,
            orderBrandId,
            lineDetails,
            couponCode: dto.discount_code?.trim() ?? null,
            customerPhone: dto.customer_phone?.trim()
                ? normalizePakistaniPhone(dto.customer_phone.trim())
                : null,
            fullCardPayment,
            bankCardId,
            settings: offerSettings,
        });
        const combinedLineDiscount = staged.combinedLineDiscount;
        const totalDiscount = staged.totalDiscount;
        // Compat shims: auto_ = product-promo + discount + card stages combined;
        // coupon_ = the coupon stage. Individual kinds surfaced separately below.
        const auto = { discountAmount: staged.autoDiscountAmount };
        const coupon = {
            discountAmount: staged.couponDiscountAmount,
            discountCode: staged.discountCode,
        };

        let afterDiscount = Math.round((subtotal - totalDiscount) * 100) / 100;
        let loyaltyDiscount = 0;
        let loyaltyPointsRedeemed = 0;
        if (
            (source === 'pos' || source === 'consumer_app') &&
            dto.customer_phone?.trim() &&
            (dto.loyalty_points_to_redeem ?? 0) > 0
        ) {
            const normalized = normalizePakistaniPhone(
                dto.customer_phone.trim(),
            );
            if (normalized) {
                const preview = await this.loyaltyService.getRedeemPreview(
                    tenantId,
                    normalized,
                    afterDiscount,
                    source,
                    orderBrandId,
                );
                if (preview) {
                    // Loyalty is the last stage. It also honours the order cap
                    // when capIncludesLoyalty — clamp cash and re-derive points.
                    const loyaltyCeiling =
                        offerSettings.capIncludesLoyalty &&
                        staged.capRemaining != null
                            ? Math.min(afterDiscount, staged.capRemaining)
                            : afterDiscount;
                    const maxPoints =
                        preview.cashValuePerPoint > 0
                            ? Math.floor(
                                  loyaltyCeiling / preview.cashValuePerPoint,
                              )
                            : 0;
                    loyaltyPointsRedeemed = Math.max(
                        0,
                        Math.min(
                            dto.loyalty_points_to_redeem!,
                            preview.redeemablePoints,
                            maxPoints,
                        ),
                    );
                    loyaltyDiscount =
                        Math.round(
                            loyaltyPointsRedeemed *
                                preview.cashValuePerPoint *
                                100,
                        ) / 100;
                    afterDiscount =
                        Math.round((afterDiscount - loyaltyDiscount) * 100) /
                        100;
                }
            }
        }
        const serviceChargeRate = 0;
        // Per-tender GST — mirrors createOrder so the quoted total equals the charged total.
        const gstRates = resolveGstRates(
            branch as unknown as {
                gstRateCash?: number | null;
                gstRateCard?: number | null;
            },
            tenant,
        );
        const paymentSplit: TenderSplit = dto.payment_split
            ? {
                  cash: dto.payment_split.cash_amount,
                  card: dto.payment_split.card_amount,
              }
            : null;
        const tax = computeTenderTax(
            afterDiscount,
            paymentSplit,
            gstRates.cash,
            gstRates.card,
        );
        const taxAmount = tax.taxAmount;
        const serviceCharge =
            Math.round(afterDiscount * serviceChargeRate * 100) / 100;
        // Delivery fee per brand: tier×distance when the brand opts in (also returns
        // delivery_options for the checkout), else the brand's flat fee. A mixed web cart
        // (split into one order per brand) pays each brand's fee.
        const quoteBrands = new Map<number, Brand>(
            (
                (branch as { branchBrands?: Array<{ brand?: Brand }> })
                    .branchBrands ?? []
            )
                .filter((bb) => bb.brand)
                .map((bb) => [Number(bb.brand!.id), bb.brand!]),
        );
        const qDropLat =
            dto.latitude != null && Number.isFinite(Number(dto.latitude))
                ? Number(dto.latitude)
                : null;
        const qDropLng =
            dto.longitude != null && Number.isFinite(Number(dto.longitude))
                ? Number(dto.longitude)
                : null;
        const qDistanceKm = this.dropoffDistanceKm(branch, qDropLat, qDropLng);
        let deliveryFee = 0;
        let deliveryOptions: DeliveryOption[] | undefined;
        if (dto.order_type === 'delivery') {
            for (const id of quotedBrandIds) {
                const brand = quoteBrands.get(id);
                if (!brand) continue;
                if (
                    brand.deliveryTiersEnabled &&
                    brand.deliveryTiers &&
                    qDistanceKm != null
                ) {
                    if (qDistanceKm > Number(branch.deliveryRadiusKm)) {
                        throw new UnprocessableEntityException(
                            'Delivery address is outside this branch’s delivery range.',
                        );
                    }
                    const options = buildDeliveryOptions(
                        brand.deliveryTiers,
                        qDistanceKm,
                    );
                    // Single-brand cart: expose the tier options for the checkout screen.
                    if (quotedBrandIds.size === 1) deliveryOptions = options;
                    const chosen = isDeliveryTierKey(dto.delivery_tier)
                        ? dto.delivery_tier
                        : null;
                    let scalar = chosen
                        ? (resolveChosenTierFee(
                              brand.deliveryTiers,
                              chosen,
                              qDistanceKm,
                          )?.fee ?? null)
                        : null;
                    if (scalar == null) {
                        const def = defaultTierKey(options);
                        scalar = def
                            ? (options.find((o) => o.tier === def)?.fee ?? 0)
                            : 0;
                    }
                    deliveryFee += scalar;
                } else {
                    deliveryFee += Number(brand.deliveryFlatFee) || 0;
                }
            }
        }
        const totalAmount =
            Math.round(
                (afterDiscount + taxAmount + serviceCharge + deliveryFee) * 100,
            ) / 100;

        const line_breakdown = lineDetails.map((line, i) => ({
            menu_item_id: line.menuItemId,
            brand_id: (line as { brandId?: number }).brandId ?? null,
            subtotal: line.itemSubtotal,
            original_subtotal: line.itemSubtotal,
            discount_amount: combinedLineDiscount[i] ?? 0,
            after_discount:
                Math.round(
                    (line.itemSubtotal - (combinedLineDiscount[i] ?? 0)) * 100,
                ) / 100,
            is_deal: !!(line as { isDeal?: boolean }).isDeal,
        }));

        return {
            subtotal,
            auto_discount_amount: auto.discountAmount,
            product_promo_amount: staged.productPromoAmount,
            order_discount_amount: staged.discountAmount,
            card_discount_amount: staged.cardDiscountAmount,
            coupon_discount_amount: coupon.discountAmount,
            discount_amount: totalDiscount,
            discount_code: coupon.discountCode ?? null,
            cap_applied: staged.capApplied,
            loyalty_discount: loyaltyDiscount,
            loyalty_points_redeemed: loyaltyPointsRedeemed,
            tax_amount: taxAmount,
            tax_basis: tax.basis,
            tax_rate_cash: gstRates.cash,
            tax_rate_card: gstRates.card,
            service_charge: serviceCharge,
            delivery_fee: deliveryFee,
            ...(deliveryOptions ? { delivery_options: deliveryOptions } : {}),
            total_amount: totalAmount,
            line_breakdown,
        };
    }

    private async expandDealItems(
        defaultBranchId: number,
        items: Array<
            | {
                  menu_item_id: number;
                  quantity?: number;
                  variant_id?: number;
                  addons?: { addon_id: number; quantity?: number }[];
                  modifiers?: { modifier_id: number; quantity?: number }[];
                  notes?: string;
                  branch_id?: number;
              }
            | {
                  deal_menu_item_id: number;
                  quantity?: number;
                  components: Array<{
                      slot_index: number;
                      menu_item_id: number;
                      quantity?: number;
                      variant_id?: number;
                      addons?: { addon_id: number; quantity?: number }[];
                      modifiers?: { modifier_id: number; quantity?: number }[];
                      notes?: string;
                  }>;
                  branch_id?: number;
              }
        >,
        orderType: string,
    ): Promise<
        Array<{
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            notes?: string;
            branch_id?: number;
            deal_id?: number;
            deal_slot_index?: number;
            deal_unit_price?: number;
        }>
    > {
        const expanded: Array<{
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            notes?: string;
            branch_id?: number;
            deal_id?: number;
            deal_slot_index?: number;
            deal_unit_price?: number;
        }> = [];
        const branchClockCache = new Map<number, BranchClock>();
        for (const line of items) {
            const raw = line as {
                deal_menu_item_id?: number;
                quantity?: number;
                components?: Array<{
                    slot_index: number;
                    menu_item_id: number;
                    quantity?: number;
                    variant_id?: number;
                    addons?: { addon_id: number; quantity?: number }[];
                    modifiers?: { modifier_id: number; quantity?: number }[];
                    notes?: string;
                }>;
                branch_id?: number;
            };
            if (raw.deal_menu_item_id != null) {
                // A deal line with NO components must still enter this branch: falling through
                // to the plain-item path would order the deal root with no contents (and a
                // missing menu_item_id). The completeness check below rejects it cleanly.
                const components = raw.components ?? [];
                const branchId = raw.branch_id ?? defaultBranchId;
                const dealRoot = await this.menuService.findMenuItem(
                    raw.deal_menu_item_id,
                );
                if (dealRoot) {
                    assertMenuItemAvailableForOrderType(dealRoot, orderType);
                    // Time-restricted deals (e.g. lunch Mon–Fri 12–16h) enforce the
                    // window on the deal root, in the branch timezone.
                    this.assertMenuItemAvailableNow(
                        dealRoot,
                        await this.getBranchClockCached(
                            branchId,
                            branchClockCache,
                        ),
                    );
                }
                for (const comp of components) {
                    const compItem = await this.menuService.findMenuItem(
                        comp.menu_item_id,
                    );
                    if (compItem) {
                        assertMenuItemAvailableForOrderType(
                            compItem,
                            orderType,
                        );
                    }
                }
                const dealPrice = await this.menuService.getEffectiveUnitPrice(
                    branchId,
                    raw.deal_menu_item_id,
                );
                // Phase 3: per-slot upsell surcharges (e.g. "upgrade to Firey Special +Rs100").
                const surchargeBySlot =
                    await this.menuService.getDealSlotSurcharges(
                        raw.deal_menu_item_id,
                    );

                // BOGO deals price each component dynamically from its OWN menu price
                // (full price incl. size), then discount the cheapest get-units of every
                // (buy+get) cohort — "2nd pizza of same size & category, half price". The
                // computed price already includes the variant/size modifier, so the
                // createOrder and quote paths consume it verbatim (no double-count).
                const dealPricingMode =
                    (dealRoot as { dealPricingMode?: string | null } | null)
                        ?.dealPricingMode ?? null;
                let bogoUnitPrices: number[] | null = null;
                if (dealPricingMode === 'bogo') {
                    const meta = await this.menuService.getDealComponentMeta(
                        raw.deal_menu_item_id,
                    );
                    // A BOGO root without defined slots is unorderable (an empty payload
                    // would otherwise sail through `seenSlots.size === meta.size` at 0=0).
                    if (meta.size === 0)
                        throw new BadRequestException(
                            'Invalid deal selection.',
                        );
                    const resolved: Array<{
                        regularPrice: number;
                        constraint: BogoComponentConstraint;
                    }> = [];
                    const seenSlots = new Set<number>();
                    for (const comp of components) {
                        // slot_index and menu_item_id come straight from the client; bind each
                        // to a DEFINED slot (no unknown/duplicate slots — which would collapse
                        // the mirror and drop the size/category gate) and verify the chosen item
                        // is actually one of that slot's allowed choices before pricing it.
                        const m = meta.get(comp.slot_index);
                        if (!m)
                            throw new BadRequestException(
                                'Invalid deal selection.',
                            );
                        if (seenSlots.has(comp.slot_index))
                            throw new BadRequestException(
                                'Duplicate deal slot selection.',
                            );
                        seenSlots.add(comp.slot_index);
                        const item = await this.menuService.findMenuItem(
                            comp.menu_item_id,
                        );
                        const itemCategoryId = item
                            ? Number(item.categoryId)
                            : null;
                        if (
                            !isComponentAllowedInSlot(
                                {
                                    menuItemId: comp.menu_item_id,
                                    categoryId: itemCategoryId,
                                },
                                m,
                            )
                        )
                            throw new BadRequestException(
                                'That item is not available in this deal.',
                            );
                        const variant =
                            comp.variant_id && item?.variants
                                ? item.variants.find(
                                      (v) => v.id === comp.variant_id,
                                  )
                                : null;
                        const base =
                            await this.menuService.getEffectiveUnitPrice(
                                branchId,
                                comp.menu_item_id,
                            );
                        const variantMod = variant
                            ? Number(variant.priceModifier)
                            : 0;
                        resolved.push({
                            regularPrice: base + variantMod,
                            constraint: {
                                slotIndex: comp.slot_index,
                                categoryId: itemCategoryId,
                                label:
                                    (item as { label?: string | null } | null)
                                        ?.label ?? null,
                                sizeKey: variant?.sizeKey ?? null,
                                allowedSizeKeys: m.allowedSizeKeys ?? null,
                                mirrorSlotIndex: m.mirrorSlotIndex ?? null,
                                mirrorMatchSize: m.mirrorMatchSize ?? false,
                                mirrorMatchCategory:
                                    m.mirrorMatchCategory ?? false,
                            },
                        });
                    }
                    // Every defined slot must be filled exactly once (no missing/extra pizzas).
                    if (seenSlots.size !== meta.size)
                        throw new BadRequestException(
                            'Please choose an item for every part of this deal.',
                        );
                    const err = validateBogoComponents(
                        resolved.map((r) => r.constraint),
                    );
                    if (err) throw new BadRequestException(err);
                    const buyQ =
                        Number(
                            (
                                dealRoot as {
                                    dealBogoBuyQuantity?: number | null;
                                } | null
                            )?.dealBogoBuyQuantity,
                        ) || 1;
                    const getQ =
                        Number(
                            (
                                dealRoot as {
                                    dealBogoGetQuantity?: number | null;
                                } | null
                            )?.dealBogoGetQuantity,
                        ) || 1;
                    const pct =
                        Number(
                            (
                                dealRoot as {
                                    dealBogoGetPercent?: number | null;
                                } | null
                            )?.dealBogoGetPercent,
                        ) || 0;
                    bogoUnitPrices = priceBogoComponents(
                        resolved.map((r) => r.regularPrice),
                        buyQ,
                        getQ,
                        pct,
                    );
                } else {
                    // Non-BOGO flat-price deal: enforce that each chosen component belongs to
                    // its slot and honours the slot's size lock, so a crafted payload can't
                    // swap in an expensive item (e.g. an XL pizza for a Rs899 medium deal) or a
                    // different size. Sizeless items (e.g. pasta) skip the size check.
                    const meta = await this.menuService.getDealComponentMeta(
                        raw.deal_menu_item_id,
                    );
                    // A deal line must reference a REAL deal. Without defined slots every
                    // check below would be skipped — and components would be priced at the
                    // referenced item's flat price (first slot) and 0 (the rest).
                    if (meta.size === 0)
                        throw new BadRequestException(
                            'Invalid deal selection.',
                        );
                    for (const comp of components) {
                        const m = meta.get(comp.slot_index);
                        if (!m)
                            throw new BadRequestException(
                                'Invalid deal selection.',
                            );
                        const item = await this.menuService.findMenuItem(
                            comp.menu_item_id,
                        );
                        const itemCategoryId = item
                            ? Number(item.categoryId)
                            : null;
                        if (
                            !isComponentAllowedInSlot(
                                {
                                    menuItemId: comp.menu_item_id,
                                    categoryId: itemCategoryId,
                                },
                                m,
                            )
                        )
                            throw new BadRequestException(
                                'That item is not available in this deal.',
                            );
                        if (m.slotSizeKey && item?.variants?.length) {
                            const variant = comp.variant_id
                                ? item.variants.find(
                                      (v) => v.id === comp.variant_id,
                                  )
                                : null;
                            if (
                                !variant ||
                                (variant.sizeKey ?? null) !== m.slotSizeKey
                            )
                                throw new BadRequestException(
                                    'Please choose the correct size for this deal.',
                                );
                        }
                    }
                    // Structural completeness (the BOGO branch already enforces its own):
                    // every REQUIRED slot must be filled with exactly its configured unit
                    // count ("Deal for 2" = 2 boxes + 2 drinks — no fewer); optional slots
                    // ("add a drink(s)") may hold 0..quantity units. Counts sum component
                    // quantities, matching the POS payload (multi-unit slots send one
                    // entry per unit; fixed slots one entry carrying the slot quantity).
                    const unitsBySlot = new Map<number, number>();
                    for (const comp of components) {
                        const units = Math.max(
                            1,
                            Math.floor(Number(comp.quantity ?? 1)) || 1,
                        );
                        unitsBySlot.set(
                            comp.slot_index,
                            (unitsBySlot.get(comp.slot_index) ?? 0) + units,
                        );
                    }
                    for (const [slotIndex, m] of meta) {
                        const units = unitsBySlot.get(slotIndex) ?? 0;
                        if (!m.optional && units < m.quantity)
                            throw new BadRequestException(
                                'Please choose an item for every part of this deal.',
                            );
                        if (units > m.quantity)
                            throw new BadRequestException(
                                'Too many items selected for a part of this deal.',
                            );
                    }
                }

                const qty = raw.quantity ?? 1;
                for (let q = 0; q < qty; q++) {
                    components.forEach((comp, idx) => {
                        const slotSurcharge =
                            surchargeBySlot.get(comp.slot_index)?.[
                                String(comp.menu_item_id)
                            ] ?? 0;
                        const baseDealPrice =
                            bogoUnitPrices != null
                                ? (bogoUnitPrices[idx] ?? 0)
                                : idx === 0
                                  ? dealPrice
                                  : 0;
                        expanded.push({
                            menu_item_id: comp.menu_item_id,
                            quantity: comp.quantity ?? 1,
                            variant_id: comp.variant_id,
                            addons: comp.addons,
                            modifiers: comp.modifiers,
                            notes: comp.notes,
                            branch_id: raw.branch_id ?? defaultBranchId,
                            deal_id: raw.deal_menu_item_id,
                            deal_slot_index: comp.slot_index,
                            deal_unit_price: bogoRound2(
                                baseDealPrice + Number(slotSurcharge || 0),
                            ),
                        });
                    });
                }
            } else {
                const normal = line as {
                    menu_item_id: number;
                    quantity?: number;
                    variant_id?: number;
                    addons?: { addon_id: number; quantity?: number }[];
                    modifiers?: { modifier_id: number; quantity?: number }[];
                    notes?: string;
                    branch_id?: number;
                };
                expanded.push({
                    menu_item_id: normal.menu_item_id,
                    quantity: normal.quantity ?? 1,
                    variant_id: normal.variant_id,
                    addons: normal.addons,
                    modifiers: normal.modifiers,
                    notes: normal.notes,
                    branch_id: normal.branch_id,
                });
            }
        }
        return expanded;
    }

    /** Compute subtotal and line details; derive orderBrandId from items (single brand or null for multi-brand). */
    private async computeSubtotalAndLinesWithBrands(
        branchId: number,
        items: Array<{
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
            deal_unit_price?: number;
        }>,
        orderType: string,
    ): Promise<{
        subtotal: number;
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            brandId: number;
            itemSubtotal: number;
            quantity?: number;
            sizeKey?: string | null;
            isDeal?: boolean;
            unitCost?: number | null;
        }[];
        orderBrandId: number | null;
    }> {
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands'],
        })) as
            | (Branch & {
                  branchBrands?: Array<{
                      brandId: number;
                      brand?: { id: number };
                  }>;
              })
            | null;
        const branchBrandIds = new Set(
            (branch?.branchBrands ?? [])
                .map((bb) => Number(bb.brandId ?? bb.brand?.id))
                .filter((id: number) => Number.isFinite(id)),
        );
        const branchClock = getBranchClock(
            (branch as { timezone?: string } | null)?.timezone,
        );
        const lineDetails: {
            menuItemId: number;
            categoryId: number;
            brandId: number;
            itemSubtotal: number;
            quantity?: number;
            sizeKey?: string | null;
            isDeal?: boolean;
            unitCost?: number | null;
        }[] = [];
        const itemBrandIds = new Set<number>();
        let subtotal = 0;
        for (const line of items) {
            const menuItem = await this.menuService.findMenuItem(
                line.menu_item_id,
            );
            if (!menuItem) continue;
            assertMenuItemAvailableForOrderType(menuItem, orderType);
            this.assertMenuItemAvailableNow(menuItem, branchClock);
            const brandId = Number(
                (menuItem as { brandId?: number; brand?: { id: number } })
                    .brandId ??
                    (menuItem as { brand?: { id: number } }).brand?.id,
            );
            if (!Number.isFinite(brandId) || !branchBrandIds.has(brandId))
                continue;
            itemBrandIds.add(brandId);
            let unitPrice: number;
            if (
                (line as { deal_unit_price?: number }).deal_unit_price !==
                undefined
            ) {
                unitPrice = (line as { deal_unit_price: number })
                    .deal_unit_price;
            } else {
                unitPrice = await this.menuService.getEffectiveUnitPrice(
                    branchId,
                    line.menu_item_id,
                );
            }
            const isDealPriceLine =
                (line as { deal_unit_price?: number }).deal_unit_price !==
                undefined;
            // Resolve the variant size for both deal and non-deal lines so deal
            // component toppings (e.g. a 12" pizza inside a deal) price per size.
            let lineSizeKey: string | null = null;
            const baseCost =
                (menuItem as { costPrice?: number | null }).costPrice != null
                    ? Number(
                          (menuItem as { costPrice?: number | null }).costPrice,
                      )
                    : null;
            let lineUnitCost: number | null = baseCost;
            if (line.variant_id && menuItem.variants?.length) {
                const variant = menuItem.variants.find(
                    (v) => v.id === line.variant_id,
                );
                if (variant) {
                    if (!isDealPriceLine)
                        unitPrice += Number(variant.priceModifier);
                    lineSizeKey = variant.sizeKey ?? null;
                    const vc = (variant as { costPrice?: number | null })
                        .costPrice;
                    if (vc != null)
                        lineUnitCost = (lineUnitCost ?? 0) + Number(vc);
                }
            }
            let itemSubtotalForDetail: number;
            if (isDealPriceLine) {
                // Deal line: base is the fixed deal price (one deal unit); still add addons and modifiers for this component.
                itemSubtotalForDetail = (line as { deal_unit_price: number })
                    .deal_unit_price;
            } else {
                const quantity = line.quantity ?? 1;
                itemSubtotalForDetail = unitPrice * quantity;
            }
            // Add addons and modifiers for both deal and non-deal lines (deal components can have addons e.g. extra dip).
            if (line.addons?.length) {
                for (const addonLine of line.addons) {
                    const addon = menuItem.addons?.find(
                        (a) => a.id === addonLine.addon_id,
                    );
                    if (addon)
                        itemSubtotalForDetail +=
                            Number(addon.price) * (addonLine.quantity ?? 1);
                }
            }
            itemSubtotalForDetail += priceModifiersForLine({
                modifierGroups: (
                    menuItem as { modifierGroups?: PricingModifierGroup[] }
                ).modifierGroups,
                selections: line.modifiers,
                sizeKey: lineSizeKey,
            }).total;
            subtotal += itemSubtotalForDetail;
            lineDetails.push({
                menuItemId: menuItem.id,
                categoryId: menuItem.categoryId,
                brandId,
                itemSubtotal: itemSubtotalForDetail,
                quantity: line.quantity ?? 1,
                sizeKey: lineSizeKey,
                isDeal: isDealPriceLine,
                unitCost: isDealPriceLine ? null : lineUnitCost,
            });
        }
        const orderBrandId =
            itemBrandIds.size === 1 ? [...itemBrandIds][0] : null;
        return { subtotal, lineDetails, orderBrandId };
    }

    /** Compute order subtotal and per-line details (menuItemId, categoryId, itemSubtotal) for scope-based discount. */
    private async computeSubtotalAndLines(
        items: {
            menu_item_id: number;
            quantity: number;
            variant_id?: number;
            addons?: { addon_id: number; quantity?: number }[];
            modifiers?: { modifier_id: number; quantity?: number }[];
        }[],
    ): Promise<{
        subtotal: number;
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
        }[];
    }> {
        const lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
        }[] = [];
        let subtotal = 0;
        for (const line of items) {
            const menuItem = await this.menuService.findMenuItem(
                line.menu_item_id,
            );
            if (!menuItem) continue;
            let unitPrice = Number(menuItem.basePrice);
            let lineSizeKey: string | null = null;
            if (line.variant_id && menuItem.variants?.length) {
                const variant = menuItem.variants.find(
                    (v) => v.id === line.variant_id,
                );
                if (variant) {
                    unitPrice += Number(variant.priceModifier);
                    lineSizeKey = variant.sizeKey ?? null;
                }
            }
            const quantity = line.quantity ?? 1;
            let itemSubtotal = unitPrice * quantity;
            if (line.addons?.length) {
                for (const addonLine of line.addons) {
                    const addon = menuItem.addons?.find(
                        (a) => a.id === addonLine.addon_id,
                    );
                    if (addon)
                        itemSubtotal +=
                            Number(addon.price) * (addonLine.quantity ?? 1);
                }
            }
            itemSubtotal += priceModifiersForLine({
                modifierGroups: (
                    menuItem as { modifierGroups?: PricingModifierGroup[] }
                ).modifierGroups,
                selections: line.modifiers,
                sizeKey: lineSizeKey,
            }).total;
            subtotal += itemSubtotal;
            lineDetails.push({
                menuItemId: menuItem.id,
                categoryId: menuItem.categoryId,
                itemSubtotal,
            });
        }
        return { subtotal, lineDetails };
    }

    private readonly discountResultEmpty: {
        discountAmount: number;
        discountCode: string | null;
        discountId: number | null;
        scope: string;
        scopeIds: number[];
        discountableAmount: number;
        eligibilityBrandIds: number[] | null;
    } = {
        discountAmount: 0,
        discountCode: null,
        discountId: null,
        scope: 'whole_order',
        scopeIds: [],
        discountableAmount: 0,
        eligibilityBrandIds: null,
    };

    /** Line detail for discount; brandId required for multi-brand orders so brand-scoped discounts apply to eligible portion only. */
    private lineDetailBrandId(
        line: { brandId?: number },
        index: number,
        lineDetails: { brandId?: number }[],
    ): number | undefined {
        return line.brandId ?? lineDetails[index]?.brandId;
    }

    /** Branch wall-clock (timezone-aware), cached per branch id for the request. */
    private async getBranchClockCached(
        branchId: number,
        cache?: Map<number, BranchClock>,
    ): Promise<BranchClock> {
        const cached = cache?.get(branchId);
        if (cached) return cached;
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            select: ['timezone'],
        });
        const clock = getBranchClock(branch?.timezone);
        cache?.set(branchId, clock);
        return clock;
    }

    /** Throw if a menu item's recurring availability window excludes the branch's current time. */
    private assertMenuItemAvailableNow(
        item: {
            name: string;
            availableTimeStart?: string | null;
            availableTimeEnd?: string | null;
            availableDaysOfWeek?: number[] | null;
        },
        clock: BranchClock,
    ): void {
        const ok = isWithinSchedule(
            {
                timeStart: item.availableTimeStart,
                timeEnd: item.availableTimeEnd,
                daysOfWeek: item.availableDaysOfWeek,
            },
            clock,
        );
        if (!ok)
            throw new BadRequestException(
                `"${item.name}" is not available at this time.`,
            );
    }

    /**
     * Buy-X-get-Y (BOGO) discount amount for the eligible (in-scope) lines.
     * Expands lines into per-unit prices; for each cohort of (buy+get) units the
     * cheapest `get` units are discounted by `getDiscountPercent`. When
     * bogoMatchSameGroup is set, units are paired only within the same category+size
     * (e.g. "buy a Large pizza, 2nd Large of the same category half price").
     */
    private computeBogoDiscount(
        discount: Discount,
        eligible: Array<{
            itemSubtotal: number;
            quantity?: number;
            categoryId: number;
            sizeKey?: string | null;
        }>,
    ): number {
        const buyQ = Math.max(1, Number(discount.buyQuantity) || 1);
        const getQ = Math.max(1, Number(discount.getQuantity) || 1);
        const pct = Math.min(
            100,
            Math.max(0, Number(discount.getDiscountPercent) || 0),
        );
        if (pct <= 0) return 0;

        const unitPricesFor = (lines: typeof eligible): number[] => {
            const units: number[] = [];
            for (const l of lines) {
                const q = Math.max(1, Math.floor(Number(l.quantity) || 1));
                const unit = q > 0 ? l.itemSubtotal / q : l.itemSubtotal;
                for (let i = 0; i < q; i++) units.push(unit);
            }
            return units;
        };

        // Same cohort/cheapest-units selection used by BOGO deals — single source of truth.
        const discountForUnits = (prices: number[]): number =>
            bogoUnitDiscounts(prices, buyQ, getQ, pct).reduce(
                (a, b) => a + b,
                0,
            );

        let total = 0;
        if (discount.bogoMatchSameGroup) {
            const groups = new Map<string, typeof eligible>();
            for (const l of eligible) {
                const key = `${l.categoryId}|${l.sizeKey ?? ''}`;
                const arr = groups.get(key) ?? [];
                arr.push(l);
                groups.set(key, arr);
            }
            for (const arr of groups.values())
                total += discountForUnits(unitPricesFor(arr));
        } else {
            total = discountForUnits(unitPricesFor(eligible));
        }
        return Math.round(total * 100) / 100;
    }

    /**
     * Check if discount is valid for current time and day in branch timezone.
     * validDaysOfWeek: 0=Sun, 1=Mon, …, 6=Sat.
     */
    private async isDiscountValidForBranchTime(
        discount: Discount,
        branchId: number,
    ): Promise<boolean> {
        const hasTime =
            discount.validTimeStart != null || discount.validTimeEnd != null;
        const hasDays =
            Array.isArray(discount.validDaysOfWeek) &&
            discount.validDaysOfWeek.length > 0;
        if (!hasTime && !hasDays) return true;

        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            select: ['timezone'],
        });
        return isWithinSchedule(
            {
                timeStart: discount.validTimeStart,
                timeEnd: discount.validTimeEnd,
                daysOfWeek: discount.validDaysOfWeek,
            },
            getBranchClock(branch?.timezone),
        );
    }

    /** Resolve best auto-applied discount. Multi-brand: brand-scoped discounts apply to the eligible portion only. */
    /**
     * Evaluate one offer against the CURRENT running per-line amounts and return
     * its per-line allocation, or null if ineligible / applies to nothing.
     * Date + branch-time are assumed already checked by the caller (async); this
     * runs the remaining synchronous gauntlet identical to resolveAutoDiscount,
     * but on `running` so stages compound, and skips lines flagged `excluded`
     * (deals / price overrides).
     */
    private evalOfferOnRunning(
        discount: Discount,
        ctx: {
            subtotal: number;
            source: string;
            branchId: number;
            orderBrandId: number | null;
            lineDetails: {
                menuItemId: number;
                categoryId: number;
                itemSubtotal: number;
                brandId?: number;
                quantity?: number;
                sizeKey?: string | null;
            }[];
            excluded: boolean[];
            fullCardPayment: boolean;
            bankCardId: number | null;
        },
        running: number[],
    ): { alloc: number[]; amount: number } | null {
        const {
            subtotal,
            source,
            branchId,
            orderBrandId,
            lineDetails,
            excluded,
            fullCardPayment,
            bankCardId,
        } = ctx;
        const n = lineDetails.length;
        if (
            discount.minOrderAmount != null &&
            Number(discount.minOrderAmount) > subtotal
        )
            return null;
        if (
            !offerAllowedOnChannel(
                discount.channels,
                discount.posOnly,
                sourceToOfferChannel(source),
            )
        )
            return null;
        if (discount.requiresCard) {
            if (!fullCardPayment || bankCardId == null) return null;
            const ids = (discount.eligibleBankCardIds ?? []).map(Number);
            if (!ids.includes(Number(bankCardId))) return null;
        }
        const eligibilityBranchIds = discount.eligibilityBranchIds ?? null;
        const eligibilityBrandIds = discount.eligibilityBrandIds ?? null;
        if (
            eligibilityBranchIds != null &&
            eligibilityBranchIds.length > 0 &&
            !eligibilityBranchIds.includes(branchId)
        )
            return null;
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(eligibilityBrandIds.map((id) => Number(id)))
                : null;
        if (orderBrandId != null && brandSet != null) {
            if (!brandSet.has(Number(orderBrandId))) return null;
        }
        const scope = discount.applicationScope ?? 'whole_order';
        const scopeIds = (discount.applicationScopeIds ?? []).map((id) =>
            Number(id),
        );
        const inScope = (
            l: { menuItemId: number; categoryId: number },
            i: number,
        ): boolean => {
            if (excluded[i]) return false;
            if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && orderBrandId == null) {
                const lineBrand = this.lineDetailBrandId(
                    lineDetails[i],
                    i,
                    lineDetails,
                );
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        const inScopeIdx: number[] = [];
        lineDetails.forEach((l, i) => {
            if (inScope(l, i)) inScopeIdx.push(i);
        });
        let discountableAmount = 0;
        for (const i of inScopeIdx) discountableAmount += running[i];
        if (discountableAmount <= 0) return null;
        let amount = 0;
        if (discount.type === 'buy_x_get_y') {
            const eligibleLines = inScopeIdx.map((i) => lineDetails[i]);
            amount = Math.min(
                this.computeBogoDiscount(discount, eligibleLines),
                discountableAmount,
            );
        } else if (discount.type === 'flat') {
            amount = Math.min(Number(discount.value), discountableAmount);
        } else {
            amount = (discountableAmount * Number(discount.value)) / 100;
        }
        if (discount.maxDiscountAmount != null)
            amount = Math.min(amount, Number(discount.maxDiscountAmount));
        amount = oround2(amount);
        if (amount <= 0) return null;
        const alloc = new Array<number>(n).fill(0);
        let allocatedSum = 0;
        for (const i of inScopeIdx) {
            const share = oround2(amount * (running[i] / discountableAmount));
            alloc[i] = share;
            allocatedSum += share;
        }
        const diff = oround2(amount - allocatedSum);
        if (diff !== 0 && inScopeIdx.length > 0) {
            const last = inScopeIdx[inScopeIdx.length - 1];
            alloc[last] = oround2(alloc[last] + diff);
        }
        return { alloc, amount };
    }

    /**
     * Staged offer resolution — the single pricing engine used by both quote and
     * createOrder. Applies product_promotion → discount → coupon → card_offer as
     * stacking stages (loyalty is applied by the caller with `capRemaining`),
     * best-value within a group, on running amounts, honouring deal / override
     * exclusion, per-line floors and the progressive cap.
     */
    private async resolveStagedOffers(ctx: {
        tenantId: number;
        subtotal: number;
        source: string;
        branchId: number;
        orderBrandId: number | null;
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
            quantity?: number;
            sizeKey?: string | null;
            isDeal?: boolean;
            unitCost?: number | null;
            overridden?: boolean;
        }[];
        couponCode: string | null;
        customerId?: number | null;
        customerPhone?: string | null;
        fullCardPayment: boolean;
        bankCardId: number | null;
        settings: OfferSettings;
    }): Promise<{
        combinedLineDiscount: number[];
        totalDiscount: number;
        productPromoAmount: number;
        discountAmount: number;
        couponDiscountAmount: number;
        cardDiscountAmount: number;
        autoDiscountAmount: number;
        discountId: number | null;
        discountCode: string | null;
        capRemaining: number | null;
        capApplied: boolean;
        couponOffer: Discount | null;
        lineBreakdown: {
            original: number;
            discounts: { kind: OfferStageKind; amount: number }[];
            after_discount: number;
        }[];
    }> {
        const {
            tenantId,
            subtotal,
            source,
            branchId,
            orderBrandId,
            lineDetails,
            couponCode,
            fullCardPayment,
            bankCardId,
            settings,
        } = ctx;
        const n = lineDetails.length;
        const engineLines: EngineLine[] = lineDetails.map((l) => ({
            itemSubtotal: l.itemSubtotal,
            lineCost:
                l.unitCost != null
                    ? oround2(Number(l.unitCost) * (l.quantity ?? 1))
                    : null,
            isDeal: !!l.isDeal,
            isOverridden: !!l.overridden,
        }));
        const excluded = engineLines.map(
            (l) =>
                (l.isDeal && !settings.allowOffersOnDeals) ||
                (l.isOverridden && !settings.offersApplyToOverriddenLines),
        );

        const now = new Date();
        const dateOk = (d: Discount): boolean =>
            !(d.validFrom && now < d.validFrom) &&
            !(d.validUntil && now > d.validUntil);

        const autoOffers = await this.discountRepo.find({
            where: { tenantId, isActive: true, requiresCode: false },
        });
        const eligibleAuto: Discount[] = [];
        for (const d of autoOffers) {
            if (!dateOk(d)) continue;
            if (!(await this.isDiscountValidForBranchTime(d, branchId)))
                continue;
            eligibleAuto.push(d);
        }
        const kindOf = (d: Discount): string =>
            (d as { offerKind?: string }).offerKind ?? 'discount';
        const productPromos = eligibleAuto.filter(
            (d) => kindOf(d) === 'product_promotion',
        );
        const orderDiscounts = eligibleAuto.filter(
            (d) => kindOf(d) === 'discount',
        );
        const cardOffers = eligibleAuto.filter(
            (d) => kindOf(d) === 'card_offer',
        );

        let coupon: Discount | null = null;
        if (couponCode?.trim()) {
            const c = await this.discountRepo.findOne({
                where: { code: couponCode.trim(), tenantId, isActive: true },
            });
            if (
                c &&
                dateOk(c) &&
                (await this.isDiscountValidForBranchTime(c, branchId)) &&
                (await this.couponRedeemableSoft(
                    c,
                    tenantId,
                    ctx.customerId ?? null,
                    ctx.customerPhone ?? null,
                ))
            )
                coupon = c;
        }

        const evalCtx = {
            subtotal,
            source,
            branchId,
            orderBrandId,
            lineDetails,
            excluded,
            fullCardPayment,
            bankCardId,
        };
        const stages: EngineStage[] = [];
        let discountChosen: Discount | null = null;
        let cardChosen: Discount | null = null;

        if (productPromos.length > 0) {
            stages.push({
                kind: 'product_promotion',
                funding: 'merchant',
                compute: (running) => {
                    const best = new Array<number>(n).fill(0);
                    for (const d of productPromos) {
                        const r = this.evalOfferOnRunning(d, evalCtx, running);
                        if (!r) continue;
                        for (let i = 0; i < n; i++)
                            if (r.alloc[i] > best[i]) best[i] = r.alloc[i];
                    }
                    return best;
                },
            });
        }
        if (orderDiscounts.length > 0) {
            stages.push({
                kind: 'discount',
                funding: 'merchant',
                compute: (running) => {
                    let bestAlloc: number[] | null = null;
                    let bestAmt = 0;
                    let chosen: Discount | null = null;
                    for (const d of orderDiscounts) {
                        const r = this.evalOfferOnRunning(d, evalCtx, running);
                        if (r && r.amount > bestAmt) {
                            bestAmt = r.amount;
                            bestAlloc = r.alloc;
                            chosen = d;
                        }
                    }
                    discountChosen = chosen;
                    return bestAlloc ?? new Array<number>(n).fill(0);
                },
            });
        }
        if (coupon) {
            const c = coupon;
            stages.push({
                kind: 'coupon',
                funding: c.funding === 'bank' ? 'bank' : 'merchant',
                compute: (running) => {
                    const r = this.evalOfferOnRunning(c, evalCtx, running);
                    return r ? r.alloc : new Array<number>(n).fill(0);
                },
            });
        }
        if (cardOffers.length > 0 && fullCardPayment && bankCardId != null) {
            stages.push({
                kind: 'card_offer',
                funding: 'bank',
                compute: (running) => {
                    let bestAlloc: number[] | null = null;
                    let bestAmt = 0;
                    let chosen: Discount | null = null;
                    for (const d of cardOffers) {
                        const r = this.evalOfferOnRunning(d, evalCtx, running);
                        if (r && r.amount > bestAmt) {
                            bestAmt = r.amount;
                            bestAlloc = r.alloc;
                            chosen = d;
                        }
                    }
                    cardChosen = chosen;
                    return bestAlloc ?? new Array<number>(n).fill(0);
                },
            });
        }

        const result = runOfferEngine(engineLines, stages, settings);
        const combinedLineDiscount = result.lines.map((l) => l.totalDiscount);
        const promoUsed = result.byKind.product_promotion > 0;
        const discountId =
            coupon?.id ??
            (discountChosen as Discount | null)?.id ??
            (cardChosen as Discount | null)?.id ??
            (promoUsed && productPromos.length > 0
                ? productPromos[0].id
                : null);
        return {
            combinedLineDiscount,
            totalDiscount: result.totalDiscount,
            productPromoAmount: result.byKind.product_promotion,
            discountAmount: result.byKind.discount,
            couponDiscountAmount: result.byKind.coupon,
            cardDiscountAmount: result.byKind.card_offer,
            autoDiscountAmount: oround2(
                result.byKind.product_promotion +
                    result.byKind.discount +
                    result.byKind.card_offer,
            ),
            discountId,
            discountCode: coupon?.code ?? null,
            capRemaining: result.capRemaining,
            capApplied: result.capApplied,
            couponOffer: coupon,
            lineBreakdown: result.lines.map((l) => ({
                original: l.original,
                discounts: l.discounts,
                after_discount: l.after,
            })),
        };
    }

    /**
     * Soft (non-transactional) redeemability check for a coupon: audience
     * targeting + per-customer / global usage limits. Used at quote and as a
     * pre-check at order time so an over-limit or ineligible coupon is simply
     * NOT applied (greyed-out UX), never an error. The authoritative race-safe
     * check happens in enforceAndRecordRealization at order-create.
     */
    private async couponRedeemableSoft(
        coupon: Discount,
        tenantId: number,
        customerId: number | null,
        customerPhone: string | null,
    ): Promise<boolean> {
        const audience =
            (coupon as { audience?: string | null }).audience ?? null;
        const perLimit =
            (coupon as { perCustomerLimit?: number | null }).perCustomerLimit ??
            null;
        const globalLimit =
            (coupon as { globalLimit?: number | null }).globalLimit ?? null;
        const eligibleIds =
            (coupon as { eligibleCustomerIds?: number[] | null })
                .eligibleCustomerIds ?? null;

        // Resolve a customer id from phone when only a phone is known.
        let cid = customerId;
        if (cid == null && customerPhone) {
            const rows = await this.dataSource.query(
                `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
                [tenantId, customerPhone],
            );
            cid = rows[0]?.id ?? null;
        }

        if (audience === 'specific' || audience === 'new_customer') {
            // Both require the customer to be targeted: 'specific' via the
            // eligible list OR a held voucher; 'new_customer' via the voucher
            // minted at registration.
            let ok = false;
            if (
                audience === 'specific' &&
                cid != null &&
                Array.isArray(eligibleIds) &&
                eligibleIds.map(Number).includes(Number(cid))
            )
                ok = true;
            if (!ok && cid != null) {
                const v = await this.dataSource.query(
                    `SELECT 1 FROM vouchers WHERE offer_id = $1 AND customer_id = $2 AND status = 'active' LIMIT 1`,
                    [coupon.id, cid],
                );
                if (v.length > 0) ok = true;
            }
            if (!ok) return false;
        }

        if (perLimit != null) {
            if (cid == null && !customerPhone) return false; // identity required
            const clause =
                cid != null ? 'customer_id = $2' : 'customer_phone = $2';
            const rows = await this.dataSource.query(
                `SELECT count(*)::int AS n FROM coupon_realizations WHERE offer_id = $1 AND ${clause} AND reversed_at IS NULL`,
                [coupon.id, cid ?? customerPhone],
            );
            if (Number(rows[0]?.n ?? 0) >= perLimit) return false;
        }
        if (globalLimit != null) {
            const rows = await this.dataSource.query(
                `SELECT count(*)::int AS n FROM coupon_realizations WHERE offer_id = $1 AND reversed_at IS NULL`,
                [coupon.id],
            );
            if (Number(rows[0]?.n ?? 0) >= globalLimit) return false;
        }
        return true;
    }

    /**
     * Race-safe redemption booking at order-create. Serialized on a per-offer
     * advisory lock; re-counts under the lock and throws if the limit is now
     * exceeded (a concurrent winner), then inserts the ledger row
     * (ON CONFLICT (offer_id, order_id) DO NOTHING) and bumps the voucher.
     */
    private async enforceAndRecordRealization(params: {
        tenantId: number;
        offer: Discount;
        customerId: number | null;
        customerPhone: string | null;
        orderId: number;
        source: string;
        amount: number;
    }): Promise<void> {
        const {
            tenantId,
            offer,
            customerId,
            customerPhone,
            orderId,
            source,
            amount,
        } = params;
        const perLimit =
            (offer as { perCustomerLimit?: number | null }).perCustomerLimit ??
            null;
        const globalLimit =
            (offer as { globalLimit?: number | null }).globalLimit ?? null;
        await this.dataSource.transaction(async (manager) => {
            await advisoryXactLock(
                manager,
                AdvisoryLock.COUPON_REALIZATION,
                offer.id,
            );
            if (perLimit != null && (customerId != null || customerPhone)) {
                const clause =
                    customerId != null
                        ? 'customer_id = $2'
                        : 'customer_phone = $2';
                const rows = await manager.query(
                    `SELECT count(*)::int AS n FROM coupon_realizations WHERE offer_id = $1 AND ${clause} AND reversed_at IS NULL`,
                    [offer.id, customerId ?? customerPhone],
                );
                if (Number(rows[0]?.n ?? 0) >= perLimit)
                    throw new BadRequestException(
                        'Coupon usage limit reached for this customer.',
                    );
            }
            if (globalLimit != null) {
                const rows = await manager.query(
                    `SELECT count(*)::int AS n FROM coupon_realizations WHERE offer_id = $1 AND reversed_at IS NULL`,
                    [offer.id],
                );
                if (Number(rows[0]?.n ?? 0) >= globalLimit)
                    throw new BadRequestException(
                        'Coupon redemption limit reached.',
                    );
            }
            let voucherId: number | null = null;
            if (customerId != null) {
                const v = await manager.query(
                    `SELECT id FROM vouchers WHERE offer_id = $1 AND customer_id = $2 LIMIT 1`,
                    [offer.id, customerId],
                );
                voucherId = v[0]?.id ?? null;
            }
            await manager.query(
                `INSERT INTO coupon_realizations
                    (tenant_id, offer_id, voucher_id, customer_id, customer_phone, order_id, source, amount)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (offer_id, order_id) DO NOTHING`,
                [
                    tenantId,
                    offer.id,
                    voucherId,
                    customerId,
                    customerPhone,
                    orderId,
                    source,
                    amount,
                ],
            );
            if (voucherId != null) {
                await manager.query(
                    `UPDATE vouchers
                     SET uses = uses + 1, last_used_at = now(),
                         status = CASE WHEN $2::int IS NOT NULL AND uses + 1 >= $2::int THEN 'exhausted' ELSE status END
                     WHERE id = $1`,
                    [voucherId, perLimit],
                );
            }
        });
    }

    /** Reverse all non-reversed realizations for a cancelled order and restore voucher uses. */
    private async reverseCouponRealizations(
        orderId: number,
        reason: string,
    ): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const rows = await manager.query(
                `UPDATE coupon_realizations
                 SET reversed_at = now(), reversal_reason = $2
                 WHERE order_id = $1 AND reversed_at IS NULL
                 RETURNING voucher_id`,
                [orderId, reason],
            );
            for (const r of rows) {
                if (r.voucher_id != null) {
                    await manager.query(
                        `UPDATE vouchers
                         SET uses = GREATEST(uses - 1, 0),
                             status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END
                         WHERE id = $1`,
                        [r.voucher_id],
                    );
                }
            }
        });
    }

    private async resolveAutoDiscount(
        tenantId: number,
        subtotal: number,
        source: string,
        branchId: number,
        brandId: number | null,
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
            quantity?: number;
            sizeKey?: string | null;
        }[],
        fullCardPayment = false,
        bankCardId: number | null = null,
    ): Promise<{
        discountAmount: number;
        discountCode: string | null;
        discountId: number | null;
        scope: string;
        scopeIds: number[];
        discountableAmount: number;
        eligibilityBrandIds: number[] | null;
    }> {
        const discounts = await this.discountRepo.find({
            where: { tenantId, isActive: true, requiresCode: false },
        });
        const now = new Date();
        let best = {
            ...this.discountResultEmpty,
            eligibilityBrandIds: null as number[] | null,
        };
        for (const discount of discounts) {
            if (discount.validFrom && now < discount.validFrom) continue;
            if (discount.validUntil && now > discount.validUntil) continue;
            if (!(await this.isDiscountValidForBranchTime(discount, branchId)))
                continue;
            if (
                discount.minOrderAmount != null &&
                Number(discount.minOrderAmount) > subtotal
            )
                continue;
            if (discount.posOnly && source !== 'pos') continue;
            // Card-linked offer: applies only when the WHOLE bill is paid by an eligible card.
            if (discount.requiresCard) {
                if (!fullCardPayment || bankCardId == null) continue;
                const ids = (discount.eligibleBankCardIds ?? []).map(Number);
                if (!ids.includes(Number(bankCardId))) continue;
            }
            const eligibilityBranchIds = discount.eligibilityBranchIds ?? null;
            const eligibilityBrandIds = discount.eligibilityBrandIds ?? null;
            if (
                eligibilityBranchIds != null &&
                eligibilityBranchIds.length > 0 &&
                !eligibilityBranchIds.includes(branchId)
            )
                continue;
            const brandSet =
                eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                    ? new Set(
                          (eligibilityBrandIds as unknown[]).map(
                              (id: unknown) => Number(id),
                          ),
                      )
                    : null;
            if (brandId != null) {
                if (brandSet != null && !brandSet.has(Number(brandId)))
                    continue;
            } else {
                if (brandSet != null) {
                    const hasEligibleLine = lineDetails.some((l, i) => {
                        const lineBrand = this.lineDetailBrandId(
                            l,
                            i,
                            lineDetails,
                        );
                        return (
                            lineBrand != null && brandSet.has(Number(lineBrand))
                        );
                    });
                    if (!hasEligibleLine) continue;
                }
            }
            const scope = discount.applicationScope ?? 'whole_order';
            const scopeIds = (discount.applicationScopeIds ?? []).map(
                (id: unknown) => Number(id),
            );
            const inScope = (
                l: { menuItemId: number; categoryId: number },
                i: number,
            ) => {
                if (
                    scope === 'category' &&
                    scopeIds.length > 0 &&
                    !scopeIds.includes(l.categoryId)
                )
                    return false;
                if (
                    scope === 'products' &&
                    scopeIds.length > 0 &&
                    !scopeIds.includes(l.menuItemId)
                )
                    return false;
                if (brandSet != null && brandId == null) {
                    const lineBrand = this.lineDetailBrandId(
                        lineDetails[i],
                        i,
                        lineDetails,
                    );
                    if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                        return false;
                }
                return true;
            };
            let discountableAmount = 0;
            const eligibleLines: typeof lineDetails = [];
            lineDetails.forEach((l, i) => {
                if (inScope(l, i)) {
                    discountableAmount += l.itemSubtotal;
                    eligibleLines.push(l);
                }
            });
            if (discountableAmount <= 0) continue;
            let discountAmount = 0;
            if (discount.type === 'buy_x_get_y') {
                discountAmount = this.computeBogoDiscount(
                    discount,
                    eligibleLines,
                );
                if (discount.maxDiscountAmount != null)
                    discountAmount = Math.min(
                        discountAmount,
                        Number(discount.maxDiscountAmount),
                    );
            } else if (discount.type === 'flat') {
                discountAmount = Math.min(
                    Number(discount.value),
                    discountableAmount,
                );
                if (discount.maxDiscountAmount != null)
                    discountAmount = Math.min(
                        discountAmount,
                        Number(discount.maxDiscountAmount),
                    );
            } else {
                discountAmount =
                    (discountableAmount * Number(discount.value)) / 100;
                if (discount.maxDiscountAmount != null)
                    discountAmount = Math.min(
                        discountAmount,
                        Number(discount.maxDiscountAmount),
                    );
            }
            if (discountAmount > best.discountAmount) {
                best = {
                    discountAmount,
                    discountCode: discount.code ?? null,
                    discountId: discount.id,
                    scope,
                    scopeIds,
                    discountableAmount,
                    eligibilityBrandIds,
                };
            }
        }
        return best;
    }

    /** Resolve coupon/promo discount (by code). Multi-brand: brand-scoped discounts apply to eligible portion only. */
    private async resolveCouponDiscount(
        tenantId: number,
        code: string | null,
        baseAmount: number,
        source: string,
        branchId: number,
        brandId: number | null,
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
            quantity?: number;
            sizeKey?: string | null;
        }[],
        lineAfterAuto: number[] | null,
        fullCardPayment = false,
        bankCardId: number | null = null,
    ): Promise<{
        discountAmount: number;
        discountCode: string | null;
        discountId: number | null;
        scope: string;
        scopeIds: number[];
        discountableAmount: number;
        eligibilityBrandIds: number[] | null;
    }> {
        const empty = {
            ...this.discountResultEmpty,
            discountableAmount: baseAmount,
            eligibilityBrandIds: null as number[] | null,
        };
        if (!code?.trim()) return empty;
        const discount = await this.discountRepo.findOne({
            where: { code: code.trim(), tenantId, isActive: true },
        });
        if (!discount) return empty;
        const now = new Date();
        if (discount.validFrom && now < discount.validFrom) return empty;
        if (discount.validUntil && now > discount.validUntil) return empty;
        if (!(await this.isDiscountValidForBranchTime(discount, branchId)))
            return empty;
        if (
            discount.minOrderAmount != null &&
            Number(discount.minOrderAmount) > baseAmount
        )
            return empty;
        if (discount.posOnly && source !== 'pos') return empty;
        // Card-linked offer: applies only when the WHOLE bill is paid by an eligible card.
        if (discount.requiresCard) {
            if (!fullCardPayment || bankCardId == null) return empty;
            const ids = (discount.eligibleBankCardIds ?? []).map(Number);
            if (!ids.includes(Number(bankCardId))) return empty;
        }
        const eligibilityBranchIds = discount.eligibilityBranchIds ?? null;
        const eligibilityBrandIds = discount.eligibilityBrandIds ?? null;
        if (
            eligibilityBranchIds != null &&
            eligibilityBranchIds.length > 0 &&
            !eligibilityBranchIds.includes(branchId)
        )
            return empty;
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(
                      (eligibilityBrandIds as unknown[]).map((id: unknown) =>
                          Number(id),
                      ),
                  )
                : null;
        if (brandId != null) {
            if (brandSet != null && !brandSet.has(Number(brandId)))
                return empty;
        } else {
            if (brandSet != null) {
                const hasEligibleLine = lineDetails.some((l, i) => {
                    const lineBrand = this.lineDetailBrandId(l, i, lineDetails);
                    return lineBrand != null && brandSet.has(Number(lineBrand));
                });
                if (!hasEligibleLine) return empty;
            }
        }
        const scope = discount.applicationScope ?? 'whole_order';
        const scopeIds = (discount.applicationScopeIds ?? []).map(
            (id: unknown) => Number(id),
        );
        const inScope = (
            l: { menuItemId: number; categoryId: number },
            i: number,
        ) => {
            if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && brandId == null) {
                const lineBrand = this.lineDetailBrandId(
                    lineDetails[i],
                    i,
                    lineDetails,
                );
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        let discountableAmount = 0;
        if (
            lineAfterAuto != null &&
            lineAfterAuto.length === lineDetails.length
        ) {
            lineDetails.forEach((l, i) => {
                if (inScope(l, i)) discountableAmount += lineAfterAuto[i] ?? 0;
            });
        } else {
            lineDetails.forEach((l, i) => {
                if (inScope(l, i)) discountableAmount += l.itemSubtotal;
            });
        }
        discountableAmount = Math.min(discountableAmount, baseAmount);
        if (discountableAmount <= 0) return empty;
        let discountAmount = 0;
        if (discount.type === 'buy_x_get_y') {
            const eligibleLines = lineDetails.filter((l, i) => inScope(l, i));
            discountAmount = Math.min(
                this.computeBogoDiscount(discount, eligibleLines),
                discountableAmount,
            );
            if (discount.maxDiscountAmount != null)
                discountAmount = Math.min(
                    discountAmount,
                    Number(discount.maxDiscountAmount),
                );
        } else if (discount.type === 'flat') {
            discountAmount = Math.min(
                Number(discount.value),
                discountableAmount,
            );
            if (discount.maxDiscountAmount != null)
                discountAmount = Math.min(
                    discountAmount,
                    Number(discount.maxDiscountAmount),
                );
        } else {
            discountAmount =
                (discountableAmount * Number(discount.value)) / 100;
            if (discount.maxDiscountAmount != null)
                discountAmount = Math.min(
                    discountAmount,
                    Number(discount.maxDiscountAmount),
                );
        }
        return {
            discountAmount,
            discountCode: discount.code ?? null,
            discountId: discount.id,
            scope,
            scopeIds,
            discountableAmount,
            eligibilityBrandIds,
        };
    }

    /** Allocate discount to lines using "after auto" amounts (for coupon stacking). When multi-brand + brand filter, only eligible lines get share. */
    private allocateDiscountToLinesUsingBase(
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
            quantity?: number;
            sizeKey?: string | null;
        }[],
        baseAmounts: number[],
        totalBase: number,
        discountAmount: number,
        scope: string,
        scopeIds: number[],
        discountableAmount: number,
        orderBrandId: number | null,
        eligibilityBrandIds: number[] | null,
    ): number[] {
        if (
            discountAmount <= 0 ||
            lineDetails.length === 0 ||
            totalBase <= 0 ||
            discountableAmount <= 0
        )
            return lineDetails.map(() => 0);
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(eligibilityBrandIds.map((id: number) => Number(id)))
                : null;
        const inScope = (i: number) => {
            const l = lineDetails[i];
            if (scope === 'whole_order') {
                void 0; /* all lines in scope */
            } else if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            else if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && orderBrandId == null) {
                const lineBrand = this.lineDetailBrandId(l, i, lineDetails);
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        const allocated = lineDetails.map((_, i) =>
            !inScope(i)
                ? 0
                : Math.round(
                      discountAmount *
                          (baseAmounts[i] / discountableAmount) *
                          100,
                  ) / 100,
        );
        const sum = allocated.reduce((a, b) => a + b, 0);
        if (sum !== discountAmount && allocated.length > 0) {
            const diff = Math.round((discountAmount - sum) * 100) / 100;
            let lastIdx = -1;
            for (let i = lineDetails.length - 1; i >= 0; i--)
                if (inScope(i)) {
                    lastIdx = i;
                    break;
                }
            if (lastIdx >= 0)
                allocated[lastIdx] =
                    Math.round((allocated[lastIdx] + diff) * 100) / 100;
        }
        return allocated;
    }

    /** Allocate total discount to lines by scope (proportional to discountable amount). When multi-brand + brand filter, only eligible lines get share. */
    private allocateDiscountToLines(
        lineDetails: {
            menuItemId: number;
            categoryId: number;
            itemSubtotal: number;
            brandId?: number;
            quantity?: number;
            sizeKey?: string | null;
        }[],
        subtotal: number,
        discountAmount: number,
        scope: string,
        scopeIds: number[],
        discountableAmount: number,
        orderBrandId: number | null,
        eligibilityBrandIds: number[] | null,
    ): number[] {
        if (discountAmount <= 0 || lineDetails.length === 0)
            return lineDetails.map(() => 0);
        const brandSet =
            eligibilityBrandIds != null && eligibilityBrandIds.length > 0
                ? new Set(eligibilityBrandIds.map((id: number) => Number(id)))
                : null;
        const inScope = (i: number) => {
            const l = lineDetails[i];
            if (scope === 'whole_order') {
                void 0; /* all lines in scope */
            } else if (
                scope === 'category' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.categoryId)
            )
                return false;
            else if (
                scope === 'products' &&
                scopeIds.length > 0 &&
                !scopeIds.includes(l.menuItemId)
            )
                return false;
            if (brandSet != null && orderBrandId == null) {
                const lineBrand = this.lineDetailBrandId(l, i, lineDetails);
                if (lineBrand == null || !brandSet.has(Number(lineBrand)))
                    return false;
            }
            return true;
        };
        if (discountableAmount <= 0) return lineDetails.map(() => 0);
        const allocated = lineDetails.map((l, i) => {
            if (!inScope(i)) return 0;
            return (
                Math.round(
                    discountAmount *
                        (l.itemSubtotal / discountableAmount) *
                        100,
                ) / 100
            );
        });
        const sum = allocated.reduce((a, b) => a + b, 0);
        if (sum !== discountAmount && allocated.length > 0) {
            const diff = Math.round((discountAmount - sum) * 100) / 100;
            let lastIdx = -1;
            for (let i = lineDetails.length - 1; i >= 0; i--)
                if (inScope(i)) {
                    lastIdx = i;
                    break;
                }
            if (lastIdx >= 0)
                allocated[lastIdx] =
                    Math.round((allocated[lastIdx] + diff) * 100) / 100;
        }
        return allocated;
    }

    /**
     * Generate both identifiers for one order from a single daily counter.
     *
     * `orderId`  — permanent tracking reference: `BR-{brandId}-{branchId}-{YYYYMMDD}-{seq}`
     *              e.g. `BR-23-10-20260617-001`. Globally unique, shared with customer.
     * `orderNumber` — short daily call-out number: `001`, `002` …
     *              Resets each day per branch+brand. Staff use this to call out orders.
     */
    private async generateOrderIdentifiers(
        branchId: number,
        brandId: number,
    ): Promise<{ orderId: string; orderNumber: string }> {
        const todayStr = new Date().toISOString().slice(0, 10);
        const dateCompact = todayStr.replace(/-/g, '');
        // Count within the exact order_id namespace (prefix match) rather than by
        // date(placed_at): the order_id embeds the UTC date, but date(placed_at) is
        // evaluated in the server's local timezone, so the two disagree in the
        // local-vs-UTC midnight window and would regenerate a colliding sequence.
        const prefix = `BR-${brandId}-${branchId}-${dateCompact}-`;
        const count = await this.orderRepo
            .createQueryBuilder('o')
            .where('o.branchId = :branchId', { branchId })
            .andWhere('o.brandId = :brandId', { brandId })
            .andWhere('o.orderId LIKE :prefix', { prefix: `${prefix}%` })
            .getCount();
        const seq = String(count + 1).padStart(3, '0');
        return {
            orderId: `${prefix}${seq}`,
            orderNumber: seq,
        };
    }
}
