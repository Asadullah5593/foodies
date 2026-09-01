import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Order } from '../entities/order.entity';

type SupervisorUser = {
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
    /**
     * `roles.order_history_days` — the same per-role window that limits the
     * admin Orders page. Positive = the caller may only reach back that many
     * calendar days; null/0 = unlimited. Configured per role in Roles.
     */
    orderHistoryDays?: number | null;
    /**
     * Holds `rider-supervisor:view-status`. When false the order status is
     * withheld from the payload entirely — not merely hidden by the UI — so
     * the bucket counts and the status filter go with it.
     */
    canViewStatus?: boolean;
};

/** Default range (calendar days, incl. today) shown when no dates are picked. */
const WINDOW_DAYS = 30;

/** Normalise the role window: a positive integer, or null for unlimited. */
function resolveHistoryDays(days?: number | null): number | null {
    return days != null && Number.isFinite(days) && days > 0
        ? Math.floor(days)
        : null;
}

/** Accept only YYYY-MM-DD (the date inputs' format); anything else is ignored. */
function parseDateParam(raw?: string | null): string | null {
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? null : v;
}

/** Delivery-order statuses grouped into the supervisor's filter buckets. */
const STATUS_GROUPS: Record<string, string[]> = {
    active: ['placed', 'accepted', 'preparing', 'ready'],
    delivered: ['completed'],
    cancelled: ['cancelled'],
};

/**
 * Read-only oversight queries for the "Rider supervisor" sub-module. All data
 * is scoped to the caller's tenant + branch(es) + brand(s), mirroring the admin
 * order list (`OrdersService.findAllAdmin`) and rider listing conventions so a
 * branch/brand-locked supervisor only ever sees their own slice.
 */
@Injectable()
export class RiderSupervisorService {
    constructor(
        @InjectRepository(Order)
        private readonly orderRepo: Repository<Order>,
        private readonly dataSource: DataSource,
    ) {}

