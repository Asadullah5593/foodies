import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { LeaveType } from '../entities/leave-type.entity';
import { LeaveBalance } from '../entities/leave-balance.entity';
import { LeaveRequest } from '../entities/leave-request.entity';
import { PublicHoliday } from '../entities/public-holiday.entity';
import { HolidayPolicy } from '../entities/holiday-policy.entity';
import { AttendanceDay } from '../entities/attendance-day.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { WorkScheduleTemplate } from '../entities/work-schedule-template.entity';
import { EmployeesService } from './employees.service';
import { AttendanceRecomputeService } from './attendance-recompute.service';
import { HrAuditService } from './hr-audit.service';
import { HrSettingsService } from './hr-settings.service';
import { HrUser } from './employee-scope';
import {
    allocateAgainstBalance,
    expandLeaveDays,
    LeaveDay,
    totalLeaveUnits,
} from './leave-rules';
import { CreateLeaveRequestDto, LeaveQueryDto } from './dto/leave.dto';

@Injectable()
export class LeavesService {
    constructor(
        @InjectRepository(LeaveType)
        private readonly types: Repository<LeaveType>,
        @InjectRepository(LeaveBalance)
        private readonly balances: Repository<LeaveBalance>,
        @InjectRepository(LeaveRequest)
        private readonly requests: Repository<LeaveRequest>,
        @InjectRepository(PublicHoliday)
        private readonly holidays: Repository<PublicHoliday>,
        @InjectRepository(HolidayPolicy)
        private readonly policies: Repository<HolidayPolicy>,
        @InjectRepository(AttendanceDay)
        private readonly days: Repository<AttendanceDay>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        @InjectRepository(WorkScheduleTemplate)
        private readonly templates: Repository<WorkScheduleTemplate>,
        private readonly employeesService: EmployeesService,
        private readonly recompute: AttendanceRecomputeService,
        private readonly audit: HrAuditService,
        private readonly settings: HrSettingsService,
        private readonly dataSource: DataSource,
    ) {}

    // ------------------------------------------------------------ settings

    listTypes(user: HrUser) {
        return this.types.find({
            where: user.tenantId != null ? { tenantId: user.tenantId } : {},
            order: { sortOrder: 'ASC', name: 'ASC' },
        });
    }

    /** Most specific wins: designation+branch → branch → designation → tenant. */
    async resolveHolidayPolicy(
        tenantId: number,
        branchId: number | null,
        designationId: number | null,
    ): Promise<HolidayPolicy> {
        const all = await this.policies.find({
            where: { tenantId, isActive: true },
        });
        const score = (p: HolidayPolicy) =>
            (p.branchId === branchId && branchId != null ? 2 : 0) +
            (p.designationId === designationId && designationId != null
                ? 1
                : 0);

        const applicable = all.filter(
            (p) =>
                (p.branchId == null || p.branchId === branchId) &&
                (p.designationId == null || p.designationId === designationId),
        );
        if (applicable.length === 0) {
            // Defaults in code so a missing row can never silently mean "no
            // entitlement" — that would read as every off being unpaid.
            return this.policies.create({
                tenantId,
                offsPerMonth: 4,
                offsArePaid: true,
                carryForward: false,
                encashUnused: true,
                offSelection: 'floating',
                beyondQuotaTreatment: 'unpaid_leave',
                isActive: true,
            });
        }
        return applicable.sort((a, b) => score(b) - score(a))[0];
    }

    // ------------------------------------------------------------- reads

