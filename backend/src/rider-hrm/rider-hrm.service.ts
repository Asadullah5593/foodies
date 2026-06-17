import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { RiderProfile } from '../entities/rider-profile.entity';
import { RiderAttendanceSession } from '../entities/rider-attendance-session.entity';
import { RiderBreakSession } from '../entities/rider-break-session.entity';
import { RiderPresence } from '../entities/rider-presence.entity';
import { RiderCompPlan } from '../entities/rider-comp-plan.entity';
import { RiderCompPlanComponent } from '../entities/rider-comp-plan-component.entity';
import { RiderPayrollRun } from '../entities/rider-payroll-run.entity';
import { RiderPayrollLine } from '../entities/rider-payroll-line.entity';
import { RiderPayrollLineItem } from '../entities/rider-payroll-line-item.entity';
import { Branch } from '../entities/branch.entity';
import { RiderOpsMetricsService } from './rider-ops-metrics.service';
import { componentAmount, proratedAmount } from './payroll.utils';

@Injectable()
export class RiderHrmService {
    constructor(
        @InjectRepository(RiderProfile)
        private readonly riderProfileRepo: Repository<RiderProfile>,
        @InjectRepository(RiderAttendanceSession)
        private readonly attendanceRepo: Repository<RiderAttendanceSession>,
        @InjectRepository(RiderBreakSession)
        private readonly breakSessionRepo: Repository<RiderBreakSession>,
        @InjectRepository(RiderPresence)
        private readonly presenceRepo: Repository<RiderPresence>,
        @InjectRepository(RiderCompPlan)
        private readonly compPlanRepo: Repository<RiderCompPlan>,
        @InjectRepository(RiderCompPlanComponent)
        private readonly compComponentRepo: Repository<RiderCompPlanComponent>,
        @InjectRepository(RiderPayrollRun)
        private readonly payrollRunRepo: Repository<RiderPayrollRun>,
        @InjectRepository(RiderPayrollLine)
        private readonly payrollLineRepo: Repository<RiderPayrollLine>,
        @InjectRepository(RiderPayrollLineItem)
        private readonly payrollLineItemRepo: Repository<RiderPayrollLineItem>,
        @InjectRepository(Branch)
        private readonly branchRepo: Repository<Branch>,
        private readonly metrics: RiderOpsMetricsService,
        private readonly dataSource: DataSource,
    ) {}

    private async assertRiderAtBranch(
        riderUserId: number,
        branchId: number,
    ): Promise<void> {
        const rows: Array<{ ok: number }> = await this.dataSource.query(
            `SELECT 1 AS ok
             FROM branch_users bu
             INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
             WHERE bu.user_id = $1 AND bu.branch_id = $2
             LIMIT 1`,
            [riderUserId, branchId],
        );
        if (rows.length === 0) {
            throw new ForbiddenException(
                'Rider is not assigned to this branch as rider',
            );
        }
    }