    /**
     * Recent delivery orders (last 30 days), bucketed by status. Returns a
     * compact row shape plus per-bucket counts so the UI can label its tabs.
     */
    async listDeliveryOrders(
        user: SupervisorUser,
        filters: {
            status?: string;
            page?: number;
            page_size?: number;
            brand_id?: number;
            branch_id?: number;
            rider_id?: number;
            /** Placement-date range, YYYY-MM-DD (inclusive). */
            date_from?: string;
            date_to?: string;
        },
    ) {
        const tenantId = user.tenantId;
        const allowedBranchIds = user.allowedBranchIds ?? null;
        const allowedBrandIds = user.allowedBrandIds ?? null;
        const historyDays = resolveHistoryDays(user.orderHistoryDays);
        const canViewStatus = user.canViewStatus !== false;

        // Optional narrowing filters, validated against the caller's scope.
        const branchFilter =
            filters.branch_id != null && Number.isFinite(filters.branch_id)
                ? Math.floor(filters.branch_id)
                : null;
        const brandFilter =
            filters.brand_id != null && Number.isFinite(filters.brand_id)
                ? Math.floor(filters.brand_id)
                : null;
        if (
            branchFilter != null &&
            allowedBranchIds != null &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(branchFilter)
        )
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        if (
            brandFilter != null &&
            allowedBrandIds != null &&
            !allowedBrandIds.includes(brandFilter)
        )
            throw new ForbiddenException(
                'You do not have access to this brand',
            );

        const riderFilter =
            filters.rider_id != null && Number.isFinite(filters.rider_id)
                ? Math.floor(filters.rider_id)
                : null;
        const dateFrom = parseDateParam(filters.date_from);
        const dateTo = parseDateParam(filters.date_to);

        const page = Math.max(1, Math.floor(Number(filters.page)) || 1);
        const pageSize = Math.min(
            200,
            Math.max(1, Math.floor(Number(filters.page_size)) || 25),
        );
        // Without the status permission the status filter is ignored too —
        // otherwise the buckets would leak exactly what the column hides.
        const statusGroup =
            canViewStatus &&
            typeof filters.status === 'string' &&
            filters.status in STATUS_GROUPS
                ? filters.status
                : 'all';

        // Common scope: this tenant, the caller's branches/brands, delivery
        // only, placed within the last WINDOW_DAYS calendar days (incl. today).
        const applyCommon = (qb: SelectQueryBuilder<Order>): void => {
            qb.where("o.orderType = 'delivery'");
            if (tenantId != null)
                qb.andWhere('o.tenantId = :tenantId', { tenantId });
            if (
                allowedBranchIds != null &&
                Array.isArray(allowedBranchIds) &&
                allowedBranchIds.length > 0
            )
                qb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                    allowedBranchIds,
                });
            // Brand-locked callers only ever see their own brand's orders.
            if (allowedBrandIds != null) {
                if (allowedBrandIds.length > 0)
                    qb.andWhere('o.brandId IN (:...allowedBrandIds)', {
                        allowedBrandIds,
                    });
                else qb.andWhere('1 = 0');
            }
            // Placement-date range. With no dates picked the page keeps its
            // default last-30-days view; explicit dates may reach further back,
            // but never past the role's history window (the floor below).
            if (dateFrom)
                qb.andWhere('date(o.placed_at) >= :dateFrom', { dateFrom });
            else if (!dateTo)
                qb.andWhere(
                    'date(o.placed_at) >= (CURRENT_DATE - CAST(:days AS int) + 1)',
                    { days: WINDOW_DAYS },
                );
            if (dateTo) qb.andWhere('date(o.placed_at) <= :dateTo', { dateTo });
            // Hard floor from `roles.order_history_days`, applied on top of any
            // client date_from so a restricted role cannot widen its own range.
            // Date maths runs in the DB (server timezone); N days is N calendar
            // days inclusive of today — identical to the admin Orders list.
            if (historyDays != null)
                qb.andWhere(
                    'date(o.placed_at) >= (CURRENT_DATE - CAST(:historyDays AS int) + 1)',
                    { historyDays },
                );
            if (branchFilter != null)
                qb.andWhere('o.branchId = :branchFilter', { branchFilter });
            if (brandFilter != null)
                qb.andWhere('o.brandId = :brandFilter', { brandFilter });
            if (riderFilter != null)
                qb.andWhere('o.riderId = :riderFilter', { riderFilter });
        };

        // Bucket counts over the common set (every bucket keeps a full count).
        // Withheld entirely without the status permission — per-status counts
        // would reveal the same information as the column itself.
        const countsQb = this.orderRepo
            .createQueryBuilder('o')
            .select('o.status', 'status')
            .addSelect('COUNT(*)', 'count');
        applyCommon(countsQb);
        const rawCounts = await countsQb
            .groupBy('o.status')
            .getRawMany<{ status: string; count: string }>();
        const tally = { active: 0, delivered: 0, cancelled: 0, all: 0 };
        for (const r of rawCounts) {
            const n = Number(r.count) || 0;
            tally.all += n;
            if (STATUS_GROUPS.active.includes(r.status)) tally.active += n;
            else if (STATUS_GROUPS.delivered.includes(r.status))
                tally.delivered += n;
            else if (STATUS_GROUPS.cancelled.includes(r.status))
                tally.cancelled += n;
        }
        const counts = canViewStatus ? tally : null;

        // Data page for the selected bucket.
        const dataQb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.brand', 'brand')
            .leftJoinAndSelect('o.branch', 'branch')
            .leftJoinAndSelect('o.rider', 'rider');
        applyCommon(dataQb);
        if (statusGroup !== 'all')
            dataQb.andWhere('o.status IN (:...statuses)', {
                statuses: STATUS_GROUPS[statusGroup],
            });
        dataQb
            .orderBy('o.id', 'DESC')
            .skip((page - 1) * pageSize)
            .take(pageSize);
        const [rows, total] = await dataQb.getManyAndCount();

        return {
            data: rows.map((o) => ({
                id: o.id,
                order_id: o.orderId,
                order_number: o.orderNumber,
                // Withheld (not just hidden) without rider-supervisor:view-status.
                status: canViewStatus ? o.status : null,
                delivery_status: o.deliveryStatus,
                placed_at: o.placedAt?.toISOString() ?? null,
                completed_at: o.completedAt?.toISOString() ?? null,
                cancelled_at: o.cancelledAt?.toISOString() ?? null,
                total_amount: Number(o.totalAmount),
                delivery_fee: Number(o.deliveryFee),
                delivery_tier: o.deliveryTier,
                delivery_address: o.deliveryAddress,
                customer_name: o.customerName,
                customer_phone: o.customerPhone,
                brand_id: o.brandId,
                brand_name: o.brand?.name ?? null,
                branch_id: o.branchId,
                branch_name: o.branch?.name ?? null,
                rider_id: o.riderId,
                rider_name: o.rider?.name ?? null,
            })),
            total,
            page,
            page_size: pageSize,
            status: statusGroup,
            counts,
            // Echo the applied range so the UI can show exactly what it asked
            // for, plus the role's ceiling for its date-picker limits.
            date_from: dateFrom,
            date_to: dateTo,
            history_days: historyDays,
            can_view_status: canViewStatus,
        };
    }

    /**
     * Live rider roster: identity, base salary and current attendance
     * (active / on-break / off) with the latest check-in/out. Riders are the
     * tenant's brand-linked riders (rider_brands), clamped to the caller's
     * brands when brand-locked; an optional branch filter narrows to riders
     * currently present at that branch.
     */
    async listRiders(
        user: SupervisorUser,
        filters: {
            branchId?: number;
            brandId?: number;
            status?: string;
            riderId?: number;
        },
    ) {
        const tenantId = user.tenantId;
        if (tenantId == null)
            throw new BadRequestException('Tenant context required');
        const allowedBranchIds = user.allowedBranchIds ?? null;
        const allowedBrandIds = user.allowedBrandIds ?? null;

        const branchId =
            filters.branchId != null && Number.isFinite(filters.branchId)
                ? Math.floor(filters.branchId)
                : null;
        if (
            branchId != null &&
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(branchId)
        )
            throw new ForbiddenException(
                'You do not have access to this branch',
            );

        const params: unknown[] = [tenantId];
        let brandFilterSql = '';
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length === 0) return [];
            params.push(allowedBrandIds);
            brandFilterSql = ` AND rb.brand_id = ANY($${params.length}::int[])`;
        }
        // Optional single-brand narrowing, validated against the brand lock.
        const brandFilter =
            filters.brandId != null && Number.isFinite(filters.brandId)
                ? Math.floor(filters.brandId)
                : null;
        if (
            brandFilter != null &&
            allowedBrandIds != null &&
            !allowedBrandIds.includes(brandFilter)
        )
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        if (brandFilter != null) {
            params.push(brandFilter);
            brandFilterSql += ` AND rb.brand_id = $${params.length}`;
        }
        let branchFilterSql = '';
        if (branchId != null) {
            params.push(branchId);
            branchFilterSql = ` AND pres.branch_id = $${params.length}`;
        }
        // Single-rider narrowing. Applied in SQL (not post-filtered) so the
        // brand/branch scope above still bounds what can be selected.
        const riderId =
            filters.riderId != null && Number.isFinite(filters.riderId)
                ? Math.floor(filters.riderId)
                : null;
        let riderFilterSql = '';
        if (riderId != null) {
            params.push(riderId);
            riderFilterSql = ` AND u.id = $${params.length}`;
        }

        const rows: Array<{
            rider_user_id: number;
            name: string;
            email: string | null;
            phone: string | null;
            base_salary: string | null;
            salary_type: string | null;
            employment_status: string | null;
            is_checked_in: boolean | null;
            is_paused: boolean | null;
            pause_reason: string | null;
            presence_branch_id: number | null;
            branch_name: string | null;
            last_heartbeat_at: Date | null;
            last_check_in_at: Date | null;
            last_check_out_at: Date | null;
            attendance_status: string | null;
        }> = await this.dataSource.query(
            `SELECT DISTINCT u.id AS rider_user_id, u.name, u.email, u.phone,
                    rp.base_salary, rp.salary_type, rp.employment_status,
                    pres.is_checked_in, pres.is_paused, pres.pause_reason,
                    pres.branch_id AS presence_branch_id, b.name AS branch_name,
                    pres.last_heartbeat_at,
                    sess.checked_in_at AS last_check_in_at,
                    sess.checked_out_at AS last_check_out_at,
                    sess.status AS attendance_status
             FROM users u
             INNER JOIN rider_brands rb
                 ON rb.rider_user_id = u.id AND rb.tenant_id = $1${brandFilterSql}
             LEFT JOIN rider_profiles rp
                 ON rp.user_id = u.id AND rp.tenant_id = $1
             LEFT JOIN rider_presences pres ON pres.rider_user_id = u.id
             LEFT JOIN branches b ON b.id = pres.branch_id
             LEFT JOIN LATERAL (
                 SELECT s.checked_in_at, s.checked_out_at, s.status
                 FROM rider_attendance_sessions s
                 WHERE s.rider_user_id = u.id
                 ORDER BY s.checked_in_at DESC
                 LIMIT 1
             ) sess ON true
             WHERE u.status = 'active'${branchFilterSql}${riderFilterSql}
             ORDER BY u.name ASC`,
            params,
        );

        // The brand(s) each rider serves (a rider may own/share several).
        // Kept out of the roster query — a rider with N brands would otherwise
        // fan the row out N times. Clamped to a brand-locked caller's brands.
        const riderIds = rows.map((r) => Number(r.rider_user_id));
        const brandParams: unknown[] = [tenantId, riderIds];
        let brandScopeSql = '';
        if (allowedBrandIds != null) {
            brandParams.push(allowedBrandIds);
            brandScopeSql = ` AND rb.brand_id = ANY($3::int[])`;
        }
        const brandLinks: Array<{ rider_user_id: number; name: string }> =
            riderIds.length
                ? await this.dataSource.query(
                      `SELECT rb.rider_user_id, br.name
                       FROM rider_brands rb
                       INNER JOIN brands br ON br.id = rb.brand_id
                       WHERE rb.tenant_id = $1
                         AND rb.rider_user_id = ANY($2::int[])${brandScopeSql}
                       ORDER BY br.name ASC`,
                      brandParams,
                  )
                : [];
        const brandsByRider = new Map<number, string[]>();
        for (const l of brandLinks) {
            const rid = Number(l.rider_user_id);
            const arr = brandsByRider.get(rid) ?? [];
            if (!arr.includes(l.name)) arr.push(l.name);
            brandsByRider.set(rid, arr);
        }

        const wantStatus =
            typeof filters.status === 'string' &&
            ['active', 'on_break', 'off'].includes(filters.status)
                ? filters.status
                : null;

        const mapped = rows.map((r) => {
            const checkedIn = r.is_checked_in === true;
            const paused = r.is_paused === true;
            const status = !checkedIn ? 'off' : paused ? 'on_break' : 'active';
            return {
                rider_user_id: Number(r.rider_user_id),
                name: r.name,
                phone: r.phone,
                email: r.email,
                base_salary:
                    r.base_salary != null ? Number(r.base_salary) : null,
                salary_type: r.salary_type,
                employment_status: r.employment_status,
                status,
                is_checked_in: checkedIn,
                is_paused: paused,
                pause_reason: r.pause_reason,
                branch_id:
                    r.presence_branch_id != null
                        ? Number(r.presence_branch_id)
                        : null,
                branch_name: r.branch_name,
                brands: brandsByRider.get(Number(r.rider_user_id)) ?? [],
                last_heartbeat_at: r.last_heartbeat_at?.toISOString() ?? null,
                last_check_in_at: r.last_check_in_at?.toISOString() ?? null,
                last_check_out_at: r.last_check_out_at?.toISOString() ?? null,
                attendance_status: r.attendance_status,
            };
        });
        return wantStatus
            ? mapped.filter((r) => r.status === wantStatus)
            : mapped;
    }

    /**
     * Brand + branch options for the supervisor's filters, scoped to what the
     * caller may see. Lets the read-only page offer filters without reaching the
     * permission-gated /admin/brands or /admin/branches endpoints.
     */
    async getFilterOptions(user: SupervisorUser) {
        const tenantId = user.tenantId;
        if (tenantId == null)
            throw new BadRequestException('Tenant context required');
        const allowedBranchIds = user.allowedBranchIds ?? null;
        const allowedBrandIds = user.allowedBrandIds ?? null;

        // Branches the caller may see. Branches carry no tenant column — they
        // belong to a tenant via their brands (branch_brands → brands).
        const branchParams: unknown[] = [tenantId];
        let branchClause = '';
        if (allowedBranchIds != null) {
            if (allowedBranchIds.length === 0)
                return {
                    branches: [],
                    brands: [],
                    riders: [],
                    history_days: resolveHistoryDays(user.orderHistoryDays),
                };
            branchParams.push(allowedBranchIds);
            branchClause = ` AND br.id = ANY($${branchParams.length}::int[])`;
        }
        const branchRows: Array<{ id: number; name: string; is_active: boolean }> =
            await this.dataSource.query(
                `SELECT DISTINCT br.id, br.name, br.is_active FROM branches br
                 INNER JOIN branch_brands bb ON bb.branch_id = br.id
                 INNER JOIN brands b ON b.id = bb.brand_id AND b.tenant_id = $1
                 WHERE true${branchClause}
                 ORDER BY br.name ASC`,
                branchParams,
            );
        const branches = branchRows.map((r) => ({
            id: Number(r.id),
            name: r.name,
            is_active: r.is_active,
        }));

        // Brands available at those branches, clamped to a brand lock.
        const brandParams: unknown[] = [tenantId];
        let brandBranchClause = '';
        if (allowedBranchIds != null && allowedBranchIds.length > 0) {
            brandParams.push(allowedBranchIds);
            brandBranchClause = ` AND bb.branch_id = ANY($${brandParams.length}::int[])`;
        }
        let brandLockClause = '';
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length === 0)
                return {
                    branches,
                    brands: [],
                    riders: [],
                    history_days: resolveHistoryDays(user.orderHistoryDays),
                };
            brandParams.push(allowedBrandIds);
            brandLockClause = ` AND b.id = ANY($${brandParams.length}::int[])`;
        }
        const brandRows: Array<{ id: number; name: string }> =
            await this.dataSource.query(
                `SELECT DISTINCT b.id, b.name FROM brands b
                 INNER JOIN branch_brands bb ON bb.brand_id = b.id
                 WHERE b.tenant_id = $1 AND b.is_active = true${brandBranchClause}${brandLockClause}
                 ORDER BY b.name ASC`,
                brandParams,
            );
        const brands = brandRows.map((r) => ({
            id: Number(r.id),
            name: r.name,
        }));

        // Riders the caller may see — the same rider_brands scope the roster
        // uses, so the dropdown can never offer someone outside their brands.
        const riderParams: unknown[] = [tenantId];
        let riderBrandClause = '';
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length === 0)
                return {
                    branches,
                    brands,
                    riders: [],
                    history_days: resolveHistoryDays(user.orderHistoryDays),
                };
            riderParams.push(allowedBrandIds);
            riderBrandClause = ` AND rb.brand_id = ANY($${riderParams.length}::int[])`;
        }
        const riderRows: Array<{ id: number; name: string }> =
            await this.dataSource.query(
                `SELECT DISTINCT u.id, u.name FROM users u
                 INNER JOIN rider_brands rb
                     ON rb.rider_user_id = u.id AND rb.tenant_id = $1${riderBrandClause}
                 WHERE u.status = 'active'
                 ORDER BY u.name ASC`,
                riderParams,
            );
        const riders = riderRows.map((r) => ({
            id: Number(r.id),
            name: r.name,
        }));

        return {
            branches,
            brands,
            riders,
            // How far back this role may look (null = unlimited) so the page
            // can bound its date pickers and explain the limit.
            history_days: resolveHistoryDays(user.orderHistoryDays),
        };
    }
}