    async list(user: HrUser, query: LeaveQueryDto) {
        const qb = this.requests
            .createQueryBuilder('r')
            .leftJoin('r.employee', 'emp')
            .leftJoin('r.leaveType', 'lt')
            .leftJoin('r.approver', 'appr')
            .select([
                'r.id',
                'r.fromDate',
                'r.toDate',
                'r.firstDayPart',
                'r.lastDayPart',
                'r.totalDays',
                'r.paidDays',
                'r.unpaidDays',
                'r.reason',
                'r.status',
                'r.approvedAt',
                'r.decisionNote',
                'emp.id',
                'emp.fullName',
                'emp.employeeCode',
                'lt.id',
                'lt.name',
                'lt.isPaid',
                'appr.id',
                'appr.name',
            ])
            .orderBy('r.fromDate', 'DESC')
            .addOrderBy('r.id', 'DESC');

        if (user.tenantId != null) {
            qb.andWhere('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0) return [];
            // Scope through the employee's CURRENT assignment, the same spine
            // every other HR query uses.
            qb.innerJoin(
                'employee_assignments',
                'cur',
                'cur.employee_id = emp.id AND cur.effective_to IS NULL',
            ).andWhere('cur.branch_id IN (:...branchIds)', {
                branchIds: user.allowedBranchIds,
            });
        }
        if (query.employee_id) {
            qb.andWhere('r.employeeId = :empId', { empId: query.employee_id });
        }
        if (query.status) {
            qb.andWhere('r.status = :status', { status: query.status });
        }
        if (query.date_from) {
            qb.andWhere('r.toDate >= :dateFrom', { dateFrom: query.date_from });
        }
        if (query.date_to) {
            qb.andWhere('r.fromDate <= :dateTo', { dateTo: query.date_to });
        }

        return qb.getMany();
    }

    /** Entitlement position for one employee in one month. */
    async balanceFor(
        user: HrUser,
        employeeId: number,
        year: number,
        month: number,
    ) {
        await this.employeesService.loadScoped(user, employeeId);
        const types = await this.listTypes(user);
        const rows = await this.balances.find({
            where: { employeeId, periodYear: year },
        });

        return types.map((type) => {
            const row = rows.find(
                (b) =>
                    b.leaveTypeId === type.id &&
                    (type.accrualMode === 'annual'
                        ? b.periodMonth == null
                        : b.periodMonth === month),
            );
            const entitled = Number(row?.entitled ?? type.quotaPerPeriod);
            const used = Number(row?.used ?? 0);
            const carried = Number(row?.carriedForward ?? 0);
            const adjusted = Number(row?.adjusted ?? 0);
            return {
                leave_type_id: type.id,
                name: type.name,
                code: type.code,
                is_paid: type.isPaid,
                is_monthly_off: type.isMonthlyOff,
                encash_unused: type.encashUnused,
                entitled,
                carried_forward: carried,
                adjusted,
                used,
                available: Number(
                    (entitled + carried + adjusted - used).toFixed(2),
                ),
            };
        });
    }

    // ------------------------------------------------------------- writes

    /**
     * Raise a request. Chargeable days exclude weekly offs and public holidays,
     * and the paid/unpaid split is computed against the balance at approval —
     * not here, because a balance can move between request and decision.
     */
    async create(user: HrUser, dto: CreateLeaveRequestDto) {
        const employee = await this.employeesService.loadScoped(
            user,
            dto.employee_id,
        );
        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new BadRequestException(
                'This employee has left — leave cannot be recorded',
            );
        }
        if (dto.to_date < dto.from_date) {
            throw new BadRequestException(
                'The end date cannot be before the start date',
            );
        }

        const type = await this.types.findOne({
            where: { id: dto.leave_type_id, tenantId: employee.tenantId },
        });
        if (!type) throw new NotFoundException('Leave type not found');

        const overlap = await this.requests
            .createQueryBuilder('r')
            .where('r.employeeId = :employeeId', { employeeId: employee.id })
            .andWhere("r.status IN ('pending', 'approved')")
            .andWhere('r.fromDate <= :to AND r.toDate >= :from', {
                from: dto.from_date,
                to: dto.to_date,
            })
            .getOne();
        if (overlap) {
            throw new BadRequestException(
                `This overlaps an existing ${overlap.status} request (${overlap.fromDate} → ${overlap.toDate})`,
            );
        }

        const chargeable = await this.chargeableDays(
            employee.id,
            employee.tenantId,
            dto.from_date,
            dto.to_date,
            dto.first_day_part,
            dto.last_day_part,
        );
        if (chargeable.length === 0) {
            throw new BadRequestException(
                'Every day in that range is already a weekly off or public holiday',
            );
        }
        if (
            type.maxConsecutiveDays != null &&
            totalLeaveUnits(chargeable) > type.maxConsecutiveDays
        ) {
            throw new BadRequestException(
                `${type.name} allows at most ${type.maxConsecutiveDays} consecutive day(s)`,
            );
        }

        const saved = await this.requests.save(
            this.requests.create({
                tenantId: employee.tenantId,
                employeeId: employee.id,
                leaveTypeId: type.id,
                fromDate: dto.from_date,
                toDate: dto.to_date,
                firstDayPart: dto.first_day_part ?? 'full',
                lastDayPart: dto.last_day_part ?? 'full',
                totalDays: totalLeaveUnits(chargeable),
                reason: dto.reason ?? null,
                attachmentUrl: dto.attachment_url ?? null,
                status: 'pending',
                requestedBy: user.id,
            }),
        );
        return { id: saved.id, total_days: Number(saved.totalDays) };
    }

