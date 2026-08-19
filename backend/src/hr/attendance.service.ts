import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Employee } from '../entities/employee.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { AttendancePunch } from '../entities/attendance-punch.entity';
import { AttendanceDay } from '../entities/attendance-day.entity';
import { AttendanceException } from '../entities/attendance-exception.entity';
import { AttendanceCapturePolicy } from '../entities/attendance-capture-policy.entity';
import { AttendanceStation } from '../entities/attendance-station.entity';
import { Permissions } from '../roles/permissions.dto';
import { AttendanceRecomputeService } from './attendance-recompute.service';
import { HrAuditService } from './hr-audit.service';
import { HrSettingsService } from './hr-settings.service';
import { MediaStorageService } from '../media/media-storage.service';
import { hasPermission, HrUser } from './employee-scope';
import { PunchDto, ManagerAttestDto, SetPinDto } from './dto/attendance.dto';
import { canPunch, pairSessions } from './attendance-rules';

const PIN_LOCK_MINUTES = 15;
const PIN_MAX_ATTEMPTS = 5;

@Injectable()
export class AttendanceService {
    private readonly logger = new Logger(AttendanceService.name);

    constructor(
        @InjectRepository(Employee)
        private readonly employees: Repository<Employee>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        @InjectRepository(AttendancePunch)
        private readonly punches: Repository<AttendancePunch>,
        @InjectRepository(AttendanceDay)
        private readonly days: Repository<AttendanceDay>,
        @InjectRepository(AttendanceException)
        private readonly exceptions: Repository<AttendanceException>,
        @InjectRepository(AttendanceCapturePolicy)
        private readonly policies: Repository<AttendanceCapturePolicy>,
        @InjectRepository(AttendanceStation)
        private readonly stations: Repository<AttendanceStation>,
        private readonly recompute: AttendanceRecomputeService,
        private readonly audit: HrAuditService,
        private readonly settings: HrSettingsService,
        private readonly mediaStorage: MediaStorageService,
    ) {}

    // ------------------------------------------------------------- policy

    /** Branch override wins over the tenant default. */
    async resolvePolicy(
        tenantId: number,
        branchId: number,
    ): Promise<AttendanceCapturePolicy> {
        const branchPolicy = await this.policies.findOne({
            where: { tenantId, branchId, isActive: true },
        });
        if (branchPolicy) return branchPolicy;
        const tenantPolicy = await this.policies.findOne({
            where: { tenantId, branchId: IsNull(), isActive: true },
        });
        if (tenantPolicy) return tenantPolicy;
        // Defaults in code so a missing row can never disable the controls.
        return this.policies.create({
            tenantId,
            branchId: null,
            primaryMethod: 'pin',
            requirePhoto: false,
            allowManagerAttestation: true,
            duplicateWindowSeconds: 60,
            photoRetentionDays: 90,
            isActive: true,
        });
    }

    // -------------------------------------------------------------- PIN

