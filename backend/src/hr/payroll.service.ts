import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { PayrollRun } from '../entities/payroll-run.entity';
import { PayrollLine } from '../entities/payroll-line.entity';
import { PayrollLineItem } from '../entities/payroll-line-item.entity';
import { PayrollAdjustment } from '../entities/payroll-adjustment.entity';
import { EmployeeSalaryStructure } from '../entities/employee-salary-structure.entity';
import { OvertimePolicy } from '../entities/overtime-policy.entity';
import { AttendanceDay } from '../entities/attendance-day.entity';
import { AttendanceException } from '../entities/attendance-exception.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { Employee } from '../entities/employee.entity';
import { WorkScheduleTemplate } from '../entities/work-schedule-template.entity';
import { Permissions } from '../roles/permissions.dto';
import { LeavesService } from './leaves.service';
import { HrAuditService } from './hr-audit.service';
import { hasPermission, HrUser } from './employee-scope';
import {
    AttendanceFacts,
    computePayrollLines,
    PayrollLineItem as ComputedItem,
    Waiver,
} from './payroll-rules';

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(from: string, to: string): number {
    const a = new Date(`${from}T00:00:00Z`).getTime();
    const b = new Date(`${to}T00:00:00Z`).getTime();
    return Math.round((b - a) / 86_400_000) + 1;
}

@Injectable()
export class PayrollService {
    constructor(
        @InjectRepository(PayrollRun)
        private readonly runs: Repository<PayrollRun>,
        @InjectRepository(PayrollLine)
        private readonly lines: Repository<PayrollLine>,
        @InjectRepository(PayrollLineItem)
        private readonly lineItems: Repository<PayrollLineItem>,
        @InjectRepository(PayrollAdjustment)
        private readonly adjustments: Repository<PayrollAdjustment>,
        @InjectRepository(EmployeeSalaryStructure)
        private readonly structures: Repository<EmployeeSalaryStructure>,
        @InjectRepository(OvertimePolicy)
        private readonly otPolicies: Repository<OvertimePolicy>,
        @InjectRepository(AttendanceDay)
        private readonly days: Repository<AttendanceDay>,
        @InjectRepository(AttendanceException)
        private readonly exceptions: Repository<AttendanceException>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        @InjectRepository(Employee)
        private readonly employees: Repository<Employee>,
        @InjectRepository(WorkScheduleTemplate)
        private readonly templates: Repository<WorkScheduleTemplate>,
        private readonly leaves: LeavesService,
        private readonly audit: HrAuditService,
        private readonly dataSource: DataSource,
    ) {}

    // ------------------------------------------------------------- lifecycle

    async createRun(
        user: HrUser,
        dto: { period_from: string; period_to: string; branch_id?: number },
    ) {
        const tenantId = this.requireTenant(user);
        if (dto.period_to < dto.period_from) {
            throw new BadRequestException(
                'The period end cannot be before the start',
            );
        }

        const clash = await this.runs
            .createQueryBuilder('r')
            .where('r.tenantId = :tenantId', { tenantId })
            .andWhere('r.status <> :reversed', { reversed: 'reversed' })
            .andWhere('r.periodFrom = :from AND r.periodTo = :to', {
                from: dto.period_from,
                to: dto.period_to,
            })
            .andWhere(
                dto.branch_id == null
                    ? 'r.branchId IS NULL'
                    : 'r.branchId = :branchId',
                dto.branch_id == null ? {} : { branchId: dto.branch_id },
            )
            .getOne();
        if (clash) {
            throw new BadRequestException(
                `A payroll run already exists for that period (#${clash.id}, ${clash.status})`,
            );
        }

        const run = await this.runs.save(
            this.runs.create({
                tenantId,
                branchId: dto.branch_id ?? null,
                periodFrom: dto.period_from,
                periodTo: dto.period_to,
                status: 'draft',
                requestedBy: user.id,
            }),
        );
        return { id: run.id, status: run.status };
    }