    /**
     * Decide a request.
     *
     * Approval WRITES INTO `attendance_days` for the covered range, so payroll
     * reads one source. Days already locked by an approved payroll run are left
     * alone and reported back — silently rewriting a paid period would change
     * a financial record after the fact.
     */
    async decide(
        user: HrUser,
        id: number,
        decision: 'approved' | 'rejected' | 'cancelled',
        note?: string,
    ) {
        const request = await this.requests.findOne({ where: { id } });
        if (!request) throw new NotFoundException('Leave request not found');
        const employee = await this.employeesService.loadScoped(
            user,
            request.employeeId,
        );
        if (request.status !== 'pending') {
            throw new BadRequestException(
                `This request was already ${request.status}`,
            );
        }

        // Length-based sign-off, if the tenant configured one. Checked before
        // the rejection path too would be wrong: refusing leave is never the
        // decision anyone escalates.
        if (decision === 'approved') {
            await this.settings.assertApproval(
                user,
                'leave_request',
                {
                    tenantId: employee.tenantId,
                    // Leave requests carry no branch; the rule is scoped by
                    // where the employee currently works.
                    branchId: employee.primaryBranchId ?? null,
                    onDate: request.fromDate,
                },
                { days: Number(request.totalDays ?? 0) },
            );
        }

        if (decision !== 'approved') {
            await this.requests.update(
                { id },
                {
                    status: decision,
                    approvedBy: user.id,
                    approvedAt: new Date(),
                    decisionNote: note ?? null,
                },
            );
            return { id, status: decision, days_written: 0, locked_days: 0 };
        }

        const type = await this.types.findOne({
            where: { id: request.leaveTypeId },
        });
        if (!type) throw new NotFoundException('Leave type not found');

        const chargeable = await this.chargeableDays(
            employee.id,
            employee.tenantId,
            request.fromDate,
            request.toDate,
            request.firstDayPart,
            request.lastDayPart,
        );

        const period = this.periodFor(request.fromDate, type.accrualMode);
        const balance = await this.ensureBalance(
            employee.tenantId,
            employee.id,
            type,
            period,
        );
        const available = type.isPaid
            ? Number(balance.entitled) +
              Number(balance.carriedForward) +
              Number(balance.adjusted) -
              Number(balance.used)
            : 0;

        const split = allocateAgainstBalance(chargeable, available);

        const assignment = await this.assignments.findOne({
            where: { employeeId: employee.id, effectiveTo: IsNull() },
        });
        const branchId = assignment?.branchId ?? employee.primaryBranchId;
        if (!branchId) {
            throw new BadRequestException(
                'This employee has no branch assignment',
            );
        }

        let written = 0;
        let locked = 0;

        await this.dataSource.transaction(async (manager) => {
            const dayRepo = manager.getRepository(AttendanceDay);

            const write = async (day: LeaveDay, paid: boolean) => {
                const existing = await dayRepo.findOne({
                    where: { employeeId: employee.id, workDate: day.date },
                });
                if (existing?.isLocked) {
                    locked += 1;
                    return;
                }
                const status = paid ? 'leave_paid' : 'leave_unpaid';
                if (existing) {
                    await dayRepo.update(
                        { id: existing.id },
                        {
                            status,
                            leaveRequestId: request.id,
                            computedAt: new Date(),
                        },
                    );
                } else {
                    await dayRepo.save(
                        dayRepo.create({
                            tenantId: employee.tenantId,
                            employeeId: employee.id,
                            branchId,
                            workDate: day.date,
                            status,
                            leaveRequestId: request.id,
                            computedAt: new Date(),
                        }),
                    );
                }
                written += 1;
            };

            for (const day of split.paid) await write(day, true);
            for (const day of split.unpaid) await write(day, false);

            await manager.getRepository(LeaveRequest).update(
                { id },
                {
                    status: 'approved',
                    approvedBy: user.id,
                    approvedAt: new Date(),
                    decisionNote: note ?? null,
                    totalDays: totalLeaveUnits(chargeable),
                    paidDays: split.paidUnits,
                    unpaidDays: split.unpaidUnits,
                },
            );

            if (split.paidUnits > 0) {
                await manager
                    .getRepository(LeaveBalance)
                    .update(
                        { id: balance.id },
                        { used: Number(balance.used) + split.paidUnits },
                    );
            }

            await this.employeesService.writeEvent(manager, {
                tenantId: employee.tenantId,
                employeeId: employee.id,
                eventType: 'leave_approved',
                eventDate: request.fromDate,
                title: `${type.name} approved (${totalLeaveUnits(chargeable)} day${
                    totalLeaveUnits(chargeable) === 1 ? '' : 's'
                })`,
                description: request.reason,
                refTable: 'leave_requests',
                refId: request.id,
                payload: {
                    paid_days: split.paidUnits,
                    unpaid_days: split.unpaidUnits,
                },
                createdBy: user.id,
            });
        });

        await this.audit.record({
            tenantId: employee.tenantId,
            actorUserId: user.id,
            action: 'leave.approved',
            entityTable: 'leave_requests',
            entityId: id,
            before: { status: 'pending' },
            after: {
                status: 'approved',
                paid_days: split.paidUnits,
                unpaid_days: split.unpaidUnits,
                locked_days_skipped: locked,
            },
        });

        return {
            id,
            status: 'approved',
            paid_days: split.paidUnits,
            unpaid_days: split.unpaidUnits,
            days_written: written,
            /** Days inside an approved payroll period, deliberately untouched. */
            locked_days: locked,
        };
    }

