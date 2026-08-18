import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkScheduleTemplate } from '../entities/work-schedule-template.entity';
import { AttendanceCapturePolicy } from '../entities/attendance-capture-policy.entity';
import { OvertimePolicy } from '../entities/overtime-policy.entity';
import { HolidayPolicy } from '../entities/holiday-policy.entity';
import { LeaveType } from '../entities/leave-type.entity';
import { DeductionRule } from '../entities/deduction-rule.entity';
import { HrApprovalRule } from '../entities/hr-approval-rule.entity';
import { HrAuditService } from './hr-audit.service';
import { hasPermission, HrUser } from './employee-scope';
import {
    ApprovalContext,
    DeductionConfig,
    DeductionRuleInput,
    deductionConfigFrom,
    requiredApproval,
} from './settings-rules';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Everything under HR → Settings, plus the two resolvers the engines read.
 *
 * The engines were configurable in the schema from Phase 2 onward but had no
 * way in: capture policy, overtime, offs and schedules were seeded rows that
 * could only be changed with SQL. This service is that way in, and it is
 * deliberately the ONLY place that writes them, so every change lands in the HR
 * audit log with a named actor.
 *
 * Scope rules are the house ones: a `null` branch means the tenant default, and
 * a caller restricted to branches may not read or write another branch's rows.
 */
@Injectable()
export class HrSettingsService {
    constructor(
        @InjectRepository(WorkScheduleTemplate)
        private readonly templates: Repository<WorkScheduleTemplate>,
        @InjectRepository(AttendanceCapturePolicy)
        private readonly capturePolicies: Repository<AttendanceCapturePolicy>,
        @InjectRepository(OvertimePolicy)
        private readonly overtimePolicies: Repository<OvertimePolicy>,
        @InjectRepository(HolidayPolicy)
        private readonly holidayPolicies: Repository<HolidayPolicy>,
        @InjectRepository(LeaveType)
        private readonly leaveTypes: Repository<LeaveType>,
        @InjectRepository(DeductionRule)
        private readonly deductionRules: Repository<DeductionRule>,
        @InjectRepository(HrApprovalRule)
        private readonly approvalRules: Repository<HrApprovalRule>,
        private readonly audit: HrAuditService,
    ) {}

    // ------------------------------------------------------------- helpers

    private requireTenant(user: HrUser): number {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        return user.tenantId;
    }

    /** A branch-restricted caller may not touch another branch, nor the tenant default. */
    private assertBranchScope(user: HrUser, branchId: number | null) {
        if (user.allowedBranchIds == null) return;
        if (branchId == null) {
            throw new ForbiddenException(
                'Only an all-branches user can change the tenant-wide default',
            );
        }
        if (!user.allowedBranchIds.includes(branchId)) {
            throw new ForbiddenException('That branch is out of your scope');
        }
    }

