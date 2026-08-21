import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Employee } from '../entities/employee.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { EmployeeExit } from '../entities/employee-exit.entity';
import { EmployeeClearanceItem } from '../entities/employee-clearance-item.entity';
import { EmployeesService } from './employees.service';
import { HrAuditService } from './hr-audit.service';
import { HrUser } from './employee-scope';
import { exitStatusFor, rollUpClearanceStatus } from './hr-rules';
import { RecordExitDto, UpdateClearanceItemDto } from './dto/hr-support.dto';

/**
 * Default clearance checklist created with every exit, so nothing depends on a
 * manager remembering the list. `outstanding_advance` is the line that later
 * reconciles against payroll — it is the reason a final settlement is not
 * simply "last month's salary".
 */
const DEFAULT_CLEARANCE: Array<{
    itemType: string;
    description: string;
    responsibleRole: string;
}> = [
    {
        itemType: 'uniform',
        description: 'Uniform returned',
        responsibleRole: 'branch_manager',
    },
    {
        itemType: 'keys',
        description: 'Keys and access cards returned',
        responsibleRole: 'branch_manager',
    },
    {
        itemType: 'pos_access',
        description: 'POS login and attendance PIN revoked',
        responsibleRole: 'branch_manager',
    },
    {
        itemType: 'cash_handover',
        description: 'Cash float and till handed over',
        responsibleRole: 'branch_manager',
    },
    {
        itemType: 'equipment',
        description: 'Company equipment returned (phone, bike, tools)',
        responsibleRole: 'branch_manager',
    },
    {
        itemType: 'outstanding_advance',
        description: 'Outstanding salary advance settled',
        responsibleRole: 'hr_manager',
    },
];

@Injectable()
export class EmployeeExitsService {
    constructor(
        @InjectRepository(EmployeeExit)
        private readonly exits: Repository<EmployeeExit>,
        @InjectRepository(EmployeeClearanceItem)
        private readonly clearance: Repository<EmployeeClearanceItem>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        private readonly employeesService: EmployeesService,
        private readonly audit: HrAuditService,
        private readonly dataSource: DataSource,
    ) {}

    /**
     * Finish exits whose last working day has passed.
     *
     * Recording an exit dated in the future sets `notice_period`, deliberately,
     * so the person keeps working and being paid until they actually leave.
     * Nothing moved them on afterwards, though — they served notice forever,
     * and since only `resigned` and `terminated` count as gone they went on
     * showing up as current staff. Runs nightly; idempotent.
     */
    async settleDueNoticePeriods(): Promise<number> {
        const today = new Date().toISOString().slice(0, 10);
        const due = await this.dataSource.query<
            Array<{ employee_id: number; exit_type: string }>
        >(
            `SELECT e.id AS employee_id,
                    COALESCE(x.exit_type, 'resignation') AS exit_type
               FROM employees e
               LEFT JOIN LATERAL (
                    SELECT ex.exit_type FROM employee_exits ex
                     WHERE ex.employee_id = e.id
                     ORDER BY ex.id DESC LIMIT 1
                  ) x ON TRUE
              WHERE e.status = 'notice_period'
                AND e.date_of_leaving IS NOT NULL
                AND e.date_of_leaving < $1`,
            [today],
        );

        for (const row of due) {
            const status =
                row.exit_type === 'termination' ? 'terminated' : 'resigned';
            await this.dataSource.query(
                `UPDATE employees SET status = $1 WHERE id = $2`,
                [status, row.employee_id],
            );
            await this.dataSource.query(
                `INSERT INTO employee_events
                    (tenant_id, employee_id, event_type, event_date, title, description)
                 SELECT e.tenant_id, e.id, $1, CURRENT_DATE, $2,
                        'Last working day has passed'
                   FROM employees e WHERE e.id = $3`,
                [
                    status,
                    status === 'terminated' ? 'Terminated' : 'Resigned',
                    row.employee_id,
                ],
            );
        }
        return due.length;
    }

    /**
     * Record a resignation or termination.
     *
     * Phase 1 does the part that matters operationally: it closes the current
     * assignment on the last working day, flips the employee's status, and
     * stops anything further from accruing. The final SETTLEMENT amount needs
     * salary structures and off-encashment and arrives with payroll in Phase 4
     * — `settlementPayrollLineId` stays null until then (docs/HRM.md §16).
     */
    async record(user: HrUser, employeeId: number, dto: RecordExitDto) {
        const employee = await this.employeesService.loadScoped(
            user,
            employeeId,
        );
        const tenantId = employee.tenantId;

        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new BadRequestException(
                'This employee has already left. Reinstate them before recording another exit.',
            );
        }
        if (dto.last_working_date < employee.dateOfJoining) {
            throw new BadRequestException(
                `Last working date cannot precede the joining date (${employee.dateOfJoining})`,
            );
        }

        const open = await this.exits.findOne({
            where: { employeeId, settledAt: null as unknown as Date },
        });
        if (open) {
            throw new BadRequestException(
                'An exit is already in progress for this employee',
            );
        }

