import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AttendanceDay } from '../entities/attendance-day.entity';
import { AttendancePunch } from '../entities/attendance-punch.entity';
import { AttendanceException } from '../entities/attendance-exception.entity';
import { Employee } from '../entities/employee.entity';
import { EmployeeSchedule } from '../entities/employee-schedule.entity';
import { WorkScheduleTemplate } from '../entities/work-schedule-template.entity';
import { Branch } from '../entities/branch.entity';
import {
    attributePunch,
    branchLocalDate,
    buildOccurrence,
    computeStatus,
    lateMinutes,
    Occurrence,
    overtimeMinutes,
    pairSessions,
    ScheduleTemplate,
} from './attendance-rules';

const MINUTE = 60_000;

function toRule(t: WorkScheduleTemplate): ScheduleTemplate {
    return {
        startTime: String(t.startTime).slice(0, 5),
        endTime: String(t.endTime).slice(0, 5),
        crossesMidnight: t.crossesMidnight,
        breakMinutes: t.breakMinutes,
        graceMinutes: t.graceMinutes,
        halfDayAfterLateMinutes: t.halfDayAfterLateMinutes,
        minMinutesFullDay: t.minMinutesFullDay,
        minMinutesHalfDay: t.minMinutesHalfDay,
        overtimeAfterMinutes: t.overtimeAfterMinutes,
        attributionLeadHours: t.attributionLeadHours,
        attributionTrailHours: t.attributionTrailHours,
    };
}

/**
 * Turns raw punches into the derived `attendance_days` row payroll reads.
 *
 * Pure decision logic lives in attendance-rules.ts; this service only supplies
 * it with data and persists the result. Recompute is **idempotent** — running
 * it twice on the same inputs must produce the same row — and refuses to touch
 * a day locked by an approved payroll run.
 */
@Injectable()
export class AttendanceRecomputeService {
    private readonly logger = new Logger(AttendanceRecomputeService.name);

    constructor(
        @InjectRepository(AttendanceDay)
        private readonly days: Repository<AttendanceDay>,
        @InjectRepository(AttendancePunch)
        private readonly punches: Repository<AttendancePunch>,
        @InjectRepository(AttendanceException)
        private readonly exceptions: Repository<AttendanceException>,
        @InjectRepository(Employee)
        private readonly employees: Repository<Employee>,
        @InjectRepository(EmployeeSchedule)
        private readonly schedules: Repository<EmployeeSchedule>,
        @InjectRepository(WorkScheduleTemplate)
        private readonly templates: Repository<WorkScheduleTemplate>,
        @InjectRepository(Branch)
        private readonly branches: Repository<Branch>,
    ) {}

    /**
     * Branch timezone, with a loud warning rather than a silent assumption.
     *
     * `branches.timezone` defaults to 'UTC' at the column level, so a branch
     * created by seed or direct SQL can arrive on UTC. Computing attendance
     * five hours out is worse than refusing, but refusing would stop someone
     * clocking in — so we compute and flag.
     */
    async branchTimezone(
        branchId: number,
    ): Promise<{ tz: string; suspect: boolean }> {
        const branch = await this.branches.findOne({
            where: { id: branchId },
            select: { id: true, timezone: true },
        });
        const tz = branch?.timezone || 'UTC';
        if (tz === 'UTC') {
            this.logger.warn(
                `Branch ${branchId} has timezone 'UTC'. Attendance work-dates will be wrong ` +
                    `for a Pakistan branch — set it in Admin → Branches.`,
            );
            return { tz, suspect: true };
        }
        return { tz, suspect: false };
    }

    /** Roster row → employee default → branch default → tenant default. */
    async resolveTemplate(
        employee: Employee,
        branchId: number,
        workDate: string,
    ): Promise<WorkScheduleTemplate | null> {
        const rostered = await this.schedules.findOne({
            where: { employeeId: employee.id, workDate },
            relations: ['template'],
        });
        if (rostered?.template) return rostered.template;

        if (employee.defaultScheduleTemplateId) {
            const own = await this.templates.findOne({
                where: {
                    id: employee.defaultScheduleTemplateId,
                    isActive: true,
                },
            });
            if (own) return own;
        }

        const branchDefault = await this.templates.findOne({
            where: {
                tenantId: employee.tenantId,
                branchId,
                isActive: true,
                isDefault: true,
            },
        });
        if (branchDefault) return branchDefault;

        return this.templates.findOne({
            where: {
                tenantId: employee.tenantId,
                branchId: null as unknown as number,
                isActive: true,
                isDefault: true,
            },
            order: { id: 'ASC' },
        });
    }