    /**
     * Compute (or recompute) every line in the run.
     *
     * Freely repeatable while the run is draft or computed — the whole point of
     * the state machine is that nothing is final until approval.
     */
    async compute(user: HrUser, runId: number) {
        const run = await this.loadRun(user, runId);
        if (!['draft', 'computed'].includes(run.status)) {
            throw new BadRequestException(
                `A ${run.status} run cannot be recomputed. Reverse it first.`,
            );
        }

        const employees = await this.employeesInScope(run);
        const otPolicy = await this.resolveOvertimePolicy(
            run.tenantId,
            run.branchId,
        );

        let computed = 0;
        const skipped: Array<{ employee: string; reason: string }> = [];

        await this.dataSource.transaction(async (manager) => {
            // Wipe and rebuild: recompute must be idempotent, and stale lines
            // from a previous pass would otherwise survive a salary change.
            const existing = await manager
                .getRepository(PayrollLine)
                .find({ where: { runId }, select: { id: true } });
            if (existing.length > 0) {
                await manager
                    .getRepository(PayrollLine)
                    .delete(existing.map((l) => l.id));
            }

            for (const employee of employees) {
                const structure = await this.effectiveStructure(
                    employee.id,
                    run.periodTo,
                );
                if (!structure) {
                    skipped.push({
                        employee: employee.fullName,
                        reason: 'no salary structure',
                    });
                    continue;
                }

                const facts = await this.attendanceFacts(
                    employee,
                    run.periodFrom,
                    run.periodTo,
                );
                const waivers = await this.waiversFor(
                    employee.id,
                    run.periodFrom,
                    run.periodTo,
                );
                const assignment = await this.assignments.findOne({
                    where: { employeeId: employee.id, effectiveTo: IsNull() },
                });
                const policy = await this.leaves.resolveHolidayPolicy(
                    run.tenantId,
                    assignment?.branchId ?? null,
                    assignment?.designationId ?? null,
                );
                const template = await this.templates.findOne({
                    where: {
                        tenantId: run.tenantId,
                        isActive: true,
                        isDefault: true,
                    },
                    order: { id: 'ASC' },
                });

                const daysInMonth = daysBetween(run.periodFrom, run.periodTo);
                const employedDays = this.employedDaysInPeriod(
                    employee,
                    run.periodFrom,
                    run.periodTo,
                );

                const result = computePayrollLines({
                    facts,
                    salary: {
                        basicAmount: Number(structure.basicAmount),
                        dailyRateBasis: structure.dailyRateBasis as 'fixed_30',
                        components: (structure.components ?? []).map((c) => ({
                            componentKey: c.componentKey,
                            name: c.name,
                            kind: c.kind as 'earning',
                            calcType: c.calcType as 'flat',
                            amount: Number(c.amount),
                        })),
                        perDeliveredOrderAmount: Number(
                            structure.perDeliveredOrderAmount,
                        ),
                        scheduledMinutesPerDay: template
                            ? Math.max(60, template.minMinutesFullDay + 60)
                            : 540,
                        overtimeRateMultiplier: Number(otPolicy.rateValue),
                    },
                    period: {
                        daysInMonth,
                        employedDays,
                        workingDaysInPeriod: Math.max(
                            1,
                            daysInMonth - facts.weeklyOffDays,
                        ),
                        offsEntitled: Number(policy.offsPerMonth),
                        offsTaken: facts.paidLeaveDays,
                        encashUnusedOffs: policy.encashUnused,
                    },
                    waivers,
                    adjustments: [],
                });

                const line = await manager.getRepository(PayrollLine).save(
                    manager.getRepository(PayrollLine).create({
                        runId,
                        employeeId: employee.id,
                        designationId: assignment?.designationId ?? null,
                        salaryStructureId: structure.id,
                        presentDays: facts.presentDays,
                        halfDays: facts.halfDays,
                        paidLeaveDays: facts.paidLeaveDays,
                        unpaidLeaveDays: facts.unpaidLeaveDays,
                        absentDays: facts.absentDays,
                        weeklyOffDays: facts.weeklyOffDays,
                        holidayDays: facts.holidayDays,
                        encashedOffDays: Math.max(
                            0,
                            Number(policy.offsPerMonth) - facts.paidLeaveDays,
                        ),
                        overtimeMinutes: facts.approvedOvertimeMinutes,
                        lateCount: facts.lateCount,
                        deliveredOrders: facts.deliveredOrders,
                        grossEarnings: result.grossEarnings,
                        totalDeductions: result.totalDeductions,
                        netPayable: result.netPayable,
                        currency: structure.currency,
                    }),
                );

                await this.persistItems(manager, line.id, result.items);
                computed += 1;
            }

            await manager.getRepository(PayrollRun).update(
                { id: runId },
                {
                    status: 'computed',
                    computedAt: new Date(),
                    ruleSnapshot: {
                        overtime_rate: Number(otPolicy.rateValue),
                        overtime_requires_approval: otPolicy.requiresApproval,
                        computed_by: user.id,
                    },
                },
            );
        });

        return { id: runId, status: 'computed', lines: computed, skipped };
    }

