import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Employee } from '../entities/employee.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { EmployeeDocument } from '../entities/employee-document.entity';
import { EmployeeEvent } from '../entities/employee-event.entity';
import { EmployeeWarning } from '../entities/employee-warning.entity';
import { EmployeeExit } from '../entities/employee-exit.entity';
import { EmployeeClearanceItem } from '../entities/employee-clearance-item.entity';
import { Designation } from '../entities/designation.entity';
import { HrAuditLog } from '../entities/hr-audit-log.entity';
import { Branch } from '../entities/branch.entity';
import { AttendancePunch } from '../entities/attendance-punch.entity';
import { AttendanceDay } from '../entities/attendance-day.entity';
import { AttendanceException } from '../entities/attendance-exception.entity';
import { AttendanceCapturePolicy } from '../entities/attendance-capture-policy.entity';
import { WorkScheduleTemplate } from '../entities/work-schedule-template.entity';
import { EmployeeSchedule } from '../entities/employee-schedule.entity';
import {
    AttendanceController,
    AttendancePinController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRecomputeService } from './attendance-recompute.service';
import {
    EmployeeExitsController,
    EmployeesController,
} from './employees.controller';
import {
    DesignationsController,
    HrAuditController,
} from './hr-settings.controller';
import { EmployeesService } from './employees.service';
import { DesignationsService } from './designations.service';
import { EmployeeExitsService } from './employee-exits.service';
import { HrAuditService } from './hr-audit.service';

/**
 * Employee HRM — Phase 1 (employee master, history spine, exits).
 *
 * Separate from RiderHrmModule, which is about dispatch and rider pay. Riders
 * appear in both: this module owns who they are, that one owns how they are
 * assigned orders. Their PAY converges here in Phase 4 (docs/HRM.md §12).
 */
@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([
            Employee,
            EmployeeAssignment,
            EmployeeDocument,
            EmployeeEvent,
            EmployeeWarning,
            EmployeeExit,
            EmployeeClearanceItem,
            Designation,
            HrAuditLog,
            Branch,
            AttendancePunch,
            AttendanceDay,
            AttendanceException,
            AttendanceCapturePolicy,
            WorkScheduleTemplate,
            EmployeeSchedule,
        ]),
    ],
    controllers: [
        EmployeesController,
        EmployeeExitsController,
        DesignationsController,
        HrAuditController,
        AttendanceController,
        AttendancePinController,
    ],
    providers: [
        EmployeesService,
        DesignationsService,
        EmployeeExitsService,
        HrAuditService,
        AttendanceService,
        AttendanceRecomputeService,
    ],
    exports: [EmployeesService, HrAuditService, AttendanceService],
})
export class HrModule {}
