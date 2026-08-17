import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmployeeSchedule } from '../entities/employee-schedule.entity';
import { WorkScheduleTemplate } from '../entities/work-schedule-template.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { AttendanceRecomputeService } from './attendance-recompute.service';
import { HrAuditService } from './hr-audit.service';
import { HrUser } from './employee-scope';

export type RosterCell = {
    employee_id: number;
    work_date: string;
    template_id?: number | null;
    is_weekly_off?: boolean;
    is_holiday?: boolean;
};

/** Guard against a fat-fingered date range pulling the whole year. */
const MAX_RANGE_DAYS = 42;

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const daysBetween = (from: string, to: string) =>
    Math.round(
        (new Date(`${to}T00:00:00Z`).getTime() -
            new Date(`${from}T00:00:00Z`).getTime()) /
            86_400_000,
    );

/**
 * The published roster.
 *
 * Every employee works fixed timings today, so a roster row is the exception
 * rather than the rule: absence of a row means "use the employee's default
 * template", which is what the attendance engine already does. That is why this
 * service DELETES a cell rather than storing an "unset" row — a row that means
 * nothing would still shadow the default.
 *
 * Writing a cell recomputes that attendance day, so a correction to a past date
 * lands in the register immediately instead of at the next punch. Days inside an
 * approved payroll period refuse to recompute, which is enforced downstream.
 */
@Injectable()
export class RosterService {
    constructor(
        @InjectRepository(EmployeeSchedule)
        private readonly schedules: Repository<EmployeeSchedule>,
        @InjectRepository(WorkScheduleTemplate)
        private readonly templates: Repository<WorkScheduleTemplate>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        private readonly recompute: AttendanceRecomputeService,
        private readonly audit: HrAuditService,
    ) {}