    /**
     * Checks that must pass before a run can be approved.
     *
     * Pending overtime is the important one: unapproved minutes are never paid,
     * so approving with some still pending silently underpays whoever earned it.
     */
    async preflight(user: HrUser, runId: number) {
        const run = await this.loadRun(user, runId);
        const scope = { from: run.periodFrom, to: run.periodTo };

        const qb = this.days
            .createQueryBuilder('d')
            .leftJoin('d.employee', 'emp')
            .where('d.tenantId = :tenantId', { tenantId: run.tenantId })
            .andWhere('d.workDate BETWEEN :from AND :to', scope);
        if (run.branchId != null) {
            qb.andWhere('d.branchId = :branchId', { branchId: run.branchId });
        }
        const days = await qb.getMany();

        const pendingOt = days.filter((d) => d.overtimeMinutesPending > 0);
        const missingOut = days.filter((d) => d.exceptionFlags?.missing_out);
        const pendingExceptions = await this.exceptions.count({
            where: { tenantId: run.tenantId, status: 'pending' },
        });
        const lines = await this.lines.find({ where: { runId } });

        const blockers: string[] = [];
        if (lines.length === 0)
            blockers.push('No lines — compute the run first');
        if (pendingOt.length > 0) {
            blockers.push(
                `${pendingOt.length} day(s) have unapproved overtime, which will not be paid`,
            );
        }
        if (missingOut.length > 0) {
            blockers.push(
                `${missingOut.length} day(s) have no clock-out and count as zero hours`,
            );
        }
        if (pendingExceptions > 0) {
            blockers.push(
                `${pendingExceptions} attendance correction(s) or waiver(s) still awaiting a decision`,
            );
        }

        return {
            ready: blockers.length === 0,
            blockers,
            line_count: lines.length,
            total_net: round2(
                lines.reduce((s, l) => s + Number(l.netPayable), 0),
            ),
        };
    }

    /**
     * Approve, and LOCK the attendance period.
     *
     * After this there is no edit path — only a reversal (which unlocks) or an
     * adjustment carried into the next period. Approved payroll is a financial
     * record, and an editable financial record is not one.
     */
    async approve(user: HrUser, runId: number, force = false) {
        const run = await this.loadRun(user, runId);
        if (run.status !== 'computed' && run.status !== 'pending_approval') {
            throw new BadRequestException(
                `A ${run.status} run cannot be approved`,
            );
        }

        const check = await this.preflight(user, runId);
        if (!check.ready && !force) {
            throw new BadRequestException(
                `Cannot approve: ${check.blockers.join('; ')}. Resolve these, or approve with force to accept them.`,
            );
        }

        await this.dataSource.transaction(async (manager) => {
            const qb = manager
                .getRepository(AttendanceDay)
                .createQueryBuilder()
                .update()
                .set({ isLocked: true })
                .where('tenant_id = :tenantId', { tenantId: run.tenantId })
                .andWhere('work_date BETWEEN :from AND :to', {
                    from: run.periodFrom,
                    to: run.periodTo,
                });
            if (run.branchId != null) {
                qb.andWhere('branch_id = :branchId', {
                    branchId: run.branchId,
                });
            }
            await qb.execute();

            await manager.getRepository(PayrollRun).update(
                { id: runId },
                {
                    status: 'approved',
                    approvedBy: user.id,
                    approvedAt: new Date(),
                },
            );
        });

        await this.audit.record({
            tenantId: run.tenantId,
            actorUserId: user.id,
            action: 'payroll.approved',
            entityTable: 'payroll_runs',
            entityId: runId,
            before: { status: run.status },
            after: {
                status: 'approved',
                forced: force && !check.ready,
                blockers_accepted: force ? check.blockers : [],
            },
        });

        return { id: runId, status: 'approved', attendance_locked: true };
    }