    /**
     * Branches where the user is assigned with the `rider` role (for check-in picker / mobile apps).
     */
    async listRiderBranches(riderUserId: number) {
        const rows: Array<{
            id: number;
            name: string;
            code: string;
            address: string | null;
        }> = await this.dataSource.query(
            `SELECT b.id, b.name, b.code, b.address
             FROM branches b
             INNER JOIN branch_users bu ON bu.branch_id = b.id
             INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
             WHERE bu.user_id = $1
               AND b.is_active = true
               AND b.status = 'active'
             ORDER BY b.name ASC`,
            [riderUserId],
        );
        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            address: row.address ?? null,
        }));
    }

    private toAttendanceResponse(row: RiderAttendanceSession) {
        return {
            id: row.id,
            rider_user_id: row.riderUserId,
            branch_id: row.branchId,
            status: row.status,
            checked_in_at: row.checkedInAt?.toISOString() ?? null,
            checked_out_at: row.checkedOutAt?.toISOString() ?? null,
            notes: row.notes ?? null,
        };
    }

    private toBreakSessionResponse(row: RiderBreakSession) {
        return {
            id: row.id,
            rider_user_id: row.riderUserId,
            attendance_session_id: row.attendanceSessionId ?? null,
            branch_id: row.branchId ?? null,
            started_at: row.startedAt?.toISOString() ?? null,
            ended_at: row.endedAt?.toISOString() ?? null,
            reason: row.reason ?? null,
            created_at: row.createdAt?.toISOString() ?? null,
        };
    }

    private calcAttendanceMinutes(
        from: Date,
        to: Date,
        checkedInAt: Date,
        checkedOutAt: Date | null,
    ): number {
        const startMs = Math.max(from.getTime(), checkedInAt.getTime());
        const endMs = Math.min(
            to.getTime(),
            (checkedOutAt ?? new Date()).getTime(),
        );
        const diffMs = endMs - startMs;
        if (diffMs <= 0) return 0;
        return Math.floor(diffMs / (60 * 1000));
    }

    /**
     * A brand-locked admin may only manage HR profiles for riders linked to one
     * of their brands (owner/GM unrestricted).
     */
    private async assertRiderManageable(
        riderUserId: number,
        tenantId: number,
        allowedBrandIds: number[] | null | undefined,
    ): Promise<void> {
        if (allowedBrandIds == null) return;
        if (allowedBrandIds.length === 0) {
            throw new ForbiddenException(
                'You can only manage riders that belong to your own brand',
            );
        }
        const result: unknown = await this.dataSource.query(
            `SELECT 1 AS ok FROM rider_brands
             WHERE rider_user_id = $1 AND tenant_id = $2 AND brand_id = ANY($3::int[])
             LIMIT 1`,
            [riderUserId, tenantId, allowedBrandIds],
        );
        const rows = result as Array<{ ok: number }>;
        if (rows.length === 0) {
            throw new ForbiddenException(
                'You can only manage riders that belong to your own brand',
            );
        }
    }

    async upsertRiderProfile(
        tenantId: number,
        dto: {
            user_id: number;
            employment_status?: string;
            salary_type?: string;
            employee_code?: string;
            base_salary?: number;
            default_per_ride_commission?: number;
            max_active_orders?: number;
            min_rating?: number;
            min_timely_rate?: number;
            is_active?: boolean;
            metadata?: Record<string, unknown>;
        },
        allowedBrandIds?: number[] | null,
    ) {
        await this.assertRiderManageable(
            dto.user_id,
            tenantId,
            allowedBrandIds,
        );
        const existing = await this.riderProfileRepo.findOne({
            where: { userId: dto.user_id },
        });
        const row =
            existing ??
            this.riderProfileRepo.create({
                userId: dto.user_id,
                tenantId,
            });
        row.tenantId = tenantId;
        row.employmentStatus = dto.employment_status ?? row.employmentStatus;
        row.salaryType = dto.salary_type ?? row.salaryType;
        if (dto.employee_code !== undefined)
            row.employeeCode = dto.employee_code;
        if (dto.base_salary !== undefined) row.baseSalary = dto.base_salary;
        if (dto.default_per_ride_commission !== undefined)
            row.defaultPerRideCommission = dto.default_per_ride_commission;
        if (dto.max_active_orders !== undefined)
            row.maxActiveOrders = dto.max_active_orders;
        if (dto.min_rating !== undefined) row.minRating = dto.min_rating;
        if (dto.min_timely_rate !== undefined)
            row.minTimelyRate = dto.min_timely_rate;
        if (dto.is_active !== undefined) row.isActive = dto.is_active;
        if (dto.metadata !== undefined) row.metadata = dto.metadata;
        const saved = await this.riderProfileRepo.save(row);
        return {
            id: saved.id,
            user_id: saved.userId,
            tenant_id: saved.tenantId,
            employment_status: saved.employmentStatus,
            salary_type: saved.salaryType,
            employee_code: saved.employeeCode,
            base_salary: Number(saved.baseSalary),
            default_per_ride_commission: Number(saved.defaultPerRideCommission),
            max_active_orders: saved.maxActiveOrders,
            min_rating:
                saved.minRating != null ? Number(saved.minRating) : null,
            min_timely_rate:
                saved.minTimelyRate != null
                    ? Number(saved.minTimelyRate)
                    : null,
            is_active: saved.isActive,
            metadata: saved.metadata ?? {},
        };
    }

    async listRiderProfiles(
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const rows = await this.riderProfileRepo.find({
            where: { tenantId },
            relations: ['user'],
            order: { createdAt: 'DESC' },
        });
        const ids = rows.map((r) => r.userId);
        const linkRows: Array<{
            rider_user_id: number;
            brand_id: number;
            source: 'owned' | 'shared';
            brand_name: string;
        }> = ids.length
            ? await this.dataSource.query(
                  `SELECT rb.rider_user_id, rb.brand_id, rb.source, b.name AS brand_name
                   FROM rider_brands rb
                   INNER JOIN brands b ON b.id = rb.brand_id
                   WHERE rb.tenant_id = $1 AND rb.rider_user_id = ANY($2::int[])
                   ORDER BY b.name ASC`,
                  [tenantId, ids],
              )
            : [];
        const linksByRider = new Map<number, typeof linkRows>();
        for (const l of linkRows) {
            const list = linksByRider.get(l.rider_user_id) ?? [];
            list.push(l);
            linksByRider.set(l.rider_user_id, list);
        }
        let result = rows.map((saved) => {
            const links = linksByRider.get(saved.userId) ?? [];
            const owned = links.find((l) => l.source === 'owned');
            return {
                id: saved.id,
                user_id: saved.userId,
                user_name: saved.user?.name ?? null,
                user_phone: saved.user?.phone ?? null,
                tenant_id: saved.tenantId,
                employment_status: saved.employmentStatus,
                salary_type: saved.salaryType,
                employee_code: saved.employeeCode,
                base_salary: Number(saved.baseSalary),
                default_per_ride_commission: Number(
                    saved.defaultPerRideCommission,
                ),
                max_active_orders: saved.maxActiveOrders,
                min_rating:
                    saved.minRating != null ? Number(saved.minRating) : null,
                min_timely_rate:
                    saved.minTimelyRate != null
                        ? Number(saved.minTimelyRate)
                        : null,
                is_active: saved.isActive,
                metadata: saved.metadata ?? {},
                updated_at: saved.updatedAt?.toISOString() ?? null,
                owner_brand_id: owned ? owned.brand_id : null,
                owner_brand_name: owned ? owned.brand_name : null,
                brand_ids: links.map((l) => l.brand_id),
                brands: links.map((l) => ({
                    id: l.brand_id,
                    name: l.brand_name,
                    source: l.source,
                })),
            };
        });
        if (allowedBrandIds != null) {
            const allowed = new Set(allowedBrandIds.map((b) => Number(b)));
            result = result.filter((p) =>
                p.brand_ids.some((id) => allowed.has(Number(id))),
            );
        }
        return result;
    }

    async checkIn(riderUserId: number, branchId: number, notes?: string) {
        await this.assertRiderAtBranch(riderUserId, branchId);
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');

        const open = await this.attendanceRepo.findOne({
            where: { riderUserId, checkedOutAt: IsNull() },
        });
        if (open) {
            throw new BadRequestException('Rider is already checked in');
        }

        const row = await this.attendanceRepo.save(
            this.attendanceRepo.create({
                riderUserId,
                branchId,
                status: 'checked_in',
                checkedInAt: new Date(),
                notes: notes?.trim() || null,
            }),
        );
        const existingPresence = await this.presenceRepo.findOne({
            where: { riderUserId },
        });
        const now = new Date();
        const presence =
            existingPresence ??
            this.presenceRepo.create({
                riderUserId,
            });
        presence.branchId = branchId;
        presence.isCheckedIn = true;
        presence.isPaused = false;
        presence.pauseReason = null;
        presence.lastHeartbeatAt = now;
        presence.updatedAt = now;
        await this.presenceRepo.save(presence);
        return this.toAttendanceResponse(row);
    }

    async checkOut(riderUserId: number, notes?: string) {
        const open = await this.attendanceRepo.findOne({
            where: { riderUserId, checkedOutAt: IsNull() },
            order: { checkedInAt: 'DESC' },
        });
        if (!open)
            throw new NotFoundException('No open attendance session found');
        open.checkedOutAt = new Date();
        open.status = 'checked_out';
        if (notes !== undefined) open.notes = notes?.trim() || null;
        const saved = await this.attendanceRepo.save(open);

        await this.breakSessionRepo.update(
            { riderUserId, endedAt: IsNull() },
            { endedAt: new Date() },
        );

        const presence = await this.presenceRepo.findOne({
            where: { riderUserId },
        });
        if (presence) {
            presence.isCheckedIn = false;
            presence.isPaused = false;
            presence.pauseReason = null;
            presence.branchId = null;
            await this.presenceRepo.save(presence);
        }

        return this.toAttendanceResponse(saved);
    }

    async setPause(
        riderUserId: number,
        isPaused: boolean,
        pauseReason?: string,
    ) {
        return this.dataSource.transaction(async (manager) => {
            const presence = await manager.findOne(RiderPresence, {
                where: { riderUserId },
            });
            if (!presence || !presence.isCheckedIn) {
                throw new BadRequestException('Rider must be checked in first');
            }
            const breakRepo = manager.getRepository(RiderBreakSession);
            const trimmedReason = pauseReason?.trim();

            if (isPaused) {
                const existingOpen = await breakRepo.findOne({
                    where: { riderUserId, endedAt: IsNull() },
                });
                if (existingOpen) {
                    if (trimmedReason) {
                        existingOpen.reason = trimmedReason;
                        await breakRepo.save(existingOpen);
                    }
                    presence.isPaused = true;
                    presence.pauseReason =
                        trimmedReason || existingOpen.reason || 'paused';
                } else {
                    const attendanceOpen = await manager.findOne(
                        RiderAttendanceSession,
                        {
                            where: { riderUserId, checkedOutAt: IsNull() },
                            order: { checkedInAt: 'DESC' },
                        },
                    );
                    const row = breakRepo.create({
                        riderUserId,
                        attendanceSessionId: attendanceOpen?.id ?? null,
                        branchId: presence.branchId ?? null,
                        startedAt: new Date(),
                        reason: trimmedReason ?? null,
                    });
                    await breakRepo.save(row);
                    presence.isPaused = true;
                    presence.pauseReason = trimmedReason || 'paused';
                }
            } else {
                const openBreak = await breakRepo.findOne({
                    where: { riderUserId, endedAt: IsNull() },
                    order: { startedAt: 'DESC' },
                });
                if (openBreak) {
                    openBreak.endedAt = new Date();
                    await breakRepo.save(openBreak);
                }
                presence.isPaused = false;
                presence.pauseReason = null;
            }
            presence.updatedAt = new Date();
            await manager.save(RiderPresence, presence);
            return {
                rider_user_id: riderUserId,
                is_checked_in: presence.isCheckedIn,
                is_paused: presence.isPaused,
                pause_reason: presence.pauseReason,
            };
        });
    }

    private async assertRiderProfileInTenant(
        riderUserId: number,
        tenantId: number,
    ): Promise<void> {
        const p = await this.riderProfileRepo.findOne({
            where: { userId: riderUserId, tenantId },
        });
        if (!p) {
            throw new ForbiddenException('Rider not found for this tenant');
        }
    }

    async listMyBreakSessions(
        riderUserId: number,
        options: { from?: Date; to?: Date; limit?: number } = {},
    ) {
        const limit = Math.min(500, Math.max(1, options.limit ?? 120));
        const qb = this.breakSessionRepo
            .createQueryBuilder('b')
            .where('b.riderUserId = :riderUserId', { riderUserId })
            .orderBy('b.startedAt', 'DESC')
            .take(limit);
        if (options.from) {
            qb.andWhere('b.startedAt >= :from', { from: options.from });
        }
        if (options.to) {
            qb.andWhere('b.startedAt <= :to', { to: options.to });
        }
        const rows = await qb.getMany();
        return {
            items: rows.map((r) => this.toBreakSessionResponse(r)),
        };
    }

    async listRiderBreakSessionsForAdmin(
        tenantId: number,
        riderUserId: number,
        options: { from?: Date; to?: Date; limit?: number } = {},
    ) {
        await this.assertRiderProfileInTenant(riderUserId, tenantId);
        return this.listMyBreakSessions(riderUserId, options);
    }

    async heartbeat(
        riderUserId: number,
        dto: { latitude?: number; longitude?: number },
    ) {
        const presence = await this.presenceRepo.findOne({
            where: { riderUserId },
            relations: ['branch'],
        });
        if (!presence || !presence.isCheckedIn) {
            throw new BadRequestException('Rider must be checked in first');
        }
        const now = new Date();
        presence.lastHeartbeatAt = now;
        if (
            dto.latitude != null &&
            Number.isFinite(Number(dto.latitude)) &&
            dto.longitude != null &&
            Number.isFinite(Number(dto.longitude))
        ) {
            const lat = Number(dto.latitude);
            const lng = Number(dto.longitude);
            if (lat < -90 || lat > 90)
                throw new BadRequestException(
                    'latitude must be between -90 and 90',
                );
            if (lng < -180 || lng > 180)
                throw new BadRequestException(
                    'longitude must be between -180 and 180',
                );
            presence.lastLatitude = lat;
            presence.lastLongitude = lng;
            presence.lastLocationAt = now;
        }
        await this.presenceRepo.save(presence);
        return {
            rider_user_id: presence.riderUserId,
            branch_id: presence.branchId,
            branch_name: presence.branch?.name ?? null,
            is_checked_in: presence.isCheckedIn,
            is_paused: presence.isPaused,
            last_heartbeat_at: presence.lastHeartbeatAt?.toISOString() ?? null,
            last_location_at: presence.lastLocationAt?.toISOString() ?? null,
            last_latitude:
                presence.lastLatitude != null
                    ? Number(presence.lastLatitude)
                    : null,
            last_longitude:
                presence.lastLongitude != null
                    ? Number(presence.lastLongitude)
                    : null,
        };
    }

    async getPresenceStatus(riderUserId: number) {
        const presence = await this.presenceRepo.findOne({
            where: { riderUserId },
            relations: ['branch'],
        });
        if (!presence) {
            return {
                rider_user_id: riderUserId,
                branch_id: null,
                branch_name: null,
                is_checked_in: false,
                is_paused: false,
                pause_reason: null,
                last_heartbeat_at: null,
                last_location_at: null,
                last_latitude: null,
                last_longitude: null,
            };
        }
        return {
            rider_user_id: presence.riderUserId,
            branch_id: presence.branchId,
            branch_name: presence.branch?.name ?? null,
            is_checked_in: presence.isCheckedIn,
            is_paused: presence.isPaused,
            pause_reason: presence.pauseReason,
            last_heartbeat_at: presence.lastHeartbeatAt?.toISOString() ?? null,
            last_location_at: presence.lastLocationAt?.toISOString() ?? null,
            last_latitude:
                presence.lastLatitude != null
                    ? Number(presence.lastLatitude)
                    : null,
            last_longitude:
                presence.lastLongitude != null
                    ? Number(presence.lastLongitude)
                    : null,
        };
    }

    async listOnDuty(tenantId: number, branchId?: number) {
        const params: unknown[] = [tenantId];
        let branchFilterSql = '';
        if (branchId != null) {
            params.push(branchId);
            branchFilterSql = ` AND rp.branch_id = $2`;
        }
        const rows: Array<{
            rider_user_id: number;
            branch_id: number;
            is_checked_in: boolean;
            is_paused: boolean;
            pause_reason: string | null;
            last_heartbeat_at: Date | null;
            last_location_at: Date | null;
            last_latitude: string | null;
            last_longitude: string | null;
        }> = await this.dataSource.query(
            `SELECT DISTINCT rp.rider_user_id,
                    rp.branch_id,
                    rp.is_checked_in,
                    rp.is_paused,
                    rp.pause_reason,
                    rp.last_heartbeat_at,
                    rp.last_location_at,
                    rp.last_latitude::text,
                    rp.last_longitude::text
             FROM rider_presences rp
             INNER JOIN branch_users bu ON bu.user_id = rp.rider_user_id
             INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
             INNER JOIN branches b ON b.id = bu.branch_id
             INNER JOIN branch_brands bb ON bb.branch_id = b.id
             INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
             WHERE rp.is_checked_in = true
               AND rp.is_paused = false
               ${branchFilterSql}
             ORDER BY rp.rider_user_id ASC`,
            params,
        );
        return rows.map((row) => ({
            rider_user_id: Number(row.rider_user_id),
            branch_id: Number(row.branch_id),
            is_checked_in: row.is_checked_in,
            is_paused: row.is_paused,
            pause_reason: row.pause_reason,
            last_heartbeat_at: row.last_heartbeat_at?.toISOString() ?? null,
            last_location_at: row.last_location_at?.toISOString() ?? null,
            last_latitude:
                row.last_latitude != null ? Number(row.last_latitude) : null,
            last_longitude:
                row.last_longitude != null ? Number(row.last_longitude) : null,
        }));
    }

    async createCompPlan(
        tenantId: number,
        actorUserId: number,
        dto: {
            name: string;
            pay_method: string;
            branch_id?: number;
            effective_from?: string;
            effective_to?: string;
            components: Array<{
                component_key: string;
                name: string;
                component_type: string;
                calc_basis: string;
                value: number;
                conditions?: Record<string, unknown>;
                is_enabled?: boolean;
                sort_order?: number;
            }>;
        },
    ) {
        if (!dto.name?.trim())
            throw new BadRequestException('name is required');
        if (!Array.isArray(dto.components) || dto.components.length === 0) {
            throw new BadRequestException('At least one component is required');
        }

        const latest = await this.compPlanRepo.findOne({
            where: {
                tenantId,
                branchId: dto.branch_id != null ? dto.branch_id : IsNull(),
            },
            order: { version: 'DESC' },
        });
        const version = (latest?.version ?? 0) + 1;

        const plan = await this.compPlanRepo.save(
            this.compPlanRepo.create({
                tenantId,
                branchId: dto.branch_id ?? null,
                name: dto.name.trim(),
                payMethod: dto.pay_method || 'hybrid',
                status: 'draft',
                version,
                effectiveFrom: dto.effective_from ?? null,
                effectiveTo: dto.effective_to ?? null,
                createdBy: actorUserId,
            }),
        );

        const components = dto.components.map((c, idx) =>
            this.compComponentRepo.create({
                planId: plan.id,
                componentKey: c.component_key,
                name: c.name,
                componentType: c.component_type,
                calcBasis: c.calc_basis,
                value: c.value ?? 0,
                conditions: c.conditions ?? {},
                isEnabled: c.is_enabled ?? true,
                sortOrder: c.sort_order ?? idx,
            }),
        );
        await this.compComponentRepo.save(components);
        return this.getCompPlan(plan.id, tenantId);
    }

    async listCompPlans(tenantId: number, branchId?: number) {
        const plans = await this.compPlanRepo.find({
            where: {
                tenantId,
                ...(branchId != null ? { branchId } : {}),
            },
            relations: ['components'],
            order: { createdAt: 'DESC' },
        });
        return plans.map((plan) => ({
            id: plan.id,
            tenant_id: plan.tenantId,
            branch_id: plan.branchId,
            name: plan.name,
            pay_method: plan.payMethod,
            status: plan.status,
            version: plan.version,
            effective_from: plan.effectiveFrom,
            effective_to: plan.effectiveTo,
            component_count: plan.components?.length ?? 0,
            components: (plan.components ?? [])
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((c) => ({
                    id: c.id,
                    component_key: c.componentKey,
                    name: c.name,
                    component_type: c.componentType,
                    calc_basis: c.calcBasis,
                    value: Number(c.value),
                    conditions: c.conditions ?? {},
                    is_enabled: c.isEnabled,
                    sort_order: c.sortOrder,
                })),
        }));
    }

    async activateCompPlan(
        planId: number,
        tenantId: number,
        actorUserId: number,
    ) {
        const plan = await this.compPlanRepo.findOne({
            where: { id: planId, tenantId },
            relations: ['components'],
        });
        if (!plan) throw new NotFoundException('Compensation plan not found');
        if ((plan.components ?? []).length === 0) {
            throw new BadRequestException(
                'Compensation plan must have at least one component',
            );
        }
        await this.compPlanRepo.update(
            {
                tenantId,
                branchId: plan.branchId != null ? plan.branchId : IsNull(),
                status: 'active',
            },
            { status: 'inactive' },
        );
        plan.status = 'active';
        plan.approvedBy = actorUserId;
        plan.approvedAt = new Date();
        await this.compPlanRepo.save(plan);
        return this.getCompPlan(plan.id, tenantId);
    }

    async getCompPlan(planId: number, tenantId: number) {
        const plan = await this.compPlanRepo.findOne({
            where: { id: planId, tenantId },
            relations: ['components'],
        });
        if (!plan) throw new NotFoundException('Compensation plan not found');
        return {
            id: plan.id,
            tenant_id: plan.tenantId,
            branch_id: plan.branchId,
            name: plan.name,
            pay_method: plan.payMethod,
            status: plan.status,
            version: plan.version,
            effective_from: plan.effectiveFrom,
            effective_to: plan.effectiveTo,
            components: (plan.components ?? [])
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((c) => ({
                    id: c.id,
                    component_key: c.componentKey,
                    name: c.name,
                    component_type: c.componentType,
                    calc_basis: c.calcBasis,
                    value: Number(c.value),
                    conditions: c.conditions ?? {},
                    is_enabled: c.isEnabled,
                    sort_order: c.sortOrder,
                })),
        };
    }

    private async getActiveCompPlan(
        tenantId: number,
        branchId: number | null,
    ): Promise<RiderCompPlan | null> {
        const byBranch = await this.compPlanRepo.findOne({
            where: {
                tenantId,
                branchId: branchId != null ? branchId : IsNull(),
                status: 'active',
            },
            relations: ['components'],
            order: { version: 'DESC' },
        });
        if (byBranch) return byBranch;
        return this.compPlanRepo.findOne({
            where: { tenantId, branchId: IsNull(), status: 'active' },
            relations: ['components'],
            order: { version: 'DESC' },
        });
    }

    async runPayroll(
        tenantId: number,
        actorUserId: number,
        dto: {
            from: string;
            to: string;
            branch_id?: number;
            timely_minutes?: number;
            expected_monthly_minutes?: number;
        },
    ) {
        const started = Date.now();
        const from = new Date(`${dto.from}T00:00:00.000Z`);
        const to = new Date(`${dto.to}T23:59:59.999Z`);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            throw new BadRequestException('Invalid date range');
        }
        if (from.getTime() > to.getTime()) {
            throw new BadRequestException('from cannot be greater than to');
        }
        const timelyMinutes = dto.timely_minutes ?? 45;
        const expectedMonthlyMinutes = dto.expected_monthly_minutes ?? 12480;

        const run = await this.payrollRunRepo.save(
            this.payrollRunRepo.create({
                tenantId,
                branchId: dto.branch_id ?? null,
                periodFrom: dto.from,
                periodTo: dto.to,
                status: 'draft',
                requestedBy: actorUserId,
            }),
        );

        const riders: Array<{ rider_user_id: number }> =
            await this.dataSource.query(
                `SELECT DISTINCT rp.user_id AS rider_user_id
             FROM rider_profiles rp
             INNER JOIN users u ON u.id = rp.user_id AND u.status = 'active'
             WHERE rp.tenant_id = $1
               AND rp.is_active = true`,
                [tenantId],
            );
        const lines: RiderPayrollLine[] = [];
        for (const rider of riders) {
            const riderUserId = Number(rider.rider_user_id);
            const attendanceRows = await this.attendanceRepo.find({
                where: { riderUserId },
                order: { checkedInAt: 'ASC' },
            });
            const attendanceMinutes = attendanceRows.reduce(
                (sum, row) =>
                    sum +
                    this.calcAttendanceMinutes(
                        from,
                        to,
                        row.checkedInAt,
                        row.checkedOutAt,
                    ),
                0,
            );

            const orderRows: Array<{
                completed_rides: string;
                timely_deliveries: string;
            }> = await this.dataSource.query(
                `SELECT COUNT(*)::text AS completed_rides,
                        COUNT(*) FILTER (
                            WHERE EXTRACT(EPOCH FROM (o.completed_at - o.placed_at)) / 60 <= $4
                        )::text AS timely_deliveries
                 FROM orders o
                 WHERE o.tenant_id = $1
                   AND o.rider_id = $2
                   AND o.delivery_status = 'delivered'
                   AND o.completed_at IS NOT NULL
                   AND o.completed_at BETWEEN $3::timestamp AND $5::timestamp
                   ${dto.branch_id != null ? 'AND o.branch_id = $6' : ''}`,
                dto.branch_id != null
                    ? [
                          tenantId,
                          riderUserId,
                          from.toISOString(),
                          timelyMinutes,
                          to.toISOString(),
                          dto.branch_id,
                      ]
                    : [
                          tenantId,
                          riderUserId,
                          from.toISOString(),
                          timelyMinutes,
                          to.toISOString(),
                      ],
            );
            const completedRides = Number(orderRows[0]?.completed_rides ?? 0);
            const timelyDeliveries = Number(
                orderRows[0]?.timely_deliveries ?? 0,
            );

            const ratingRows: Array<{ avg_rating: string | null }> =
                await this.dataSource.query(
                    `SELECT AVG(ror.stars)::text AS avg_rating
                     FROM rider_order_ratings ror
                     INNER JOIN orders o ON o.id = ror.order_id
                     WHERE o.tenant_id = $1
                       AND ror.rider_user_id = $2
                       AND ror.updated_at BETWEEN $3::timestamp AND $4::timestamp`,
                    [
                        tenantId,
                        riderUserId,
                        from.toISOString(),
                        to.toISOString(),
                    ],
                );
            const avgRating =
                ratingRows[0]?.avg_rating != null
                    ? Number(ratingRows[0].avg_rating)
                    : null;

            const activePlan = await this.getActiveCompPlan(
                tenantId,
                dto.branch_id ?? null,
            );
            const profile = await this.riderProfileRepo.findOne({
                where: { userId: riderUserId, tenantId },
            });
            const line = this.payrollLineRepo.create({
                runId: run.id,
                riderUserId,
                planId: activePlan?.id ?? null,
                currency: 'PKR',
                attendanceMinutes,
                completedRides,
                timelyDeliveries,
                avgRating,
                totalAmount: 0,
            });
            const savedLine = await this.payrollLineRepo.save(line);

            const items: RiderPayrollLineItem[] = [];
            const pushItem = (
                componentKey: string,
                componentName: string,
                amount: number,
                formulaMeta: Record<string, unknown>,
            ) => {
                items.push(
                    this.payrollLineItemRepo.create({
                        payrollLineId: savedLine.id,
                        componentKey,
                        componentName,
                        amount,
                        formulaMeta,
                    }),
                );
            };

            const baseSalary = Number(profile?.baseSalary ?? 0);
            const proratedBase = proratedAmount(
                baseSalary,
                attendanceMinutes,
                expectedMonthlyMinutes,
            );
            if (baseSalary > 0) {
                pushItem('base_salary', 'Base Salary', proratedBase, {
                    base_salary: baseSalary,
                    attendance_minutes: attendanceMinutes,
                    expected_monthly_minutes: expectedMonthlyMinutes,
                    attendance_ratio:
                        expectedMonthlyMinutes > 0
                            ? Math.min(
                                  1,
                                  attendanceMinutes / expectedMonthlyMinutes,
                              )
                            : 0,
                });
            }

            const defaultPerRide = Number(
                profile?.defaultPerRideCommission ?? 0,
            );
            if (defaultPerRide > 0 && completedRides > 0) {
                pushItem(
                    'default_per_ride',
                    'Per-Ride Commission',
                    defaultPerRide * completedRides,
                    {
                        rate: defaultPerRide,
                        completed_rides: completedRides,
                    },
                );
            }

            for (const c of activePlan?.components ?? []) {
                if (!c.isEnabled) continue;
                const rate = Number(c.value ?? 0);
                const minRating = Number(
                    (c.conditions?.min_rating as number) ?? 0,
                );
                const amount = componentAmount(c.calcBasis, rate, {
                    completedRides,
                    timelyDeliveries,
                    avgRating,
                    minRating,
                });
                if (amount === 0) continue;
                pushItem(c.componentKey, c.name, amount, {
                    calc_basis: c.calcBasis,
                    value: rate,
                    conditions: c.conditions ?? {},
                    completed_rides: completedRides,
                    timely_deliveries: timelyDeliveries,
                    avg_rating: avgRating,
                    min_rating: minRating,
                });
            }

            const savedItems = await this.payrollLineItemRepo.save(items);
            const total = savedItems.reduce(
                (sum, item) => sum + Number(item.amount),
                0,
            );
            savedLine.totalAmount = total;
            const finalizedLine = await this.payrollLineRepo.save(savedLine);
            lines.push(finalizedLine);
        }

        run.status = 'finalized';
        run.finalizedAt = new Date();
        run.ruleVersion = `plan-snapshot-${run.id}`;
        await this.payrollRunRepo.save(run);
        this.metrics.inc('payroll_run_success');
        this.metrics.observe('payroll_run_duration_ms', Date.now() - started);
        return this.getPayrollRun(run.id, tenantId);
    }

    async getPayrollRun(runId: number, tenantId: number) {
        const run = await this.payrollRunRepo.findOne({
            where: { id: runId, tenantId },
            relations: ['lines', 'lines.items'],
        });
        if (!run) throw new NotFoundException('Payroll run not found');
        return {
            id: run.id,
            tenant_id: run.tenantId,
            branch_id: run.branchId,
            period_from: run.periodFrom,
            period_to: run.periodTo,
            status: run.status,
            rule_version: run.ruleVersion,
            finalized_at: run.finalizedAt?.toISOString() ?? null,
            lines: (run.lines ?? []).map((line) => ({
                id: line.id,
                rider_user_id: line.riderUserId,
                plan_id: line.planId,
                total_amount: Number(line.totalAmount),
                attendance_minutes: line.attendanceMinutes,
                completed_rides: line.completedRides,
                timely_deliveries: line.timelyDeliveries,
                avg_rating:
                    line.avgRating != null ? Number(line.avgRating) : null,
                items: (line.items ?? []).map((item) => ({
                    id: item.id,
                    component_key: item.componentKey,
                    component_name: item.componentName,
                    amount: Number(item.amount),
                    formula_meta: item.formulaMeta ?? {},
                })),
            })),
        };
    }

    async listPayrollRuns(tenantId: number, branchId?: number) {
        const runs = await this.payrollRunRepo.find({
            where: {
                tenantId,
                ...(branchId != null ? { branchId } : {}),
            },
            relations: ['lines'],
            order: { createdAt: 'DESC' },
        });
        return runs.map((run) => ({
            id: run.id,
            tenant_id: run.tenantId,
            branch_id: run.branchId,
            period_from: run.periodFrom,
            period_to: run.periodTo,
            status: run.status,
            rule_version: run.ruleVersion,
            finalized_at: run.finalizedAt?.toISOString() ?? null,
            rider_count: run.lines?.length ?? 0,
            total_amount: (run.lines ?? []).reduce(
                (sum, line) => sum + Number(line.totalAmount ?? 0),
                0,
            ),
        }));
    }

    async reversePayrollRun(
        runId: number,
        tenantId: number,
        actorUserId: number,
    ) {
        const run = await this.payrollRunRepo.findOne({
            where: { id: runId, tenantId },
            relations: ['lines'],
        });
        if (!run) throw new NotFoundException('Payroll run not found');
        if (run.status !== 'finalized') {
            throw new BadRequestException(
                'Only finalized runs can be reversed',
            );
        }

        for (const line of run.lines ?? []) {
            const reversal = this.payrollLineItemRepo.create({
                payrollLineId: line.id,
                componentKey: 'reversal',
                componentName: 'Reversal Entry',
                amount: Number(line.totalAmount) * -1,
                formulaMeta: {
                    reversed_by: actorUserId,
                    reversed_at: new Date().toISOString(),
                },
            });
            await this.payrollLineItemRepo.save(reversal);
            line.totalAmount = 0;
            await this.payrollLineRepo.save(line);
        }
        run.status = 'reversed';
        run.approvedBy = actorUserId;
        run.approvedAt = new Date();
        await this.payrollRunRepo.save(run);
        this.metrics.inc('payroll_run_reversal_count');
        return this.getPayrollRun(run.id, tenantId);
    }
}
