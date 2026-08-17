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
        ]),
    ],
    controllers: [
        EmployeesController,
        EmployeeExitsController,
        DesignationsController,
        HrAuditController,
    ],
    providers: [
        EmployeesService,
        DesignationsService,
        EmployeeExitsService,
        HrAuditService,
    ],
    exports: [EmployeesService, HrAuditService],
})
export class HrModule {}