    /**
     * Which work date does this instant belong to, for this employee?
     *
     * Considers the occurrences for yesterday, today and tomorrow (local), so a
     * punch after midnight can still land on the previous day's shift.
     */
    async resolveWorkDate(
        employee: Employee,
        branchId: number,
        instant: Date,
    ): Promise<{
        workDate: string | null;
        occurrence: Occurrence | null;
        tz: string;
    }> {
        const { tz } = await this.branchTimezone(branchId);
        const localToday = branchLocalDate(instant, tz);

        const candidateDates = [-1, 0, 1].map((offset) => {
            const d = new Date(`${localToday}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + offset);
            return d.toISOString().slice(0, 10);
        });

        const occurrences: Occurrence[] = [];
        let lead = 6;
        let trail = 6;
        for (const date of candidateDates) {
            const template = await this.resolveTemplate(
                employee,
                branchId,
                date,
            );
            if (!template) continue;
            lead = template.attributionLeadHours;
            trail = template.attributionTrailHours;
            occurrences.push(buildOccurrence(date, toRule(template), tz));
        }

        if (occurrences.length === 0) {
            // No schedule at all: fall back to the local date so the punch is
            // still recorded and visible, flagged as no_schedule downstream.
            return { workDate: localToday, occurrence: null, tz };
        }

        const matched = attributePunch(instant, occurrences, lead, trail);
        return {
            workDate: matched?.workDate ?? null,
            occurrence: matched,
            tz,
        };
    }

    /**
     * Rebuild one `(employee, workDate)` row from its punches.
     *
     * Steps follow docs/HRM.md §6. Returns null when the day is locked.
     */
    async recomputeDay(
        employeeId: number,
        workDate: string,
    ): Promise<AttendanceDay | null> {
        const employee = await this.employees.findOne({
            where: { id: employeeId },
        });
        if (!employee) return null;

        const existing = await this.days.findOne({
            where: { employeeId, workDate },
        });
        if (existing?.isLocked) {
            this.logger.warn(
                `Refusing to recompute locked attendance day ${existing.id} ` +
                    `(employee ${employeeId}, ${workDate}) — payroll is approved for that period.`,
            );
            return existing;
        }

        const dayPunches = await this.punches.find({
            where: { employeeId, workDate },
            order: { punchedAt: 'ASC' },
        });

        const branchId =
            dayPunches[0]?.branchId ??
            existing?.branchId ??
            employee.primaryBranchId;
        if (!branchId) return null;

        const { tz } = await this.branchTimezone(branchId);
        const template = await this.resolveTemplate(
            employee,
            branchId,
            workDate,
        );
        const occurrence = template
            ? buildOccurrence(workDate, toRule(template), tz)
            : null;

        const flags: Record<string, unknown> = {};
        if (!template) flags.no_schedule = true;

        // Sessions, not first-in-to-last-out: someone who clocks out for lunch
        // and back in has two, and spanning the gap would pay for the break.
        const paired = pairSessions(dayPunches);
        const firstIn = paired.firstInAt;
        const lastOut = paired.lastOutAt;
        if (paired.strayOut) flags.stray_out = true;
        if (paired.sessions.length > 1) {
            flags.sessions = paired.sessions.length;
        }

        // Paired break intervals; an unpaired break_start is ignored rather
        // than assumed to run to the end of the shift.
        let breakMinutes = 0;
        let openBreak: Date | null = null;
        for (const p of dayPunches) {
            if (p.punchType === 'break_start') openBreak = p.punchedAt;
            if (p.punchType === 'break_end' && openBreak) {
                breakMinutes += Math.max(
                    0,
                    Math.round(
                        (p.punchedAt.getTime() - openBreak.getTime()) / MINUTE,
                    ),
                );
                openBreak = null;
            }
        }
        if (openBreak) flags.unclosed_break = true;

        const workedMinutes = Math.max(0, paired.workedMinutes - breakMinutes);
        if (paired.openSession) {
            // Clocked in and never out: zero hours, flagged. Guessing an end
            // time would quietly manufacture pay.
            // An unclosed final session contributes nothing — guessing an end
            // time manufactures pay. Earlier CLOSED sessions still count, so a
            // split shift is not wiped out by forgetting the last clock-out.
            flags.missing_out = true;
            // Still on shift right now, as opposed to having forgotten. Without
            // this, everyone currently at work reads as ABSENT on the register
            // and payroll would deduct today from someone behind the counter.
            const shiftEnd = occurrence?.plannedEndUtc?.getTime();
            if (shiftEnd == null || Date.now() < shiftEnd) {
                flags.in_progress = true;
                delete flags.missing_out;
            }
        }

        if (dayPunches.some((p) => p.source === 'manager_attestation')) {
            flags.manager_attested = true;
        }
        if (dayPunches.some((p) => p.method === 'pin' && !p.photoUrl)) {
            flags.no_photo = true;
        }

        const late =
            firstIn && occurrence && template
                ? lateMinutes(
                      firstIn,
                      occurrence.plannedStartUtc,
                      template.graceMinutes,
                  )
                : 0;
        const earlyLeave =
            lastOut && occurrence
                ? Math.max(
                      0,
                      Math.round(
                          (occurrence.plannedEndUtc.getTime() -
                              lastOut.getTime()) /
                              MINUTE,
                      ),
                  )
                : 0;

        let status = 'absent';
        if (dayPunches.length > 0 && template && occurrence) {
            status = computeStatus({
                workedMinutes,
                lateMinutes: late,
                minMinutesFullDay: template.minMinutesFullDay,
                minMinutesHalfDay: template.minMinutesHalfDay,
                halfDayAfterLateMinutes: template.halfDayAfterLateMinutes,
            });
        } else if (dayPunches.length > 0) {
            // Punched with no schedule to judge against: present, flagged, and
            // left for a manager rather than scored as absent.
            status = 'present';
        }

        const pendingOt =
            occurrence && template && workedMinutes > 0
                ? overtimeMinutes(workedMinutes, occurrence.scheduledMinutes, {
                      minMinutesToQualify: template.overtimeAfterMinutes,
                      roundingMinutes: 15,
                      dailyCapMinutes: 240,
                  })
                : 0;

        const record = this.days.create({
            ...(existing ?? {}),
            tenantId: employee.tenantId,
            employeeId,
            branchId,
            workDate,
            scheduleTemplateId: template?.id ?? null,
            plannedStartAt: occurrence?.plannedStartUtc ?? null,
            plannedEndAt: occurrence?.plannedEndUtc ?? null,
            firstInAt: firstIn,
            lastOutAt: lastOut,
            workedMinutes,
            breakMinutes,
            lateMinutes: late,
            earlyLeaveMinutes: earlyLeave,
            overtimeMinutesPending: pendingOt,
            status,
            exceptionFlags: flags,
            computedAt: new Date(),
        });
        const saved = await this.days.save(record);

        // Approved adjustments override the machine's answer; approved OT moves
        // pending minutes into approved. Waivers deliberately change NOTHING
        // here — they are carried into payroll so the payslip shows both the
        // deduction and its forgiveness.
        await this.applyApprovedExceptions(saved);
        return this.days.findOne({ where: { id: saved.id } });
    }

    private async applyApprovedExceptions(day: AttendanceDay): Promise<void> {
        const approved = await this.exceptions.find({
            where: {
                attendanceDayId: day.id,
                status: 'approved',
                kind: In(['adjustment', 'overtime_approval']),
            },
            order: { approvedAt: 'ASC', id: 'ASC' },
        });
        if (approved.length === 0) return;

        // Explicit shape rather than Partial<AttendanceDay>: the entity's
        // relation and jsonb properties are not assignable to TypeORM's update
        // payload type.
        const patch: {
            status?: string;
            firstInAt?: Date;
            lastOutAt?: Date;
            workedMinutes?: number;
            overtimeMinutesApproved?: number;
            exceptionFlags?: Record<string, unknown>;
        } = {};
        for (const ex of approved) {
            if (ex.kind === 'overtime_approval') {
                patch.overtimeMinutesApproved = Math.min(
                    day.overtimeMinutesPending,
                    Number(ex.newValue?.minutes ?? day.overtimeMinutesPending),
                );
                continue;
            }
            // `newValue` is free-form jsonb, so every read is narrowed rather
            // than coerced — a stray object would otherwise stringify to
            // "[object Object]" and be written straight into the day.
            const asString = (v: unknown): string | null =>
                typeof v === 'string' && v.trim() !== '' ? v : null;
            const asDate = (v: unknown): Date | null => {
                const s = asString(v);
                if (!s) return null;
                const d = new Date(s);
                return Number.isNaN(d.getTime()) ? null : d;
            };

            if (ex.subject === 'status_override') {
                const status = asString(ex.newValue?.status);
                if (status) patch.status = status;
            }
            if (ex.subject === 'missed_punch' || ex.subject === 'wrong_time') {
                const firstIn = asDate(ex.newValue?.first_in_at);
                const lastOut = asDate(ex.newValue?.last_out_at);
                if (firstIn) patch.firstInAt = firstIn;
                if (lastOut) patch.lastOutAt = lastOut;
            }
        }

        if (patch.firstInAt || patch.lastOutAt) {
            const firstIn = patch.firstInAt ?? day.firstInAt;
            const lastOut = patch.lastOutAt ?? day.lastOutAt;
            if (firstIn && lastOut) {
                patch.workedMinutes = Math.max(
                    0,
                    Math.round(
                        (lastOut.getTime() - firstIn.getTime()) / MINUTE,
                    ) - day.breakMinutes,
                );
                const flags = { ...day.exceptionFlags };
                delete flags.missing_out;
                patch.exceptionFlags = { ...flags, adjusted: true };
            }
        }

        if (Object.keys(patch).length > 0) {
            // save() rather than update(): its DeepPartial accepts the jsonb
            // `exceptionFlags` that update()'s payload type rejects.
            await this.days.save({ id: day.id, ...patch });
        }
    }

    /** Recompute every day touched by a set of punches. */
    async recomputeForPunches(punches: AttendancePunch[]): Promise<void> {
        const pairs = new Set(
            punches
                .filter((p) => p.workDate)
                .map((p) => `${p.employeeId}|${p.workDate}`),
        );
        for (const pair of pairs) {
            const [employeeId, workDate] = pair.split('|');
            await this.recomputeDay(Number(employeeId), workDate);
        }
    }
}