    async setPin(user: HrUser, employeeId: number, dto: SetPinDto) {
        const employee = await this.employees.findOne({
            where: { id: employeeId },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        if (user.tenantId != null && employee.tenantId !== user.tenantId) {
            throw new NotFoundException('Employee not found');
        }
        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new BadRequestException(
                'This employee has left — a PIN cannot be issued',
            );
        }
        if (!/^\d{4,8}$/.test(dto.pin)) {
            throw new BadRequestException('PIN must be 4–8 digits');
        }

        await this.employees.update(
            { id: employeeId },
            {
                pinHash: await bcrypt.hash(dto.pin, 10),
                pinSetAt: new Date(),
                pinFailedAttempts: 0,
                pinLockedUntil: null,
            },
        );

        // The PIN itself is never logged, only that it changed and by whom.
        await this.audit.record({
            tenantId: employee.tenantId,
            actorUserId: user.id,
            action: 'attendance.pin.set',
            entityTable: 'employees',
            entityId: employeeId,
            after: { pin_set: true },
        });
        return { updated: true };
    }

    /**
     * Issue or rotate a QR employee card.
     *
     * The token is random and opaque — never derived from the employee code or
     * id, or a lost card would let someone mint another. Reissuing replaces the
     * old token, which is how a lost card is revoked.
     */
    async issueQrToken(user: HrUser, employeeId: number) {
        const employee = await this.employees.findOne({
            where: { id: employeeId },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        if (user.tenantId != null && employee.tenantId !== user.tenantId) {
            throw new NotFoundException('Employee not found');
        }
        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new BadRequestException(
                'This employee has left — a card cannot be issued',
            );
        }

        const token = randomBytes(24).toString('base64url');
        await this.employees.update(
            { id: employeeId },
            { qrToken: token, qrTokenIssuedAt: new Date() },
        );

        await this.audit.record({
            tenantId: employee.tenantId,
            actorUserId: user.id,
            action: 'attendance.qr.issued',
            entityTable: 'employees',
            entityId: employeeId,
            after: { reissued: employee.qrToken != null },
        });

        // Returned once, for printing. It is not exposed by any read endpoint.
        return { qr_token: token, employee_code: employee.employeeCode };
    }

    /** Revoke a card without issuing a new one. */
    async revokeQrToken(user: HrUser, employeeId: number) {
        const employee = await this.employees.findOne({
            where: { id: employeeId },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        if (user.tenantId != null && employee.tenantId !== user.tenantId) {
            throw new NotFoundException('Employee not found');
        }
        await this.employees.update(
            { id: employeeId },
            { qrToken: null, qrTokenIssuedAt: null },
        );
        await this.audit.record({
            tenantId: employee.tenantId,
            actorUserId: user.id,
            action: 'attendance.qr.revoked',
            entityTable: 'employees',
            entityId: employeeId,
        });
        return { revoked: true };
    }

    // ------------------------------------------------------------- punch

    /**
     * The attendance station's one write.
     *
     * Identity is a PIN or a QR token — deterrence plus an audit trail, not
     * proof (docs/HRM.md §11). Everything that could be forged by the caller is
     * ignored: the timestamp is the server's, the branch comes from the
     * authenticated session, and `posUserId` records whichever till was on
     * screen so a cashier punching in the whole team is visible.
     */
    async punch(user: HrUser, dto: PunchDto) {
        const tenantId = user.tenantId;
        if (tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant to record attendance',
            );
        }

        const policy = await this.resolvePolicy(tenantId, dto.branch_id);
        const employee = await this.findByCredential(tenantId, dto);
        await this.assertWorksAtBranch(employee.id, dto.branch_id);

        if (policy.requirePhoto && dto.punch_type === 'in' && !dto.photo_url) {
            throw new BadRequestException(
                'A photo is required to clock in at this branch',
            );
        }

        const now = new Date();

        // Duplicate suppression: a double tap must not become two punches, and
        // must not read as an error either.
        const recent = await this.punches.findOne({
            where: { employeeId: employee.id, punchType: dto.punch_type },
            order: { punchedAt: 'DESC' },
        });
        if (
            recent &&
            now.getTime() - recent.punchedAt.getTime() <
                policy.duplicateWindowSeconds * 1000
        ) {
            return {
                duplicate: true,
                punch_id: recent.id,
                employee: { id: employee.id, full_name: employee.fullName },
                punch_type: recent.punchType,
                punched_at: recent.punchedAt,
            };
        }

        const { workDate } = await this.recompute.resolveWorkDate(
            employee,
            dto.branch_id,
            now,
        );
        await this.assertPunchAllowed(employee.id, dto.punch_type, workDate);

        const punch = await this.punches.save(
            this.punches.create({
                tenantId,
                employeeId: employee.id,
                branchId: dto.branch_id,
                punchType: dto.punch_type,
                punchedAt: now,
                source: 'pos',
                method: dto.qr_token ? 'qr_card' : 'pin',
                posUserId: user.id,
                photoUrl: dto.photo_url ?? null,
                workDate,
            }),
        );

        if (workDate) await this.recompute.recomputeDay(employee.id, workDate);

        return {
            duplicate: false,
            punch_id: punch.id,
            employee: {
                id: employee.id,
                full_name: employee.fullName,
                employee_code: employee.employeeCode,
                photo_url: employee.photoUrl,
            },
            punch_type: punch.punchType,
            punched_at: punch.punchedAt,
            work_date: workDate,
            /** Null work date = orphan: recorded, but no shift claimed it. */
            orphan: workDate == null,
        };
    }

    /**
     * A punch from a registered device with NOBODY logged in.
     *
     * Identity still comes from the employee's own code + PIN or QR card — the
     * device token only says "this is the Pine Avenue staff-entrance tablet". It
     * grants nothing else, so leaving it on a shared screen exposes no data.
     *
     * Records `stationId` in place of `posUserId`, which is what burst detection
     * groups by for station punches.
     */
    async stationPunch(
        station: { id: number; tenantId: number; branchId: number },
        dto: Omit<PunchDto, 'branch_id'>,
    ) {
        const policy = await this.resolvePolicy(
            station.tenantId,
            station.branchId,
        );
        const employee = await this.findByCredential(station.tenantId, {
            ...dto,
            branch_id: station.branchId,
        });
        await this.assertWorksAtBranch(employee.id, station.branchId);

        if (policy.requirePhoto && dto.punch_type === 'in' && !dto.photo_url) {
            throw new BadRequestException(
                'A photo is required to clock in at this branch',
            );
        }

        const now = new Date();
        const recent = await this.punches.findOne({
            where: { employeeId: employee.id, punchType: dto.punch_type },
            order: { punchedAt: 'DESC' },
        });
        if (
            recent &&
            now.getTime() - recent.punchedAt.getTime() <
                policy.duplicateWindowSeconds * 1000
        ) {
            return {
                duplicate: true,
                punch_id: recent.id,
                employee: { id: employee.id, full_name: employee.fullName },
                punch_type: recent.punchType,
                punched_at: recent.punchedAt,
            };
        }

        const { workDate } = await this.recompute.resolveWorkDate(
            employee,
            station.branchId,
            now,
        );
        await this.assertPunchAllowed(employee.id, dto.punch_type, workDate);

        const punch = await this.punches.save(
            this.punches.create({
                tenantId: station.tenantId,
                employeeId: employee.id,
                branchId: station.branchId,
                punchType: dto.punch_type,
                punchedAt: now,
                source: 'pos',
                method: dto.qr_token ? 'qr_card' : 'pin',
                posUserId: null,
                stationId: station.id,
                photoUrl: dto.photo_url ?? null,
                workDate,
            }),
        );

        await this.stations.update({ id: station.id }, { lastSeenAt: now });

        if (workDate) await this.recompute.recomputeDay(employee.id, workDate);

        return {
            duplicate: false,
            punch_id: punch.id,
            employee: {
                id: employee.id,
                full_name: employee.fullName,
                employee_code: employee.employeeCode,
                photo_url: employee.photoUrl,
            },
            punch_type: punch.punchType,
            punched_at: punch.punchedAt,
            work_date: workDate,
            orphan: workDate == null,
        };
    }

    /** What a station needs to render itself: branch name and capture policy. */
    async stationContext(station: {
        id: number;
        tenantId: number;
        branchId: number;
        label: string;
    }) {
        const policy = await this.resolvePolicy(
            station.tenantId,
            station.branchId,
        );
        const branch = await this.stations.findOne({
            where: { id: station.id },
            relations: ['branch'],
        });
        return {
            station: { id: station.id, label: station.label },
            branch: {
                id: station.branchId,
                name: branch?.branch?.name ?? null,
            },
            policy: {
                primary_method: policy.primaryMethod,
                require_photo: policy.requirePhoto,
            },
        };
    }

    // ------------------------------------------------------- station admin

    async listStations(user: HrUser) {
        const qb = this.stations
            .createQueryBuilder('s')
            .leftJoin('s.branch', 'br')
            .select([
                's.id',
                's.label',
                's.token',
                's.isActive',
                's.lastSeenAt',
                's.branchId',
                'br.name',
            ])
            .orderBy('s.id', 'DESC');
        if (user.tenantId != null) {
            qb.where('s.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0) return [];
            qb.andWhere('s.branchId IN (:...branchIds)', {
                branchIds: user.allowedBranchIds,
            });
        }
        return qb.getMany();
    }

    async createStation(
        user: HrUser,
        dto: { branch_id: number; label: string },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        if (
            user.allowedBranchIds != null &&
            !user.allowedBranchIds.includes(dto.branch_id)
        ) {
            throw new ForbiddenException('You cannot register a device there');
        }
        const saved = await this.stations.save(
            this.stations.create({
                tenantId: user.tenantId,
                branchId: dto.branch_id,
                label: dto.label.trim(),
                token: randomBytes(24).toString('base64url'),
                isActive: true,
                createdBy: user.id,
            }),
        );
        await this.audit.record({
            tenantId: user.tenantId,
            actorUserId: user.id,
            action: 'attendance.station.created',
            entityTable: 'attendance_stations',
            entityId: saved.id,
            after: { branch_id: dto.branch_id, label: saved.label },
        });
        return { id: saved.id, token: saved.token };
    }

    /** Revoke a device. Its stored token stops working immediately. */
    async revokeStation(user: HrUser, id: number) {
        const station = await this.stations.findOne({ where: { id } });
        if (!station) throw new NotFoundException('Station not found');
        if (user.tenantId != null && station.tenantId !== user.tenantId) {
            throw new NotFoundException('Station not found');
        }
        await this.stations.update({ id }, { isActive: false });
        await this.audit.record({
            tenantId: station.tenantId,
            actorUserId: user.id,
            action: 'attendance.station.revoked',
            entityTable: 'attendance_stations',
            entityId: id,
        });
        return { revoked: true };
    }

    /**
     * Roll call: a supervisor records attendance for someone else.
     *
     * Always tagged `manager_attestation` and always surfaced in the exceptions
     * report — it must never be silently equivalent to a self-punch.
     */
    async managerAttest(user: HrUser, dto: ManagerAttestDto) {
        const tenantId = user.tenantId;
        if (tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        const policy = await this.resolvePolicy(tenantId, dto.branch_id);
        if (!policy.allowManagerAttestation) {
            throw new ForbiddenException(
                'Manager attestation is disabled for this branch',
            );
        }

        const employee = await this.employees.findOne({
            where: { id: dto.employee_id, tenantId },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        await this.assertWorksAtBranch(employee.id, dto.branch_id);

        const now = new Date();
        const { workDate } = await this.recompute.resolveWorkDate(
            employee,
            dto.branch_id,
            now,
        );
        await this.assertPunchAllowed(employee.id, dto.punch_type, workDate);

        const punch = await this.punches.save(
            this.punches.create({
                tenantId,
                employeeId: employee.id,
                branchId: dto.branch_id,
                punchType: dto.punch_type,
                punchedAt: now,
                source: 'manager_attestation',
                method: 'manager',
                posUserId: user.id,
                createdBy: user.id,
                isManual: true,
                note: dto.note ?? null,
                workDate,
            }),
        );

        if (workDate) await this.recompute.recomputeDay(employee.id, workDate);

        await this.audit.record({
            tenantId,
            actorUserId: user.id,
            action: 'attendance.attest',
            entityTable: 'attendance_punches',
            entityId: punch.id,
            after: {
                employee_id: employee.id,
                punch_type: dto.punch_type,
                work_date: workDate,
            },
        });

        return { punch_id: punch.id, work_date: workDate };
    }

    /**
     * Refuse a punch that contradicts the last one — clocking in while already
     * in, or out while already out. Several in/out PAIRS a day are expected
     * (breaks, split shifts); repeating the SAME direction is always a mistake.
     */
    private async assertPunchAllowed(
        employeeId: number,
        punchType: string,
        workDate: string | null,
    ): Promise<void> {
        const qb = this.punches
            .createQueryBuilder('p')
            .where('p.employeeId = :employeeId', { employeeId })
            .andWhere("p.punchType IN ('in', 'out')")
            .orderBy('p.punchedAt', 'DESC')
            .limit(1);
        // Scoped to the work date so yesterday's forgotten clock-out does not
        // block today's clock-in.
        if (workDate) qb.andWhere('p.workDate = :workDate', { workDate });
        const last = await qb.getOne();

        const verdict = canPunch(punchType, last?.punchType ?? null);
        if (!verdict.allowed) {
            throw new BadRequestException(verdict.reason);
        }
    }

    /**
     * Admin correction of the recorded times.
     *
     * Punches stay immutable — this writes an already-APPROVED `adjustment`
     * exception and recomputes, so the day shows the corrected figures while the
     * original punches and who changed them both remain readable. Editing the
     * punch rows directly would destroy the only evidence of what the machine
     * actually saw.
     *
     * Requires attendance:approve, not merely :adjust — this IS the approval.
     */
    async correctDayTimes(
        user: HrUser,
        dayId: number,
        dto: { first_in_at?: string; last_out_at?: string; reason: string },
    ) {
        if (!hasPermission(user, Permissions.ATTENDANCE_APPROVE)) {
            throw new ForbiddenException(
                'Correcting recorded times requires attendance:approve',
            );
        }
        if (!dto.reason?.trim()) {
            throw new BadRequestException('A reason is required');
        }
        if (!dto.first_in_at && !dto.last_out_at) {
            throw new BadRequestException('Nothing to change');
        }

        const day = await this.loadDayScoped(user, dayId);
        if (day.isLocked) {
            throw new BadRequestException(
                'Payroll is approved for this period — reverse the run first',
            );
        }

        const firstIn = dto.first_in_at ? new Date(dto.first_in_at) : null;
        const lastOut = dto.last_out_at ? new Date(dto.last_out_at) : null;
        if (firstIn && Number.isNaN(firstIn.getTime())) {
            throw new BadRequestException('Invalid clock-in time');
        }
        if (lastOut && Number.isNaN(lastOut.getTime())) {
            throw new BadRequestException('Invalid clock-out time');
        }
        const effectiveIn = firstIn ?? day.firstInAt;
        const effectiveOut = lastOut ?? day.lastOutAt;
        if (effectiveIn && effectiveOut && effectiveOut < effectiveIn) {
            throw new BadRequestException(
                'The clock-out time cannot be before the clock-in time',
            );
        }

        const newValue: Record<string, unknown> = {};
        if (firstIn) newValue.first_in_at = firstIn.toISOString();
        if (lastOut) newValue.last_out_at = lastOut.toISOString();

        const record = await this.exceptions.save(
            this.exceptions.create({
                tenantId: day.tenantId,
                attendanceDayId: day.id,
                kind: 'adjustment',
                subject: 'wrong_time',
                oldValue: {
                    first_in_at: day.firstInAt,
                    last_out_at: day.lastOutAt,
                    worked_minutes: day.workedMinutes,
                    status: day.status,
                },
                newValue,
                reason: dto.reason.trim(),
                requestedBy: user.id,
                // Applied immediately: the person doing it holds the approval
                // right, so a separate approval step would be theatre.
                approvedBy: user.id,
                approvedAt: new Date(),
                status: 'approved',
            }),
        );

        const updated = await this.recompute.recomputeDay(
            day.employeeId,
            day.workDate,
        );

        await this.audit.record({
            tenantId: day.tenantId,
            actorUserId: user.id,
            action: 'attendance.times.corrected',
            entityTable: 'attendance_days',
            entityId: day.id,
            before: {
                first_in_at: day.firstInAt,
                last_out_at: day.lastOutAt,
                worked_minutes: day.workedMinutes,
            },
            after: { ...newValue, reason: dto.reason.trim() },
        });

        return {
            exception_id: record.id,
            worked_minutes: updated?.workedMinutes ?? day.workedMinutes,
            status: updated?.status ?? day.status,
        };
    }

    /** Every punch of a day, so an admin can see the full in/out history. */
    async dayPunches(user: HrUser, dayId: number) {
        const day = await this.loadDayScoped(user, dayId);
        const punches = await this.punches.find({
            where: { employeeId: day.employeeId, workDate: day.workDate },
            relations: ['posUser'],
            order: { punchedAt: 'ASC' },
        });
        const paired = pairSessions(punches);
        return {
            work_date: day.workDate,
            worked_minutes: day.workedMinutes,
            sessions: paired.sessions.map((s) => ({
                in_at: s.inAt,
                out_at: s.outAt,
                minutes: s.minutes,
            })),
            open_session: paired.openSession,
            punches: punches.map((p) => ({
                id: p.id,
                punch_type: p.punchType,
                punched_at: p.punchedAt,
                source: p.source,
                method: p.method,
                station_id: p.stationId,
                pos_user: p.posUser
                    ? { id: p.posUser.id, name: p.posUser.name }
                    : null,
                photo_url: p.photoUrl,
                note: p.note,
            })),
        };
    }

    // ------------------------------------------------------------ reads

    /** Daily register: one row per employee per day for a branch. */
    async register(
        user: HrUser,
        params: { branch_id?: number; date_from: string; date_to: string },
    ) {
        const qb = this.days
            .createQueryBuilder('d')
            .leftJoin('d.employee', 'emp')
            .leftJoin('d.branch', 'br')
            .select([
                'd.id',
                'd.workDate',
                'd.status',
                'd.firstInAt',
                'd.lastOutAt',
                'd.workedMinutes',
                'd.lateMinutes',
                'd.earlyLeaveMinutes',
                'd.overtimeMinutesPending',
                'd.overtimeMinutesApproved',
                'd.exceptionFlags',
                'd.isLocked',
                'emp.id',
                'emp.fullName',
                'emp.employeeCode',
                'br.name',
            ])
            .where('d.workDate BETWEEN :from AND :to', {
                from: params.date_from,
                to: params.date_to,
            })
            .orderBy('d.workDate', 'DESC')
            .addOrderBy('emp.fullName', 'ASC');

        if (user.tenantId != null) {
            qb.andWhere('d.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0) return [];
            qb.andWhere('d.branchId IN (:...branchIds)', {
                branchIds: user.allowedBranchIds,
            });
        }
        if (params.branch_id) {
            qb.andWhere('d.branchId = :branchFilter', {
                branchFilter: params.branch_id,
            });
        }

        const rows = await qb.getMany();

        // Which of these days already have an overtime decision on record. A
        // rejected day matters as much as an approved one: both are answered,
        // and payroll must stop asking about either.
        const decided = await this.decidedOvertimeDayIds(rows.map((d) => d.id));

        return rows.map((d) => ({
            id: d.id,
            work_date: d.workDate,
            employee: {
                id: d.employee?.id,
                full_name: d.employee?.fullName,
                employee_code: d.employee?.employeeCode,
            },
            branch_name: d.branch?.name ?? null,
            status: d.status,
            first_in_at: d.firstInAt,
            last_out_at: d.lastOutAt,
            worked_minutes: d.workedMinutes,
            late_minutes: d.lateMinutes,
            early_leave_minutes: d.earlyLeaveMinutes,
            overtime_pending: d.overtimeMinutesPending,
            overtime_approved: d.overtimeMinutesApproved,
            /** Answered — approved or rejected — so nothing is still waiting. */
            overtime_decided: decided.has(d.id),
            flags: d.exceptionFlags,
            is_locked: d.isLocked,
        }));
    }

    /** Day ids carrying a decided (approved or rejected) overtime request. */
    async decidedOvertimeDayIds(dayIds: number[]): Promise<Set<number>> {
        if (dayIds.length === 0) return new Set();
        const rows = await this.exceptions
            .createQueryBuilder('e')
            .select('DISTINCT e.attendance_day_id AS day_id')
            .where('e.attendanceDayId IN (:...dayIds)', { dayIds })
            .andWhere("e.kind = 'overtime_approval'")
            .andWhere("e.status IN ('approved', 'rejected')")
            .getRawMany<{ day_id: number }>();
        return new Set(rows.map((r) => Number(r.day_id)));
    }

    /**
     * Approve or reject the overtime on one day, in a single step.
     *
     * Overtime accrues as PENDING and is never paid until a manager confirms it
     * (decision #11) — but the module shipped with no way to confirm, so every
     * payroll run blocked on overtime nobody could approve and the honest choice
     * was to force past it, silently underpaying whoever earned the hours.
     *
     * The decision is written as an attendance exception, already decided, so it
     * carries the same audit trail as one that was requested first.
     */
    async decideOvertime(
        user: HrUser,
        dayId: number,
        dto: { approve: boolean; minutes?: number; reason?: string },
    ) {
        if (!hasPermission(user, Permissions.OVERTIME_APPROVE)) {
            throw new ForbiddenException(
                `This decision requires ${Permissions.OVERTIME_APPROVE}`,
            );
        }
        const day = await this.loadDayScoped(user, dayId);
        if (day.isLocked) {
            throw new BadRequestException(
                'Payroll is approved for this period — reverse the run to change it',
            );
        }
        if (day.overtimeMinutesPending <= 0) {
            throw new BadRequestException('This day has no overtime to decide');
        }

        const minutes = Math.min(
            day.overtimeMinutesPending,
            dto.minutes ?? day.overtimeMinutesPending,
        );
        if (minutes < 0) {
            throw new BadRequestException('Minutes cannot be negative');
        }

        // A configured ceiling on how much one person may sign off, if the
        // tenant set one. No rules means no extra check.
        await this.settings.assertApproval(
            user,
            'overtime',
            {
                tenantId: day.tenantId,
                branchId: day.branchId,
                onDate: day.workDate,
            },
            { minutes },
        );

        await this.exceptions.save(
            this.exceptions.create({
                tenantId: day.tenantId,
                attendanceDayId: day.id,
                kind: 'overtime_approval',
                subject: 'overtime',
                oldValue: { pending_minutes: day.overtimeMinutesPending },
                newValue: { minutes: dto.approve ? minutes : 0 },
                minutesWaived: null,
                amountWaived: null,
                reason:
                    dto.reason?.trim() ||
                    (dto.approve ? 'Overtime approved' : 'Overtime rejected'),
                requestedBy: user.id,
                status: dto.approve ? 'approved' : 'rejected',
                approvedBy: user.id,
                approvedAt: new Date(),
            }),
        );

        await this.recompute.recomputeDay(day.employeeId, day.workDate);

        await this.audit.record({
            tenantId: day.tenantId,
            actorUserId: user.id,
            action: `attendance.overtime.${dto.approve ? 'approved' : 'rejected'}`,
            entityTable: 'attendance_days',
            entityId: day.id,
            before: { pending_minutes: day.overtimeMinutesPending },
            after: { approved_minutes: dto.approve ? minutes : 0 },
        });

        return {
            id: day.id,
            approved_minutes: dto.approve ? minutes : 0,
            status: dto.approve ? 'approved' : 'rejected',
        };
    }

    /**
     * Decide every outstanding day in one go.
     *
     * A month of overtime is dozens of rows, and a queue that can only be
     * cleared one click at a time is a queue that gets force-approved past.
     */
    async decideOvertimeBulk(
        user: HrUser,
        params: {
            date_from: string;
            date_to: string;
            branch_id?: number;
            approve: boolean;
            reason?: string;
        },
    ) {
        const rows = await this.register(user, {
            branch_id: params.branch_id,
            date_from: params.date_from,
            date_to: params.date_to,
        });

        const outstanding = rows.filter(
            (r) =>
                r.overtime_pending > 0 && !r.overtime_decided && !r.is_locked,
        );

        let decided = 0;
        const skipped: Array<{ day: number; reason: string }> = [];
        for (const row of outstanding) {
            try {
                await this.decideOvertime(user, row.id, {
                    approve: params.approve,
                    reason: params.reason,
                });
                decided += 1;
            } catch (e) {
                // One day above somebody's limit must not stop the rest.
                skipped.push({
                    day: row.id,
                    reason: e instanceof Error ? e.message : String(e),
                });
            }
        }
        return { decided, skipped };
    }

    /**
     * The exceptions report — everything that needs a human to look at it.
     *
     * Includes burst detection, which is what survives having no terminal
     * registry: many punches under one till session in a short window is one
     * person punching for everybody.
     */
    async exceptionsReport(
        user: HrUser,
        params: { date_from: string; date_to: string; branch_id?: number },
    ) {
        const register = await this.register(user, params);
        const flagged = register.filter(
            (r) => Object.keys(r.flags ?? {}).length > 0,
        );

        const qb = this.punches
            .createQueryBuilder('p')
            .select('p.posUserId', 'pos_user_id')
            .addSelect('p.stationId', 'station_id')
            .addSelect('p.branchId', 'branch_id')
            .addSelect("date_trunc('minute', p.punched_at)", 'minute')
            .addSelect('COUNT(*)', 'count')
            .where('p.workDate BETWEEN :from AND :to', {
                from: params.date_from,
                to: params.date_to,
            })
            .andWhere('(p.posUserId IS NOT NULL OR p.stationId IS NOT NULL)')
            .groupBy('p.posUserId')
            .addGroupBy('p.stationId')
            .addGroupBy('p.branchId')
            .addGroupBy("date_trunc('minute', p.punched_at)")
            .having('COUNT(*) >= :threshold', { threshold: 5 });

        if (user.tenantId != null) {
            qb.andWhere('p.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null && user.allowedBranchIds.length > 0) {
            qb.andWhere('p.branchId IN (:...branchIds)', {
                branchIds: user.allowedBranchIds,
            });
        }

        const bursts = await qb.getRawMany<{
            pos_user_id: number | null;
            station_id: number | null;
            branch_id: number;
            minute: string;
            count: string;
        }>();

        return {
            flagged_days: flagged,
            bursts: bursts.map((b) => ({
                pos_user_id: b.pos_user_id,
                station_id: b.station_id,
                branch_id: b.branch_id,
                minute: b.minute,
                punch_count: Number(b.count),
            })),
        };
    }

    // ------------------------------------------------- exceptions & waivers

    async requestException(
        user: HrUser,
        dayId: number,
        dto: {
            kind: 'adjustment' | 'waiver' | 'overtime_approval';
            subject: string;
            reason: string;
            new_value?: Record<string, unknown>;
            minutes_waived?: number;
        },
    ) {
        const day = await this.loadDayScoped(user, dayId);
        if (day.isLocked) {
            throw new BadRequestException(
                'Payroll is approved for this period — raise the correction against the next period instead',
            );
        }

        const record = await this.exceptions.save(
            this.exceptions.create({
                tenantId: day.tenantId,
                attendanceDayId: day.id,
                kind: dto.kind,
                subject: dto.subject,
                oldValue: {
                    status: day.status,
                    first_in_at: day.firstInAt,
                    last_out_at: day.lastOutAt,
                    late_minutes: day.lateMinutes,
                },
                newValue: dto.new_value ?? {},
                minutesWaived: dto.minutes_waived ?? null,
                reason: dto.reason,
                requestedBy: user.id,
                status: 'pending',
            }),
        );
        return { id: record.id, status: record.status };
    }

    /**
     * Approve or reject. A waiver deliberately does NOT change the attendance
     * figures — it is carried into payroll so the payslip shows the deduction
     * AND who forgave it. Only adjustments and OT approvals trigger a recompute.
     */
    async decideException(
        user: HrUser,
        exceptionId: number,
        decision: 'approved' | 'rejected',
    ) {
        const record = await this.exceptions.findOne({
            where: { id: exceptionId },
        });
        if (!record) throw new NotFoundException('Exception not found');
        const day = await this.loadDayScoped(user, record.attendanceDayId);

        const needed =
            record.kind === 'waiver'
                ? Permissions.ATTENDANCE_WAIVER_APPROVE
                : record.kind === 'overtime_approval'
                  ? Permissions.OVERTIME_APPROVE
                  : Permissions.ATTENDANCE_APPROVE;
        if (!hasPermission(user, needed)) {
            throw new ForbiddenException(`This decision requires ${needed}`);
        }
        if (record.status !== 'pending') {
            throw new BadRequestException(
                `This request was already ${record.status}`,
            );
        }

        // Configured thresholds sit ON TOP of the permission above: "a branch
        // manager may waive up to 2,000" is a row, not a code change. With no
        // rules configured this is a no-op.
        await this.settings.assertApproval(
            user,
            record.kind === 'overtime_approval'
                ? 'overtime'
                : 'attendance_waiver',
            {
                tenantId: day.tenantId,
                branchId: day.branchId,
                onDate: day.workDate,
            },
            {
                amount:
                    record.amountWaived != null
                        ? Number(record.amountWaived)
                        : 0,
                minutes: record.minutesWaived ?? 0,
            },
        );

        await this.exceptions.update(
            { id: exceptionId },
            {
                status: decision,
                approvedBy: user.id,
                approvedAt: new Date(),
            },
        );

        if (decision === 'approved' && record.kind !== 'waiver') {
            await this.recompute.recomputeDay(day.employeeId, day.workDate);
        }

        await this.audit.record({
            tenantId: day.tenantId,
            actorUserId: user.id,
            action: `attendance.${record.kind}.${decision}`,
            entityTable: 'attendance_exceptions',
            entityId: exceptionId,
            before: { status: 'pending' },
            after: {
                status: decision,
                subject: record.subject,
                reason: record.reason,
            },
        });

        return { id: exceptionId, status: decision };
    }

    async listExceptions(user: HrUser, status = 'pending') {
        const qb = this.exceptions
            .createQueryBuilder('e')
            .leftJoin('e.attendanceDay', 'd')
            .leftJoin('d.employee', 'emp')
            .leftJoin('e.requester', 'req')
            .select([
                'e.id',
                'e.kind',
                'e.subject',
                'e.reason',
                'e.minutesWaived',
                'e.status',
                'e.createdAt',
                'd.id',
                'd.workDate',
                'd.status',
                'emp.id',
                'emp.fullName',
                'req.id',
                'req.name',
            ])
            .where('e.status = :status', { status })
            .orderBy('e.createdAt', 'DESC');

        if (user.tenantId != null) {
            qb.andWhere('e.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0) return [];
            qb.andWhere('d.branchId IN (:...branchIds)', {
                branchIds: user.allowedBranchIds,
            });
        }
        return qb.getMany();
    }

    // ------------------------------------------------------------ helpers

    private async findByCredential(
        tenantId: number,
        dto: PunchDto,
    ): Promise<Employee> {
        if (dto.qr_token) {
            const byToken = await this.employees.findOne({
                where: { tenantId, qrToken: dto.qr_token },
            });
            if (!byToken)
                throw new UnauthorizedException('Card not recognised');
            this.assertEmployable(byToken);
            return byToken;
        }

        if (!dto.employee_code || !dto.pin) {
            throw new BadRequestException('Employee code and PIN are required');
        }
        const employee = await this.employees.findOne({
            where: { tenantId, employeeCode: dto.employee_code.trim() },
        });
        // Same message whether the code or the PIN is wrong, so the station
        // cannot be used to enumerate valid employee codes.
        if (!employee || !employee.pinHash) {
            throw new UnauthorizedException('Incorrect code or PIN');
        }
        if (employee.pinLockedUntil && employee.pinLockedUntil > new Date()) {
            throw new UnauthorizedException(
                'Too many failed attempts — ask a manager to reset your PIN',
            );
        }
        this.assertEmployable(employee);

        const ok = await bcrypt.compare(dto.pin, employee.pinHash);
        if (!ok) {
            const attempts = employee.pinFailedAttempts + 1;
            await this.employees.update(
                { id: employee.id },
                {
                    pinFailedAttempts: attempts,
                    pinLockedUntil:
                        attempts >= PIN_MAX_ATTEMPTS
                            ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000)
                            : null,
                },
            );
            throw new UnauthorizedException('Incorrect code or PIN');
        }

        if (employee.pinFailedAttempts > 0) {
            await this.employees.update(
                { id: employee.id },
                { pinFailedAttempts: 0, pinLockedUntil: null },
            );
        }
        return employee;
    }

    private assertEmployable(employee: Employee): void {
        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new UnauthorizedException('This employee has left');
        }
    }

    /** Someone must not clock in at a branch they are not assigned to. */
    private async assertWorksAtBranch(
        employeeId: number,
        branchId: number,
    ): Promise<void> {
        const current = await this.assignments.findOne({
            where: { employeeId, effectiveTo: IsNull() },
        });
        if (!current) {
            throw new BadRequestException(
                'This employee has no active assignment',
            );
        }
        if (current.branchId !== branchId) {
            throw new BadRequestException(
                'This employee is not assigned to this branch',
            );
        }
    }

    private async loadDayScoped(
        user: HrUser,
        dayId: number,
    ): Promise<AttendanceDay> {
        const day = await this.days.findOne({ where: { id: dayId } });
        if (!day) throw new NotFoundException('Attendance day not found');
        if (user.tenantId != null && day.tenantId !== user.tenantId) {
            throw new NotFoundException('Attendance day not found');
        }
        if (
            user.allowedBranchIds != null &&
            !user.allowedBranchIds.includes(day.branchId)
        ) {
            throw new NotFoundException('Attendance day not found');
        }
        return day;
    }

    /** Purge punch photos past the retention window (docs/HRM.md §11.2). */
    async purgeExpiredPhotos(): Promise<number> {
        const policies = await this.policies.find({
            where: { isActive: true },
        });
        let purged = 0;

        for (const policy of policies) {
            const cutoff = new Date(
                Date.now() - policy.photoRetentionDays * 86_400_000,
            );
            // Bounded per run so one night's job cannot stall on a huge backlog;
            // the next run picks up where this one stopped.
            const stale = await this.punches
                .createQueryBuilder('p')
                .where('p.tenantId = :tenantId', { tenantId: policy.tenantId })
                .andWhere('p.photoUrl IS NOT NULL')
                .andWhere('p.punchedAt < :cutoff', { cutoff })
                .select(['p.id', 'p.photoUrl'])
                .limit(500)
                .getMany();

            for (const punch of stale) {
                try {
                    await this.mediaStorage.deleteManagedObjectByUrl(
                        punch.photoUrl,
                        'attendance',
                    );
                } catch (err) {
                    this.logger.warn(
                        `Could not delete punch photo for punch ${punch.id}: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
                // Cleared even if the object delete failed: a file we cannot
                // reach is better unlinked than left referenced by a record
                // that claims to have been purged.
                await this.punches.update({ id: punch.id }, { photoUrl: null });
                purged += 1;
            }
        }

        if (purged > 0) {
            this.logger.log(`Purged ${purged} punch photo(s) past retention`);
        }
        return purged;
    }

    /** Convenience for the register's default range. */
    static defaultRange(): { date_from: string; date_to: string } {
        const today = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 6 * 86_400_000)
            .toISOString()
            .slice(0, 10);
        return { date_from: from, date_to: today };
    }

    async betweenDates(tenantId: number, from: string, to: string) {
        return this.days.find({
            where: { tenantId, workDate: Between(from, to) },
        });
    }
}