    listTemplates(user: HrUser, branchId?: number) {
        const qb = this.templates
            .createQueryBuilder('t')
            .where('t.isActive = true')
            .orderBy('t.name', 'ASC');
        if (user.tenantId != null) {
            qb.andWhere('t.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (branchId) {
            // Tenant-wide templates (branchId null) apply everywhere, so they
            // must stay in the list beside the branch's own.
            qb.andWhere('(t.branchId = :branchId OR t.branchId IS NULL)', {
                branchId,
            });
        }
        return qb.getMany();
    }

    /**
     * The grid: who is assigned to this branch over the range, and every roster
     * row they already have.
     */
    async grid(
        user: HrUser,
        params: { branch_id: number; from: string; to: string },
    ) {
        if (!isDate(params.from) || !isDate(params.to)) {
            throw new BadRequestException('from and to must be YYYY-MM-DD');
        }
        const span = daysBetween(params.from, params.to);
        if (span < 0)
            throw new BadRequestException('from must not be after to');
        if (span + 1 > MAX_RANGE_DAYS) {
            throw new BadRequestException(
                `Range is limited to ${MAX_RANGE_DAYS} days`,
            );
        }
        this.assertBranch(user, params.branch_id);

        // Anyone whose assignment overlaps the range, so a leaver still shows on
        // the days they actually worked.
        const rows = await this.assignments
            .createQueryBuilder('a')
            .innerJoin('a.employee', 'emp')
            .leftJoin('a.designation', 'des')
            .leftJoin('a.brand', 'brand')
            .select([
                'DISTINCT emp.id AS employee_id',
                'emp.full_name AS full_name',
                'emp.employee_code AS employee_code',
                'emp.status AS status',
                'des.name AS designation_name',
                'brand.name AS brand_name',
                'emp.default_schedule_template_id AS default_template_id',
            ])
            .where('a.branchId = :branchId', { branchId: params.branch_id })
            .andWhere('a.effectiveFrom <= :to', { to: params.to })
            .andWhere('(a.effectiveTo IS NULL OR a.effectiveTo >= :from)', {
                from: params.from,
            })
            .orderBy('emp.full_name', 'ASC')
            .getRawMany<{
                employee_id: number;
                full_name: string;
                employee_code: string;
                status: string;
                designation_name: string | null;
                brand_name: string | null;
                default_template_id: number | null;
            }>();

        const employeeIds = rows.map((r) => Number(r.employee_id));
        const cells = employeeIds.length
            ? await this.schedules
                  .createQueryBuilder('s')
                  .where('s.employeeId IN (:...employeeIds)', { employeeIds })
                  .andWhere('s.workDate BETWEEN :from AND :to', {
                      from: params.from,
                      to: params.to,
                  })
                  .getMany()
            : [];

        return {
            range: { from: params.from, to: params.to },
            employees: rows.map((r) => ({
                id: Number(r.employee_id),
                full_name: r.full_name,
                employee_code: r.employee_code,
                status: r.status,
                designation_name: r.designation_name,
                brand_name: r.brand_name,
                default_template_id:
                    r.default_template_id != null
                        ? Number(r.default_template_id)
                        : null,
            })),
            cells: cells.map((c) => ({
                id: c.id,
                employee_id: c.employeeId,
                work_date: c.workDate,
                template_id: c.templateId,
                is_weekly_off: c.isWeeklyOff,
                is_holiday: c.isHoliday,
                is_published: c.isPublished,
            })),
        };
    }

    /**
     * Set (or clear) roster cells.
     *
     * A cell with no template and neither flag is a DELETE: nothing to say means
     * fall back to the employee's default, and storing an empty row would shadow
     * it instead.
     */
    async setCells(user: HrUser, branchId: number, cells: RosterCell[]) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        if (!cells.length) return { written: 0, cleared: 0 };
        if (cells.length > 500) {
            throw new BadRequestException('Too many cells in one request');
        }
        this.assertBranch(user, branchId);

        // Validate templates once rather than per cell.
        const templateIds = [
            ...new Set(
                cells
                    .map((c) => c.template_id)
                    .filter((id): id is number => id != null),
            ),
        ];
        if (templateIds.length) {
            const found = await this.templates.find({
                where: { id: In(templateIds), tenantId: user.tenantId },
            });
            if (found.length !== templateIds.length) {
                throw new NotFoundException('Unknown schedule template');
            }
        }

        let written = 0;
        let cleared = 0;
        const touched: Array<{ employeeId: number; workDate: string }> = [];

        for (const cell of cells) {
            if (!isDate(cell.work_date)) {
                throw new BadRequestException(
                    `Bad work date: ${cell.work_date}`,
                );
            }
            const existing = await this.schedules.findOne({
                where: {
                    employeeId: cell.employee_id,
                    workDate: cell.work_date,
                },
            });
            const empty =
                (cell.template_id ?? null) == null &&
                !cell.is_weekly_off &&
                !cell.is_holiday;

            if (empty) {
                if (existing) {
                    await this.schedules.delete({ id: existing.id });
                    cleared += 1;
                    touched.push({
                        employeeId: cell.employee_id,
                        workDate: cell.work_date,
                    });
                }
                continue;
            }

            // A day cannot be both an off and a holiday; holiday wins, since it
            // is the branch-wide fact and the off is the individual one.
            const isHoliday = cell.is_holiday === true;
            const isWeeklyOff = !isHoliday && cell.is_weekly_off === true;

            if (existing) {
                await this.schedules.update(
                    { id: existing.id },
                    {
                        templateId: cell.template_id ?? null,
                        isWeeklyOff,
                        isHoliday,
                        isPublished: true,
                        branchId,
                    },
                );
            } else {
                await this.schedules.save(
                    this.schedules.create({
                        tenantId: user.tenantId,
                        employeeId: cell.employee_id,
                        branchId,
                        workDate: cell.work_date,
                        templateId: cell.template_id ?? null,
                        isWeeklyOff,
                        isHoliday,
                        isPublished: true,
                        createdBy: user.id,
                    }),
                );
            }
            written += 1;
            touched.push({
                employeeId: cell.employee_id,
                workDate: cell.work_date,
            });
        }

        await this.audit.record({
            tenantId: user.tenantId,
            actorUserId: user.id,
            action: 'roster.updated',
            entityTable: 'employee_schedules',
            entityId: branchId,
            after: { written, cleared, branch_id: branchId },
        });

        // The register must agree with the roster straight away. A locked day
        // refuses and logs rather than throwing, so one closed period cannot
        // fail the whole save.
        for (const t of touched) {
            await this.recompute.recomputeDay(t.employeeId, t.workDate);
        }

        return { written, cleared };
    }

    private assertBranch(user: HrUser, branchId: number) {
        if (
            user.allowedBranchIds != null &&
            !user.allowedBranchIds.includes(branchId)
        ) {
            throw new ForbiddenException('That branch is out of your scope');
        }
    }
}