    /** Reverse an approved run and unlock the period. Reason is mandatory. */
    async reverse(user: HrUser, runId: number, reason: string) {
        const run = await this.loadRun(user, runId);
        if (!['approved', 'paid'].includes(run.status)) {
            throw new BadRequestException(
                `Only an approved or paid run can be reversed (this one is ${run.status})`,
            );
        }
        if (!reason?.trim()) {
            throw new BadRequestException('A reversal reason is required');
        }

        await this.dataSource.transaction(async (manager) => {
            const qb = manager
                .getRepository(AttendanceDay)
                .createQueryBuilder()
                .update()
                .set({ isLocked: false })
                .where('tenant_id = :tenantId', { tenantId: run.tenantId })
                .andWhere('work_date BETWEEN :from AND :to', {
                    from: run.periodFrom,
                    to: run.periodTo,
                });
            if (run.branchId != null) {
                qb.andWhere('branch_id = :branchId', {
                    branchId: run.branchId,
                });
            }
            await qb.execute();

            await manager.getRepository(PayrollRun).update(
                { id: runId },
                {
                    status: 'reversed',
                    reversedBy: user.id,
                    reversedAt: new Date(),
                    reversalReason: reason.trim(),
                },
            );
        });

        await this.audit.record({
            tenantId: run.tenantId,
            actorUserId: user.id,
            action: 'payroll.reversed',
            entityTable: 'payroll_runs',
            entityId: runId,
            before: { status: run.status },
            after: { status: 'reversed', reason: reason.trim() },
        });

        return { id: runId, status: 'reversed', attendance_unlocked: true };
    }

    async markPaid(user: HrUser, runId: number) {
        const run = await this.loadRun(user, runId);
        if (run.status !== 'approved') {
            throw new BadRequestException(
                `Only an approved run can be marked paid (this one is ${run.status})`,
            );
        }
        await this.runs.update(
            { id: runId },
            { status: 'paid', paidAt: new Date() },
        );
        await this.lines.update({ runId }, { paymentStatus: 'paid' });
        return { id: runId, status: 'paid' };
    }

    // ---------------------------------------------------------- adjustments

    /**
     * Admin / HR override of a computed figure (decision #9).
     *
     * Recorded as its own immutable row and its own payslip line — the computed
     * deduction stays visible next to it. Allowed on an APPROVED run too,
     * because the alternative is reversing a whole month's payroll to fix one
     * person's PKR 500.
     */
    async addAdjustment(
        user: HrUser,
        lineId: number,
        dto: {
            direction: 'waive' | 'add_deduction' | 'add_earning';
            amount: number;
            reason: string;
            target_component_key?: string;
        },
    ) {
        if (!hasPermission(user, Permissions.PAYROLL_ADJUST)) {
            throw new ForbiddenException(
                'Adjusting a payslip requires payroll:adjust',
            );
        }
        if (!dto.reason?.trim()) {
            throw new BadRequestException('A reason is required');
        }
        if (!(dto.amount > 0)) {
            throw new BadRequestException('Amount must be greater than zero');
        }

        const line = await this.lines.findOne({
            where: { id: lineId },
            relations: ['run'],
        });
        if (!line) throw new NotFoundException('Payslip not found');
        if (user.tenantId != null && line.run.tenantId !== user.tenantId) {
            throw new NotFoundException('Payslip not found');
        }
        if (line.run.status === 'reversed') {
            throw new BadRequestException('This run has been reversed');
        }

        const saved = await this.adjustments.save(
            this.adjustments.create({
                tenantId: line.run.tenantId,
                payrollLineId: lineId,
                direction: dto.direction,
                targetComponentKey: dto.target_component_key ?? null,
                amount: dto.amount,
                reason: dto.reason.trim(),
                createdBy: user.id,
            }),
        );

        await this.applyAdjustmentsToLine(lineId);

        await this.audit.record({
            tenantId: line.run.tenantId,
            actorUserId: user.id,
            action: `payroll.adjustment.${dto.direction}`,
            entityTable: 'payroll_adjustments',
            entityId: saved.id,
            after: {
                payroll_line_id: lineId,
                amount: dto.amount,
                reason: dto.reason.trim(),
            },
        });

        return { id: saved.id };
    }