    // ------------------------------------------------------------ helpers

    /**
     * Days the request actually costs: weekly offs and public holidays removed.
     *
     * Charging someone entitlement for a day they were never going to work is
     * the first complaint any leave module gets, and the hardest to argue with.
     */
    private async chargeableDays(
        employeeId: number,
        tenantId: number,
        from: string,
        to: string,
        firstPart?: string,
        lastPart?: string,
    ): Promise<LeaveDay[]> {
        const assignment = await this.assignments.findOne({
            where: { employeeId, effectiveTo: IsNull() },
        });
        const branchId = assignment?.branchId ?? null;

        const holidays = await this.holidays
            .createQueryBuilder('h')
            .where('h.tenantId = :tenantId', { tenantId })
            .andWhere('h.holidayDate BETWEEN :from AND :to', { from, to })
            .andWhere(
                branchId == null
                    ? 'h.branchId IS NULL'
                    : '(h.branchId IS NULL OR h.branchId = :branchId)',
                branchId == null ? {} : { branchId },
            )
            .getMany();
        const holidayDates = new Set(holidays.map((h) => h.holidayDate));

        const template = branchId
            ? await this.templates.findOne({
                  where: {
                      tenantId,
                      branchId,
                      isActive: true,
                      isDefault: true,
                  },
              })
            : null;
        const fallback =
            template ??
            (await this.templates.findOne({
                where: {
                    tenantId,
                    branchId: IsNull() as unknown as number,
                    isActive: true,
                    isDefault: true,
                },
                order: { id: 'ASC' },
            }));
        const weeklyOffDays: number[] = Array.isArray(fallback?.weeklyOffDays)
            ? fallback.weeklyOffDays
            : [];

        return expandLeaveDays(from, to, {
            firstDayPart: firstPart as never,
            lastDayPart: lastPart as never,
            isNonWorkingDay: (date) => {
                if (holidayDates.has(date)) return true;
                const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
                return weeklyOffDays.includes(weekday);
            },
        });
    }

    private periodFor(
        date: string,
        accrualMode: string,
    ): { year: number; month: number | null } {
        const [y, m] = date.split('-').map(Number);
        return { year: y, month: accrualMode === 'annual' ? null : m };
    }

    /** Create the ledger row on first use, seeded from the type's quota. */
    private async ensureBalance(
        tenantId: number,
        employeeId: number,
        type: LeaveType,
        period: { year: number; month: number | null },
    ): Promise<LeaveBalance> {
        const existing = await this.balances.findOne({
            where: {
                employeeId,
                leaveTypeId: type.id,
                periodYear: period.year,
                periodMonth: period.month ?? (IsNull() as unknown as number),
            },
        });
        if (existing) return existing;

        return this.balances.save(
            this.balances.create({
                tenantId,
                employeeId,
                leaveTypeId: type.id,
                periodYear: period.year,
                periodMonth: period.month,
                entitled: type.quotaPerPeriod,
                used: 0,
                carriedForward: 0,
                adjusted: 0,
            }),
        );
    }

    // --------------------------------------------------------- holidays

    listHolidays(user: HrUser, year?: number) {
        const qb = this.holidays
            .createQueryBuilder('h')
            .orderBy('h.holidayDate', 'ASC');
        if (user.tenantId != null) {
            qb.where('h.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (year) {
            qb.andWhere('EXTRACT(YEAR FROM h.holiday_date) = :year', { year });
        }
        return qb.getMany();
    }

    async createHoliday(
        user: HrUser,
        dto: {
            holiday_date: string;
            name: string;
            branch_id?: number;
            is_paid?: boolean;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        const saved = await this.holidays.save(
            this.holidays.create({
                tenantId: user.tenantId,
                branchId: dto.branch_id ?? null,
                holidayDate: dto.holiday_date,
                name: dto.name,
                isPaid: dto.is_paid ?? true,
            }),
        );
        return { id: saved.id };
    }

    async removeHoliday(user: HrUser, id: number) {
        const holiday = await this.holidays.findOne({ where: { id } });
        if (!holiday) throw new NotFoundException('Holiday not found');
        if (user.tenantId != null && holiday.tenantId !== user.tenantId) {
            throw new NotFoundException('Holiday not found');
        }
        await this.holidays.delete({ id });
        return { deleted: true };
    }
}