        return this.dataSource.transaction(async (manager) => {
            const exit = await manager.getRepository(EmployeeExit).save(
                manager.getRepository(EmployeeExit).create({
                    tenantId,
                    employeeId,
                    exitType: dto.exit_type,
                    initiatedBy: user.id,
                    initiatedOn: dto.initiated_on,
                    noticePeriodDays: dto.notice_period_days ?? 0,
                    lastWorkingDate: dto.last_working_date,
                    reason: dto.reason ?? null,
                    exitInterviewNotes: dto.exit_interview_notes ?? null,
                    rehireEligible: dto.rehire_eligible ?? true,
                    clearanceStatus: 'pending',
                }),
            );

            await manager.getRepository(EmployeeClearanceItem).insert(
                DEFAULT_CLEARANCE.map((c) => ({
                    exitId: exit.id,
                    itemType: c.itemType,
                    description: c.description,
                    responsibleRole: c.responsibleRole,
                    status: 'pending',
                })),
            );

            // Close the open assignment on the last working day. Employment
            // history must not show someone still holding a post they left.
            const current = await manager
                .getRepository(EmployeeAssignment)
                .findOne({
                    where: {
                        employeeId,
                        effectiveTo: null as unknown as string,
                    },
                });
            if (current) {
                // A last working date before the assignment even started would
                // violate the effective_to >= effective_from check constraint.
                const closeOn =
                    dto.last_working_date < current.effectiveFrom
                        ? current.effectiveFrom
                        : dto.last_working_date;
                await manager
                    .getRepository(EmployeeAssignment)
                    .update({ id: current.id }, { effectiveTo: closeOn });
            }

            // notice_period → the person is leaving but still works; the status
            // only becomes final on the last working day. Recording an exit
            // dated in the future must not stop today's attendance.
            const status = exitStatusFor(
                dto.exit_type,
                dto.last_working_date,
                new Date().toISOString().slice(0, 10),
            );

            await manager.getRepository(Employee).update(
                { id: employeeId },
                {
                    status,
                    dateOfLeaving: dto.last_working_date,
                    leavingReason: dto.reason ?? null,
                    rehireEligible: dto.rehire_eligible ?? true,
                    // Revoke attendance credentials immediately — a PIN that
                    // still works after someone leaves is the obvious hole.
                    pinHash: null,
                    qrToken: null,
                },
            );

            await this.employeesService.writeEvent(manager, {
                tenantId,
                employeeId,
                eventType:
                    dto.exit_type === 'termination' ? 'terminated' : 'resigned',
                eventDate: dto.last_working_date,
                title:
                    dto.exit_type === 'termination'
                        ? 'Employment terminated'
                        : 'Resigned',
                description: dto.reason ?? null,
                refTable: 'employee_exits',
                refId: exit.id,
                payload: {
                    exit_type: dto.exit_type,
                    notice_period_days: dto.notice_period_days ?? 0,
                    rehire_eligible: dto.rehire_eligible ?? true,
                },
                createdBy: user.id,
            });

            await this.audit.record(
                {
                    tenantId,
                    actorUserId: user.id,
                    action: 'employee.exit',
                    entityTable: 'employee_exits',
                    entityId: exit.id,
                    before: { status: employee.status },
                    after: {
                        status,
                        exit_type: dto.exit_type,
                        last_working_date: dto.last_working_date,
                    },
                },
                manager,
            );

            return { id: exit.id, status };
        });
    }

    async findForEmployee(user: HrUser, employeeId: number) {
        await this.employeesService.loadScoped(user, employeeId);
        const exit = await this.exits.findOne({
            where: { employeeId },
            relations: ['clearanceItems', 'initiator'],
            order: { id: 'DESC' },
        });
        if (!exit) return null;
        return this.serialize(exit);
    }

    async updateClearanceItem(
        user: HrUser,
        exitId: number,
        itemId: number,
        dto: UpdateClearanceItemDto,
    ) {
        const exit = await this.exits.findOne({ where: { id: exitId } });
        if (!exit) throw new NotFoundException('Exit record not found');
        await this.employeesService.loadScoped(user, exit.employeeId);

        const item = await this.clearance.findOne({
            where: { id: itemId, exitId },
        });
        if (!item) throw new NotFoundException('Clearance item not found');

        await this.clearance.update(
            { id: itemId },
            {
                status: dto.status,
                note: dto.note ?? item.note,
                clearedBy: dto.status === 'cleared' ? user.id : null,
                clearedAt: dto.status === 'cleared' ? new Date() : null,
            },
        );

        // Roll the exit's overall status up from its items, so the list screen
        // never disagrees with the checklist behind it.
        const items = await this.clearance.find({ where: { exitId } });
        const clearanceStatus = rollUpClearanceStatus(items);
        await this.exits.update({ id: exitId }, { clearanceStatus });

        await this.audit.record({
            tenantId: exit.tenantId,
            actorUserId: user.id,
            action: 'employee.clearance.update',
            entityTable: 'employee_clearance_items',
            entityId: itemId,
            before: { status: item.status },
            after: { status: dto.status, clearance_status: clearanceStatus },
        });

        return { id: itemId, clearance_status: clearanceStatus };
    }

    private serialize(exit: EmployeeExit) {
        return {
            id: exit.id,
            employee_id: exit.employeeId,
            exit_type: exit.exitType,
            initiated_on: exit.initiatedOn,
            last_working_date: exit.lastWorkingDate,
            notice_period_days: exit.noticePeriodDays,
            reason: exit.reason,
            exit_interview_notes: exit.exitInterviewNotes,
            rehire_eligible: exit.rehireEligible,
            clearance_status: exit.clearanceStatus,
            // Populated in Phase 4; surfaced now so the UI can show "settlement
            // pending" rather than pretending the exit is finished.
            settlement_payroll_line_id: exit.settlementPayrollLineId,
            settled_at: exit.settledAt,
            initiated_by: exit.initiator
                ? { id: exit.initiator.id, name: exit.initiator.name }
                : null,
            clearance_items: (exit.clearanceItems ?? [])
                .sort((a, b) => a.id - b.id)
                .map((i) => ({
                    id: i.id,
                    item_type: i.itemType,
                    description: i.description,
                    responsible_role: i.responsibleRole,
                    status: i.status,
                    note: i.note,
                    cleared_at: i.clearedAt,
                })),
        };
    }
}
