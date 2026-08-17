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
import { LeaveType } from '../entities/leave-type.entity';
import { LeaveBalance } from '../entities/leave-balance.entity';
import { LeaveRequest } from '../entities/leave-request.entity';
import { PublicHoliday } from '../entities/public-holiday.entity';
import { HolidayPolicy } from '../entities/holiday-policy.entity';
import { LeavesController, LeaveSettingsController } from './leaves.controller';
import { LeavesService } from './leaves.service';
import { EmployeeSalaryStructure } from '../entities/employee-salary-structure.entity';
import { EmployeeSalaryComponent } from '../entities/employee-salary-component.entity';
import { OvertimePolicy } from '../entities/overtime-policy.entity';
import { EmployeeLoanAdvance } from '../entities/employee-loan-advance.entity';
import { PayrollRun } from '../entities/payroll-run.entity';
import { PayrollLine } from '../entities/payroll-line.entity';
import { PayrollLineItem } from '../entities/payroll-line-item.entity';
import { PayrollAdjustment } from '../entities/payroll-adjustment.entity';
import {
    AdvancesController,
    PayrollController,
    SalaryController,
} from './payroll.controller';
import { PayrollService } from './payroll.service';
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
            LeaveType,
            LeaveBalance,
            LeaveRequest,
            PublicHoliday,
            HolidayPolicy,
            EmployeeSalaryStructure,
            EmployeeSalaryComponent,
            OvertimePolicy,
            EmployeeLoanAdvance,
            PayrollRun,
            PayrollLine,
            PayrollLineItem,
            PayrollAdjustment,
        ]),
    ],
    controllers: [
        EmployeesController,
        EmployeeExitsController,
        DesignationsController,
        HrAuditController,
        AttendanceController,
        AttendancePinController,
        LeavesController,
        LeaveSettingsController,
        PayrollController,
        SalaryController,
        AdvancesController,
    ],
    providers: [
        EmployeesService,
        DesignationsService,
        EmployeeExitsService,
        HrAuditService,
        AttendanceService,
        AttendanceRecomputeService,
        LeavesService,
        PayrollService,
    ],
    exports: [EmployeesService, HrAuditService, AttendanceService],
})
export class HrModule {}