    private scopedList<T extends { id: number }>(
        repo: Repository<T>,
        user: HrUser,
        opts: {
            includeInactive?: boolean;
            order?: Record<string, 'ASC' | 'DESC'>;
        } = {},
    ) {
        const qb = repo.createQueryBuilder('r');
        if (user.tenantId != null) {
            qb.where('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (!opts.includeInactive) qb.andWhere('r.isActive = true');
        if (user.allowedBranchIds != null) {
            // Tenant-wide rows are visible to everyone: they are the rules the
            // branch actually works under.
            if (user.allowedBranchIds.length === 0) {
                qb.andWhere('r.branchId IS NULL');
            } else {
                qb.andWhere(
                    '(r.branchId IS NULL OR r.branchId IN (:...branchIds))',
                    { branchIds: user.allowedBranchIds },
                );
            }
        }
        const [field, dir] = Object.entries(
            opts.order ?? { id: 'ASC' as const },
        )[0];
        qb.orderBy(`r.${field}`, dir);
        return qb.getMany();
    }

    private async loadOwned<T extends { id: number; tenantId: number }>(
        repo: Repository<T>,
        user: HrUser,
        id: number,
        label: string,
    ): Promise<T> {
        const row = await repo.findOne({
            where: { id } as never,
        });
        if (!row) throw new NotFoundException(`${label} not found`);
        if (user.tenantId != null && row.tenantId !== user.tenantId) {
            throw new NotFoundException(`${label} not found`);
        }
        return row;
    }

    private record(
        user: HrUser,
        tenantId: number,
        action: string,
        table: string,
        id: number,
        after: Record<string, unknown>,
    ) {
        return this.audit.record({
            tenantId,
            actorUserId: user.id,
            action,
            entityTable: table,
            entityId: id,
            after,
        });
    }

    // -------------------------------------------------- schedule templates

    listTemplates(user: HrUser, includeInactive = false) {
        return this.scopedList(this.templates, user, {
            includeInactive,
            order: { name: 'ASC' },
        });
    }

    async saveTemplate(
        user: HrUser,
        dto: Partial<WorkScheduleTemplate> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        this.assertBranchScope(user, dto.branchId ?? null);

        if (dto.startTime && dto.endTime) {
            // The engine derives a 33-hour day from a shift flagged as crossing
            // midnight when it does not, which zeroes overtime and inflates the
            // scheduled minutes. The flag is therefore DERIVED, never trusted.
            dto.crossesMidnight = dto.endTime < dto.startTime;
        }

        if (dto.id) {
            const existing = await this.loadOwned(
                this.templates,
                user,
                dto.id,
                'Schedule template',
            );
            this.assertBranchScope(user, existing.branchId);
            await this.templates.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.schedule-template.updated',
                'work_schedule_templates',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        const saved = await this.templates.save(
            this.templates.create({ ...dto, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.schedule-template.created',
            'work_schedule_templates',
            saved.id,
            { name: saved.name, branch_id: saved.branchId },
        );
        return { id: saved.id, updated: false };
    }

    async deactivateTemplate(user: HrUser, id: number) {
        const tenantId = this.requireTenant(user);
        const row = await this.loadOwned(
            this.templates,
            user,
            id,
            'Schedule template',
        );
        this.assertBranchScope(user, row.branchId);
        // Deactivated, never deleted: attendance days already computed against
        // it keep their reference, and a payslip must stay explainable.
        await this.templates.update({ id }, { isActive: false });
        await this.record(
            user,
            tenantId,
            'hr-settings.schedule-template.deactivated',
            'work_schedule_templates',
            id,
            { is_active: false },
        );
        return { deactivated: true };
    }

    // ------------------------------------------------- attendance capture

    listCapturePolicies(user: HrUser) {
        return this.scopedList(this.capturePolicies, user, {
            includeInactive: true,
            order: { branchId: 'ASC' },
        });
    }

    async saveCapturePolicy(
        user: HrUser,
        dto: Partial<AttendanceCapturePolicy> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        this.assertBranchScope(user, dto.branchId ?? null);

        if (dto.photoRetentionDays != null && dto.photoRetentionDays < 1) {
            throw new BadRequestException(
                'Photo retention must be at least a day',
            );
        }
        if (dto.primaryMethod === 'photo' && dto.requirePhoto === false) {
            throw new BadRequestException(
                'A photo-first policy cannot also make photos optional',
            );
        }

        if (dto.id) {
            const existing = await this.loadOwned(
                this.capturePolicies,
                user,
                dto.id,
                'Capture policy',
            );
            this.assertBranchScope(user, existing.branchId);
            await this.capturePolicies.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.capture-policy.updated',
                'attendance_capture_policies',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        // One policy per scope: a second row for the same branch would make
        // which one applies depend on insertion order.
        const clash = await this.capturePolicies.findOne({
            where: { tenantId, branchId: (dto.branchId ?? null) as never },
        });
        if (clash) {
            throw new BadRequestException(
                dto.branchId
                    ? 'That branch already has a capture policy'
                    : 'The tenant default already exists',
            );
        }

        const saved = await this.capturePolicies.save(
            this.capturePolicies.create({ ...dto, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.capture-policy.created',
            'attendance_capture_policies',
            saved.id,
            { branch_id: saved.branchId, method: saved.primaryMethod },
        );
        return { id: saved.id, updated: false };
    }

    async deleteCapturePolicy(user: HrUser, id: number) {
        const tenantId = this.requireTenant(user);
        const row = await this.loadOwned(
            this.capturePolicies,
            user,
            id,
            'Capture policy',
        );
        this.assertBranchScope(user, row.branchId);
        if (row.branchId == null) {
            throw new BadRequestException(
                'The tenant default cannot be deleted — edit it instead',
            );
        }
        await this.capturePolicies.delete({ id });
        await this.record(
            user,
            tenantId,
            'hr-settings.capture-policy.deleted',
            'attendance_capture_policies',
            id,
            { branch_id: row.branchId },
        );
        return { deleted: true };
    }

    // ------------------------------------------------------------ overtime

    listOvertimePolicies(user: HrUser, includeInactive = false) {
        return this.scopedList(this.overtimePolicies, user, {
            includeInactive,
            order: { id: 'ASC' },
        });
    }

    async saveOvertimePolicy(
        user: HrUser,
        dto: Partial<OvertimePolicy> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        this.assertBranchScope(user, dto.branchId ?? null);

        if (dto.rateValue != null && Number(dto.rateValue) < 0) {
            throw new BadRequestException('Rate cannot be negative');
        }
        if (
            dto.dailyCapMinutes != null &&
            dto.monthlyCapMinutes != null &&
            dto.dailyCapMinutes > dto.monthlyCapMinutes
        ) {
            throw new BadRequestException(
                'The daily cap cannot exceed the monthly cap',
            );
        }

        if (dto.id) {
            const existing = await this.loadOwned(
                this.overtimePolicies,
                user,
                dto.id,
                'Overtime policy',
            );
            this.assertBranchScope(user, existing.branchId);
            await this.overtimePolicies.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.overtime-policy.updated',
                'overtime_policies',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        const saved = await this.overtimePolicies.save(
            this.overtimePolicies.create({ ...dto, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.overtime-policy.created',
            'overtime_policies',
            saved.id,
            { branch_id: saved.branchId, rate_type: saved.rateType },
        );
        return { id: saved.id, updated: false };
    }

    async deactivateOvertimePolicy(user: HrUser, id: number) {
        const tenantId = this.requireTenant(user);
        const row = await this.loadOwned(
            this.overtimePolicies,
            user,
            id,
            'Overtime policy',
        );
        this.assertBranchScope(user, row.branchId);
        await this.overtimePolicies.update({ id }, { isActive: false });
        await this.record(
            user,
            tenantId,
            'hr-settings.overtime-policy.deactivated',
            'overtime_policies',
            id,
            { is_active: false },
        );
        return { deactivated: true };
    }

    // ------------------------------------------------------- offs policies

    listHolidayPolicies(user: HrUser, includeInactive = false) {
        return this.scopedList(this.holidayPolicies, user, {
            includeInactive,
            order: { id: 'ASC' },
        });
    }

    async saveHolidayPolicy(
        user: HrUser,
        dto: Partial<HolidayPolicy> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        this.assertBranchScope(user, dto.branchId ?? null);

        if (
            dto.offsPerMonth != null &&
            (dto.offsPerMonth < 0 || dto.offsPerMonth > 31)
        ) {
            throw new BadRequestException('Offs per month must be 0–31');
        }
        if (dto.carryForward === true && dto.encashUnused === true) {
            // Both would pay for the same day twice: once carried into next
            // month, once encashed this month.
            throw new BadRequestException(
                'Unused offs can carry forward or be encashed, not both',
            );
        }

        if (dto.id) {
            const existing = await this.loadOwned(
                this.holidayPolicies,
                user,
                dto.id,
                'Offs policy',
            );
            this.assertBranchScope(user, existing.branchId);
            await this.holidayPolicies.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.offs-policy.updated',
                'holiday_policies',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        const saved = await this.holidayPolicies.save(
            this.holidayPolicies.create({ ...dto, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.offs-policy.created',
            'holiday_policies',
            saved.id,
            { branch_id: saved.branchId, offs_per_month: saved.offsPerMonth },
        );
        return { id: saved.id, updated: false };
    }

    async deactivateHolidayPolicy(user: HrUser, id: number) {
        const tenantId = this.requireTenant(user);
        const row = await this.loadOwned(
            this.holidayPolicies,
            user,
            id,
            'Offs policy',
        );
        this.assertBranchScope(user, row.branchId);
        await this.holidayPolicies.update({ id }, { isActive: false });
        await this.record(
            user,
            tenantId,
            'hr-settings.offs-policy.deactivated',
            'holiday_policies',
            id,
            { is_active: false },
        );
        return { deactivated: true };
    }

    // ---------------------------------------------------------- leave types

    listLeaveTypes(user: HrUser, includeInactive = false) {
        const qb = this.leaveTypes
            .createQueryBuilder('r')
            .orderBy('r.sortOrder', 'ASC');
        if (user.tenantId != null) {
            qb.where('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (!includeInactive) qb.andWhere('r.isActive = true');
        return qb.getMany();
    }

    async saveLeaveType(
        user: HrUser,
        dto: Partial<LeaveType> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);

        if (dto.id) {
            const existing = await this.loadOwned(
                this.leaveTypes,
                user,
                dto.id,
                'Leave type',
            );
            // The monthly-off type is what the 4-offs policy and encashment are
            // computed from. Turning that flag off silently detaches the balance
            // everyone is accruing, so it is fixed once created.
            if (
                dto.isMonthlyOff != null &&
                dto.isMonthlyOff !== existing.isMonthlyOff
            ) {
                throw new BadRequestException(
                    'Whether a type is the monthly off cannot be changed — create a new type instead',
                );
            }
            await this.leaveTypes.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.leave-type.updated',
                'leave_types',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        const code =
            dto.code?.trim() ||
            (dto.name ?? '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
        if (!code) throw new BadRequestException('A name is required');

        const clash = await this.leaveTypes.findOne({
            where: { tenantId, code },
        });
        if (clash) {
            throw new BadRequestException(
                `A leave type with code "${code}" already exists`,
            );
        }
        if (dto.isMonthlyOff) {
            const existingOff = await this.leaveTypes.findOne({
                where: { tenantId, isMonthlyOff: true, isActive: true },
            });
            if (existingOff) {
                throw new BadRequestException(
                    'There is already a monthly-off type; balances are computed from exactly one',
                );
            }
        }

        const saved = await this.leaveTypes.save(
            this.leaveTypes.create({ ...dto, code, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.leave-type.created',
            'leave_types',
            saved.id,
            { name: saved.name, code },
        );
        return { id: saved.id, updated: false };
    }

    // ------------------------------------------------------ deduction rules

    listDeductionRules(user: HrUser, includeInactive = false) {
        return this.scopedList(this.deductionRules, user, {
            includeInactive,
            order: { id: 'ASC' },
        });
    }

    async saveDeductionRule(
        user: HrUser,
        dto: Partial<DeductionRule> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        this.assertBranchScope(user, dto.branchId ?? null);

        if (dto.trigger === 'late') {
            const ladder = (dto.condition as { ladder?: unknown })?.ladder;
            if (!Array.isArray(ladder) || ladder.length === 0) {
                throw new BadRequestException(
                    'A late rule needs a ladder — the days deducted at each position',
                );
            }
            if (
                ladder.some((v) => !Number.isFinite(Number(v)) || Number(v) < 0)
            ) {
                throw new BadRequestException(
                    'Every ladder position must be zero or more days',
                );
            }
        }
        if (
            dto.effectType === 'deduct_days' &&
            dto.effectValue != null &&
            Number(dto.effectValue) < 0
        ) {
            throw new BadRequestException('A deduction cannot be negative');
        }

        if (dto.id) {
            const existing = await this.loadOwned(
                this.deductionRules,
                user,
                dto.id,
                'Deduction rule',
            );
            this.assertBranchScope(user, existing.branchId);
            await this.deductionRules.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.deduction-rule.updated',
                'deduction_rules',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        const saved = await this.deductionRules.save(
            this.deductionRules.create({ ...dto, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.deduction-rule.created',
            'deduction_rules',
            saved.id,
            {
                trigger: saved.trigger,
                effect: saved.effectType,
                value: saved.effectValue,
            },
        );
        return { id: saved.id, updated: false };
    }

    async deactivateDeductionRule(user: HrUser, id: number) {
        const tenantId = this.requireTenant(user);
        const row = await this.loadOwned(
            this.deductionRules,
            user,
            id,
            'Deduction rule',
        );
        this.assertBranchScope(user, row.branchId);
        await this.deductionRules.update({ id }, { isActive: false });
        await this.record(
            user,
            tenantId,
            'hr-settings.deduction-rule.deactivated',
            'deduction_rules',
            id,
            { is_active: false },
        );
        return { deactivated: true };
    }

    /**
     * The deduction configuration payroll should use for one employee.
     *
     * Falls back to the shipped constants when a tenant has no rules, so a
     * tenant created before the table existed is charged exactly as before.
     */
    /**
     * Every deduction rule for a tenant, shaped for the pure resolver.
     *
     * Payroll loads these ONCE per run and resolves per employee in memory —
     * a query per employee would turn a 200-person run into 200 round trips for
     * data that cannot change mid-run.
     */
    async loadDeductionRules(tenantId: number): Promise<DeductionRuleInput[]> {
        const rules = await this.deductionRules.find({ where: { tenantId } });
        return rules.map((r) => ({
            id: r.id,
            branchId: r.branchId,
            designationId: r.designationId,
            priority: r.priority,
            isActive: r.isActive,
            effectiveFrom: r.effectiveFrom,
            effectiveTo: r.effectiveTo,
            trigger: r.trigger,
            condition: r.condition ?? {},
            effectType: r.effectType,
            effectValue: Number(r.effectValue),
        }));
    }

    async deductionConfigFor(
        tenantId: number,
        scope: {
            branchId?: number | null;
            designationId?: number | null;
            onDate?: string;
        },
    ): Promise<DeductionConfig> {
        return deductionConfigFrom(await this.loadDeductionRules(tenantId), {
            branchId: scope.branchId ?? null,
            designationId: scope.designationId ?? null,
            onDate: scope.onDate ?? today(),
        });
    }

    // ------------------------------------------------------- approval rules

    listApprovalRules(user: HrUser, includeInactive = false) {
        return this.scopedList(this.approvalRules, user, {
            includeInactive,
            order: { id: 'ASC' },
        });
    }

    async saveApprovalRule(
        user: HrUser,
        dto: Partial<HrApprovalRule> & { id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        this.assertBranchScope(user, dto.branchId ?? null);

        if (dto.requiredPermission != null && !dto.requiredPermission.trim()) {
            throw new BadRequestException('A required permission is needed');
        }

        if (dto.id) {
            const existing = await this.loadOwned(
                this.approvalRules,
                user,
                dto.id,
                'Approval rule',
            );
            this.assertBranchScope(user, existing.branchId);
            await this.approvalRules.update({ id: dto.id }, dto as never);
            await this.record(
                user,
                tenantId,
                'hr-settings.approval-rule.updated',
                'hr_approval_rules',
                dto.id,
                dto as Record<string, unknown>,
            );
            return { id: dto.id, updated: true };
        }

        const saved = await this.approvalRules.save(
            this.approvalRules.create({ ...dto, tenantId, isActive: true }),
        );
        await this.record(
            user,
            tenantId,
            'hr-settings.approval-rule.created',
            'hr_approval_rules',
            saved.id,
            {
                subject: saved.subject,
                required_permission: saved.requiredPermission,
            },
        );
        return { id: saved.id, updated: false };
    }

    async deactivateApprovalRule(user: HrUser, id: number) {
        const tenantId = this.requireTenant(user);
        const row = await this.loadOwned(
            this.approvalRules,
            user,
            id,
            'Approval rule',
        );
        this.assertBranchScope(user, row.branchId);
        await this.approvalRules.update({ id }, { isActive: false });
        await this.record(
            user,
            tenantId,
            'hr-settings.approval-rule.deactivated',
            'hr_approval_rules',
            id,
            { is_active: false },
        );
        return { deactivated: true };
    }

    /**
     * Enforce the configured approval threshold for a decision.
     *
     * Called by the services that make the decision, not by a guard: only they
     * know the amount, the days or the minutes involved. An empty table means
     * nothing is enforced beyond the endpoint's own permission, which is exactly
     * how the module behaved before these rules existed.
     */
    async assertApproval(
        user: HrUser,
        subject: string,
        scope: {
            tenantId: number | null;
            branchId?: number | null;
            onDate?: string;
        },
        context: ApprovalContext,
    ): Promise<void> {
        if (scope.tenantId == null) return; // super admin
        const rules = await this.approvalRules.find({
            where: { tenantId: scope.tenantId },
        });
        if (rules.length === 0) return;

        const rule = requiredApproval(
            rules.map((r) => ({
                id: r.id,
                branchId: r.branchId,
                designationId: null,
                priority: r.priority,
                isActive: r.isActive,
                subject: r.subject,
                condition: r.condition ?? {},
                requiredPermission: r.requiredPermission,
                escalateToPermission: r.escalateToPermission,
            })),
            subject,
            {
                branchId: scope.branchId ?? null,
                onDate: scope.onDate ?? today(),
            },
            context,
        );
        if (!rule) return;
        if (hasPermission(user, rule.requiredPermission)) return;

        throw new ForbiddenException(
            rule.escalateToPermission
                ? `This decision is above your approval limit — it needs "${rule.escalateToPermission}"`
                : `This decision needs the "${rule.requiredPermission}" permission`,
        );
    }
}
