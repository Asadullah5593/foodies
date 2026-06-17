import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderProfile } from '../entities/rider-profile.entity';
import { RiderAttendanceSession } from '../entities/rider-attendance-session.entity';
import { RiderBreakSession } from '../entities/rider-break-session.entity';
import { RiderPresence } from '../entities/rider-presence.entity';
import { RiderCompPlan } from '../entities/rider-comp-plan.entity';
import { RiderCompPlanComponent } from '../entities/rider-comp-plan-component.entity';
import { RiderPayrollRun } from '../entities/rider-payroll-run.entity';
import { RiderPayrollLine } from '../entities/rider-payroll-line.entity';
import { RiderPayrollLineItem } from '../entities/rider-payroll-line-item.entity';
import { Branch } from '../entities/branch.entity';
import { RiderHrmService } from './rider-hrm.service';
import { RiderProfilesAdminController } from './rider-profiles.admin.controller';
import { RiderAttendanceAdminController } from './rider-attendance.admin.controller';
import { RiderPresenceAdminController } from './rider-presence.admin.controller';
import { RiderBreaksAdminController } from './rider-breaks.admin.controller';
import { RiderCompPlansAdminController } from './rider-comp-plans.admin.controller';
import { RiderPayrollAdminController } from './rider-payroll.admin.controller';
import { RiderAttendanceController } from './rider-attendance.controller';
import { RiderOpsMetricsService } from './rider-ops-metrics.service';
import { AdminRiderOpsController } from './admin-rider-ops.controller';
import { RiderSharingService } from './rider-sharing.service';
import {
    RiderSharingAdminController,
    RiderShareRequestsController,
} from './rider-sharing.admin.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            RiderProfile,
            RiderAttendanceSession,
            RiderBreakSession,
            RiderPresence,
            RiderCompPlan,
            RiderCompPlanComponent,
            RiderPayrollRun,
            RiderPayrollLine,
            RiderPayrollLineItem,
            Branch,
        ]),
    ],
    controllers: [
        RiderProfilesAdminController,
        RiderAttendanceAdminController,
        RiderPresenceAdminController,
        RiderBreaksAdminController,
        RiderCompPlansAdminController,
        RiderPayrollAdminController,
        RiderAttendanceController,
        AdminRiderOpsController,
        RiderSharingAdminController,
        RiderShareRequestsController,
    ],
    providers: [RiderHrmService, RiderOpsMetricsService, RiderSharingService],
    exports: [RiderHrmService, RiderOpsMetricsService, RiderSharingService],
})
export class RiderHrmModule {}