    /** Re-apply every adjustment on a line and refresh its totals. */
    private async applyAdjustmentsToLine(lineId: number): Promise<void> {
        const line = await this.lines.findOne({ where: { id: lineId } });
        if (!line) return;

        const adjustments = await this.adjustments.find({
            where: { payrollLineId: lineId },
            relations: ['creator'],
            order: { id: 'ASC' },
        });

        await this.lineItems.delete({
            payrollLineId: lineId,
            kind: 'adjustment',
        });

        let credits = 0;
        let debits = 0;
        let sortOrder = 900;
        for (const adj of adjustments) {
            const amount = Number(adj.amount);
            const isCredit = adj.direction !== 'add_deduction';
            if (isCredit) credits += amount;
            else debits += amount;
            sortOrder += 1;
            await this.lineItems.save(
                this.lineItems.create({
                    payrollLineId: lineId,
                    componentKey:
                        adj.targetComponentKey ?? `manual_${adj.direction}`,
                    componentName:
                        adj.direction === 'add_earning'
                            ? 'Manual addition'
                            : adj.direction === 'add_deduction'
                              ? 'Manual deduction'
                              : 'Manual waiver',
                    kind: 'adjustment',
                    quantity: 1,
                    rate: amount,
                    amount,
                    calcMeta: {
                        direction: adj.direction,
                        reason: adj.reason,
                        actor: adj.creator?.name ?? null,
                    },
                    sortOrder,
                }),
            );
        }

        // Recompute totals from the stored items so the header can never drift
        // from the lines beneath it.
        const items = await this.lineItems.find({
            where: { payrollLineId: lineId },
        });
        const gross = items
            .filter((i) => i.kind === 'earning')
            .reduce((s, i) => s + Number(i.amount), 0);
        const rawDeductions = items
            .filter((i) => i.kind === 'deduction')
            .reduce((s, i) => s + Number(i.amount), 0);
        const forgiven = items
            .filter((i) => i.kind === 'waiver')
            .reduce((s, i) => s + Number(i.amount), 0);

        const totalDeductions = round2(
            Math.max(0, rawDeductions - forgiven + debits),
        );
        await this.lines.update(
            { id: lineId },
            {
                grossEarnings: round2(gross),
                totalDeductions,
                netPayable: round2(
                    Math.max(0, gross + credits - totalDeductions),
                ),
            },
        );
    }

    // ---------------------------------------------------------------- reads

    async listRuns(user: HrUser) {
        const qb = this.runs
            .createQueryBuilder('r')
            .leftJoin('r.branch', 'br')
            .leftJoin('r.approver', 'appr')
            .select([
                'r.id',
                'r.periodFrom',
                'r.periodTo',
                'r.status',
                'r.computedAt',
                'r.approvedAt',
                'r.paidAt',
                'r.reversalReason',
                'br.id',
                'br.name',
                'appr.id',
                'appr.name',
            ])
            .orderBy('r.periodFrom', 'DESC');
        if (user.tenantId != null) {
            qb.where('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        return qb.getMany();
    }

    async getRun(user: HrUser, runId: number) {
        const run = await this.loadRun(user, runId);
        const lines = await this.lines.find({
            where: { runId },
            relations: ['employee'],
            order: { id: 'ASC' },
        });
        return {
            id: run.id,
            period_from: run.periodFrom,
            period_to: run.periodTo,
            status: run.status,
            rule_snapshot: run.ruleSnapshot,
            reversal_reason: run.reversalReason,
            totals: {
                gross: round2(
                    lines.reduce((s, l) => s + Number(l.grossEarnings), 0),
                ),
                deductions: round2(
                    lines.reduce((s, l) => s + Number(l.totalDeductions), 0),
                ),
                net: round2(
                    lines.reduce((s, l) => s + Number(l.netPayable), 0),
                ),
            },
            lines: lines.map((l) => ({
                id: l.id,
                employee: {
                    id: l.employeeId,
                    full_name: l.employee?.fullName,
                    employee_code: l.employee?.employeeCode,
                },
                present_days: Number(l.presentDays),
                absent_days: Number(l.absentDays),
                half_days: Number(l.halfDays),
                paid_leave_days: Number(l.paidLeaveDays),
                unpaid_leave_days: Number(l.unpaidLeaveDays),
                late_count: l.lateCount,
                overtime_minutes: l.overtimeMinutes,
                delivered_orders: l.deliveredOrders,
                gross_earnings: Number(l.grossEarnings),
                total_deductions: Number(l.totalDeductions),
                net_payable: Number(l.netPayable),
                payment_status: l.paymentStatus,
            })),
        };
    }

    /** One payslip, with every line and its arithmetic. */
    async getPayslip(user: HrUser, lineId: number) {
        const line = await this.lines.findOne({
            where: { id: lineId },
            relations: ['employee', 'run'],
        });
        if (!line) throw new NotFoundException('Payslip not found');
        if (user.tenantId != null && line.run.tenantId !== user.tenantId) {
            throw new NotFoundException('Payslip not found');
        }
        const items = await this.lineItems.find({
            where: { payrollLineId: lineId },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });

        return {
            id: line.id,
            run: {
                id: line.run.id,
                period_from: line.run.periodFrom,
                period_to: line.run.periodTo,
                status: line.run.status,
            },
            employee: {
                id: line.employeeId,
                full_name: line.employee?.fullName,
                employee_code: line.employee?.employeeCode,
            },
            attendance: {
                present_days: Number(line.presentDays),
                half_days: Number(line.halfDays),
                paid_leave_days: Number(line.paidLeaveDays),
                unpaid_leave_days: Number(line.unpaidLeaveDays),
                absent_days: Number(line.absentDays),
                weekly_off_days: Number(line.weeklyOffDays),
                holiday_days: Number(line.holidayDays),
                late_count: line.lateCount,
                overtime_minutes: line.overtimeMinutes,
            },
            items: items.map((i) => ({
                component_key: i.componentKey,
                component_name: i.componentName,
                kind: i.kind,
                quantity: Number(i.quantity),
                rate: Number(i.rate),
                amount: Number(i.amount),
                /** The arithmetic behind the figure — see docs/HRM.md §10.2. */
                calc_meta: i.calcMeta,
            })),
            gross_earnings: Number(line.grossEarnings),
            total_deductions: Number(line.totalDeductions),
            net_payable: Number(line.netPayable),
            currency: line.currency,
        };
    }

    // ------------------------------------------------------ salary structures

    /**
     * Set or revise pay.
     *
     * Never updates the open structure — closes it the day before and opens a
     * new one, the same pattern as employee_assignments. A raise must leave a
     * dated trail, because payroll, reviews and exit settlements all ask what
     * someone was paid *at the time*.
     */
    async setSalary(
        user: HrUser,
        employeeId: number,
        dto: {
            effective_from: string;
            basic_amount: number;
            pay_type?: string;
            daily_rate_basis?: string;
            per_delivered_order_amount?: number;
            change_reason?: string;
            components?: Array<{
                component_key: string;
                name: string;
                kind: 'earning' | 'deduction';
                calc_type: 'flat' | 'percent_of_basic';
                amount: number;
            }>;
        },
    ) {
        if (!hasPermission(user, Permissions.SALARY_EDIT)) {
            throw new ForbiddenException('Setting salary requires salary:edit');
        }
        const employee = await this.employees.findOne({
            where: { id: employeeId },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        if (user.tenantId != null && employee.tenantId !== user.tenantId) {
            throw new NotFoundException('Employee not found');
        }

        const current = await this.structures.findOne({
            where: { employeeId, effectiveTo: IsNull() },
        });
        if (current && dto.effective_from <= current.effectiveFrom) {
            throw new BadRequestException(
                `The effective date must be after the current structure started (${current.effectiveFrom})`,
            );
        }

        return this.dataSource.transaction(async (manager) => {
            if (current) {
                const closeOn = new Date(`${dto.effective_from}T00:00:00Z`);
                closeOn.setUTCDate(closeOn.getUTCDate() - 1);
                await manager
                    .getRepository(EmployeeSalaryStructure)
                    .update(
                        { id: current.id },
                        { effectiveTo: closeOn.toISOString().slice(0, 10) },
                    );
            }

            const structure = await manager
                .getRepository(EmployeeSalaryStructure)
                .save(
                    manager.getRepository(EmployeeSalaryStructure).create({
                        tenantId: employee.tenantId,
                        employeeId,
                        effectiveFrom: dto.effective_from,
                        effectiveTo: null,
                        payType: dto.pay_type ?? 'monthly',
                        basicAmount: dto.basic_amount,
                        dailyRateBasis: dto.daily_rate_basis ?? 'fixed_30',
                        perDeliveredOrderAmount:
                            dto.per_delivered_order_amount ?? 0,
                        changeReason:
                            dto.change_reason ??
                            (current ? 'revision' : 'initial'),
                        createdBy: user.id,
                    }),
                );

            for (const [index, c] of (dto.components ?? []).entries()) {
                await manager.query(
                    `INSERT INTO employee_salary_components
                        (structure_id, component_key, name, kind, calc_type, amount, sort_order)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        structure.id,
                        c.component_key,
                        c.name,
                        c.kind,
                        c.calc_type,
                        c.amount,
                        index,
                    ],
                );
            }

            await manager.query(
                `INSERT INTO employee_events
                    (tenant_id, employee_id, event_type, event_date, title, description, ref_table, ref_id, payload, created_by)
                 VALUES ($1, $2, 'salary_changed', $3, $4, $5, 'employee_salary_structures', $6, $7, $8)`,
                [
                    employee.tenantId,
                    employeeId,
                    dto.effective_from,
                    current ? 'Salary revised' : 'Salary set',
                    dto.change_reason ?? null,
                    structure.id,
                    JSON.stringify({
                        // The amounts live in the audit log and the structure
                        // rows; the timeline entry stays readable to anyone who
                        // may see the employee but not their pay.
                        previous_structure_id: current?.id ?? null,
                    }),
                    user.id,
                ],
            );

            await this.audit.record(
                {
                    tenantId: employee.tenantId,
                    actorUserId: user.id,
                    action: current ? 'salary.revised' : 'salary.set',
                    entityTable: 'employee_salary_structures',
                    entityId: structure.id,
                    before: current
                        ? { basic_amount: Number(current.basicAmount) }
                        : {},
                    after: { basic_amount: dto.basic_amount },
                },
                manager,
            );

            return { id: structure.id };
        });
    }

    /** Salary history, newest first. Gated by salary:view at the controller. */
    async salaryHistory(user: HrUser, employeeId: number) {
        const employee = await this.employees.findOne({
            where: { id: employeeId },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        if (user.tenantId != null && employee.tenantId !== user.tenantId) {
            throw new NotFoundException('Employee not found');
        }
        const rows = await this.structures.find({
            where: { employeeId },
            relations: ['components', 'creator'],
            order: { effectiveFrom: 'DESC', id: 'DESC' },
        });
        return rows.map((s) => ({
            id: s.id,
            effective_from: s.effectiveFrom,
            effective_to: s.effectiveTo,
            is_current: s.effectiveTo == null,
            pay_type: s.payType,
            basic_amount: Number(s.basicAmount),
            daily_rate_basis: s.dailyRateBasis,
            per_delivered_order_amount: Number(s.perDeliveredOrderAmount),
            change_reason: s.changeReason,
            set_by: s.creator
                ? { id: s.creator.id, name: s.creator.name }
                : null,
            components: (s.components ?? []).map((c) => ({
                component_key: c.componentKey,
                name: c.name,
                kind: c.kind,
                calc_type: c.calcType,
                amount: Number(c.amount),
            })),
        }));
    }

    // -------------------------------------------------------------- helpers

    private async persistItems(
        manager: { getRepository: typeof DataSource.prototype.getRepository },
        lineId: number,
        items: ComputedItem[],
    ): Promise<void> {
        const repo = manager.getRepository(PayrollLineItem);
        let sortOrder = 0;
        for (const item of items) {
            sortOrder += 1;
            await repo.save(
                repo.create({
                    payrollLineId: lineId,
                    componentKey: item.componentKey,
                    componentName: item.componentName,
                    kind: item.kind,
                    quantity: item.quantity,
                    rate: item.rate,
                    amount: item.amount,
                    calcMeta: item.calcMeta,
                    sortOrder,
                }),
            );
        }
    }

    /** Attendance facts for the period, including rider deliveries. */
    private async attendanceFacts(
        employee: Employee,
        from: string,
        to: string,
    ): Promise<AttendanceFacts> {
        const rows = await this.days
            .createQueryBuilder('d')
            .where('d.employeeId = :id', { id: employee.id })
            .andWhere('d.workDate BETWEEN :from AND :to', { from, to })
            .getMany();

        const count = (status: string) =>
            rows.filter((r) => r.status === status).length;

        // Riders are paid per DELIVERED order, counted from the orders table —
        // the same fact the old rider payroll used, now feeding one engine.
        let deliveredOrders = 0;
        if (employee.userId) {
            const result = await this.dataSource.query<
                Array<{ count: string }>
            >(
                `SELECT COUNT(*) AS count FROM orders
                 WHERE rider_id = $1
                   AND delivery_status = 'delivered'
                   AND DATE(completed_at) BETWEEN $2 AND $3`,
                [employee.userId, from, to],
            );
            deliveredOrders = Number(result?.[0]?.count ?? 0);
        }

        return {
            presentDays: count('present'),
            halfDays: count('half_day'),
            paidLeaveDays: count('leave_paid'),
            unpaidLeaveDays: count('leave_unpaid'),
            absentDays: count('absent'),
            weeklyOffDays: count('weekly_off'),
            holidayDays: count('holiday'),
            lateCount: rows.filter((r) => r.lateMinutes > 0).length,
            approvedOvertimeMinutes: rows.reduce(
                (s, r) => s + r.overtimeMinutesApproved,
                0,
            ),
            deliveredOrders,
        };
    }

    /** Approved waivers in the period, carried into payroll as offset lines. */
    private async waiversFor(
        employeeId: number,
        from: string,
        to: string,
    ): Promise<Waiver[]> {
        const rows = await this.exceptions
            .createQueryBuilder('e')
            .leftJoin('e.attendanceDay', 'd')
            .leftJoin('e.approver', 'appr')
            .where('e.kind = :kind', { kind: 'waiver' })
            .andWhere('e.status = :status', { status: 'approved' })
            .andWhere('d.employee_id = :employeeId', { employeeId })
            .andWhere('d.work_date BETWEEN :from AND :to', { from, to })
            .select(['e.subject', 'e.reason', 'e.amountWaived', 'appr.name'])
            .getMany();

        return rows.map((r) => ({
            // 'late' and 'absent' map onto the deduction component keys the
            // engine produces.
            subject: r.subject === 'absent' ? 'absence' : r.subject,
            reason: r.reason,
            approvedByName: r.approver?.name ?? null,
            amount: r.amountWaived != null ? Number(r.amountWaived) : null,
        }));
    }

    private async effectiveStructure(
        employeeId: number,
        onDate: string,
    ): Promise<EmployeeSalaryStructure | null> {
        return this.structures.findOne({
            where: {
                employeeId,
                effectiveFrom: LessThanOrEqual(onDate),
            },
            relations: ['components'],
            order: { effectiveFrom: 'DESC', id: 'DESC' },
        });
    }

    private async resolveOvertimePolicy(
        tenantId: number,
        branchId: number | null,
    ): Promise<OvertimePolicy> {
        const all = await this.otPolicies.find({
            where: { tenantId, isActive: true },
        });
        const applicable = all.filter(
            (p) => p.branchId == null || p.branchId === branchId,
        );
        const best = applicable.sort(
            (a, b) =>
                (b.branchId == null ? 0 : 1) - (a.branchId == null ? 0 : 1),
        )[0];
        return (
            best ??
            this.otPolicies.create({
                tenantId,
                rateValue: 1,
                requiresApproval: true,
                isActive: true,
            })
        );
    }

    /** Days on the payroll, so joiners and leavers are prorated. */
    private employedDaysInPeriod(
        employee: Employee,
        from: string,
        to: string,
    ): number {
        const start =
            employee.dateOfJoining > from ? employee.dateOfJoining : from;
        const end =
            employee.dateOfLeaving && employee.dateOfLeaving < to
                ? employee.dateOfLeaving
                : to;
        if (end < start) return 0;
        return daysBetween(start, end);
    }

    private async employeesInScope(run: PayrollRun): Promise<Employee[]> {
        const qb = this.employees
            .createQueryBuilder('emp')
            .innerJoin('emp.assignments', 'cur', 'cur.effectiveTo IS NULL')
            .where('emp.tenantId = :tenantId', { tenantId: run.tenantId })
            // Someone who left mid-period is still owed those days, so leavers
            // are included and prorated rather than excluded.
            .andWhere(
                '(emp.dateOfLeaving IS NULL OR emp.dateOfLeaving >= :from)',
                { from: run.periodFrom },
            )
            .andWhere('emp.dateOfJoining <= :to', { to: run.periodTo });
        if (run.branchId != null) {
            qb.andWhere('cur.branchId = :branchId', { branchId: run.branchId });
        }
        return qb.getMany();
    }

    private async loadRun(user: HrUser, runId: number): Promise<PayrollRun> {
        const run = await this.runs.findOne({ where: { id: runId } });
        if (!run) throw new NotFoundException('Payroll run not found');
        if (user.tenantId != null && run.tenantId !== user.tenantId) {
            throw new NotFoundException('Payroll run not found');
        }
        return run;
    }

    private requireTenant(user: HrUser): number {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant to run payroll',
            );
        }
        return user.tenantId;
    }
}
