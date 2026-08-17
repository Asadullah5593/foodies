import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { DesignationsService } from './designations.service';
import { HrAuditService } from './hr-audit.service';
import { HrAlertsService } from './hr-alerts.service';
import { LabourCostService } from './labour-cost.service';
import { RosterService } from './roster.service';
import { DesignationDto, SaveRosterDto } from './dto/hr-support.dto';
import type { HrUser } from './employee-scope';

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/settings/designations')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class DesignationsController {
    constructor(private readonly designations: DesignationsService) {}

    /**
     * Readable with `employees:view`, not just `hr-settings:manage` — every
     * employee form needs the list to render its designation picker, and a
     * branch manager who can open a staff record must be able to see what the
     * title means.
     */
    @Get()
    @RequirePermission(Permissions.EMPLOYEES_VIEW)
    list(@CurrentUser() user: HrUser, @Query('include_inactive') inc?: string) {
        return this.designations.list(user, inc === '1' || inc === 'true');
    }

    @Post()
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    create(@CurrentUser() user: HrUser, @Body() dto: DesignationDto) {
        return this.designations.create(user, dto);
    }

    @Put(':id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    update(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: DesignationDto,
    ) {
        return this.designations.update(user, id, dto);
    }

    @Delete(':id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Delete a designation',
        description:
            'Deactivates instead of deleting when any assignment references it — past assignments must keep resolving or the employment history breaks.',
    })
    remove(@CurrentUser() user: HrUser, @Param('id', ParseIntPipe) id: number) {
        return this.designations.remove(user, id);
    }
}

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/roster')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RosterController {
    constructor(private readonly roster: RosterService) {}

    @Get('templates')
    @RequirePermission(Permissions.ATTENDANCE_VIEW)
    @ApiOperation({ summary: 'Shift templates available to a branch' })
    templates(
        @CurrentUser() user: HrUser,
        @Query('branch_id') branchId?: string,
    ) {
        return this.roster.listTemplates(
            user,
            branchId ? Number(branchId) : undefined,
        );
    }

    @Get()
    @RequirePermission(Permissions.ATTENDANCE_VIEW)
    @ApiOperation({
        summary: 'Roster grid for a branch and date range',
        description:
            'An empty cell is not "unrostered" — it means the employee’s default template applies, which is what the attendance engine uses today. Limited to 42 days.',
    })
    grid(
        @CurrentUser() user: HrUser,
        @Query('branch_id') branchId: string,
        @Query('from') from: string,
        @Query('to') to: string,
    ) {
        return this.roster.grid(user, {
            branch_id: Number(branchId),
            from,
            to,
        });
    }

    @Put()
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Set or clear roster cells',
        description:
            'A cell with no template and neither flag deletes the row, restoring the default. Each written date is recomputed, so the register agrees immediately; days inside an approved payroll period refuse and are logged.',
    })
    save(@CurrentUser() user: HrUser, @Body() dto: SaveRosterDto) {
        return this.roster.setCells(user, dto.branch_id, dto.cells);
    }
}

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/reports')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class HrReportsController {
    constructor(private readonly labourCost: LabourCostService) {}

    @Get('labour-cost')
    @RequirePermission(Permissions.PAYROLL_VIEW)
    @ApiOperation({
        summary: 'Labour cost as a percentage of sales',
        description:
            'Per branch and per brand. Counts WHOLE approved/paid payroll runs only — a run straddling the range is listed in excluded_partial_runs rather than pro-rated. Staff with no brand form their own row instead of being spread across brands.',
    })
    labour(
        @CurrentUser() user: HrUser,
        @Query('from') from: string,
        @Query('to') to: string,
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
    ) {
        return this.labourCost.report(user, {
            from,
            to,
            branch_id: branchId ? Number(branchId) : undefined,
            brand_id: brandId ? Number(brandId) : undefined,
        });
    }
}

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/alerts')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class HrAlertsController {
    constructor(private readonly alerts: HrAlertsService) {}

    @Get()
    @RequirePermission(Permissions.EMPLOYEES_VIEW)
    @ApiOperation({
        summary: 'What lapses soon',
        description:
            'Expiring employee documents and training certificates, probations ending unconfirmed, and overdue SCHEDULED reviews. The same rows drive the admin bell, so the screen and the notifications cannot disagree. Ad-hoc reviews are never counted as overdue cadence.',
    })
    list(@CurrentUser() user: HrUser) {
        return this.alerts.forUser(user);
    }
}

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/audit')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class HrAuditController {
    constructor(private readonly audit: HrAuditService) {}

    @Get()
    @RequirePermission(Permissions.HR_AUDIT_VIEW)
    @ApiOperation({
        summary: 'HR audit trail',
        description:
            'Append-only record of salary changes, exits, document handling and (from Phase 2) PIN resets and attendance overrides.',
    })
    list(
        @CurrentUser() user: HrUser,
        @Query('entity_table') entityTable?: string,
        @Query('entity_id') entityId?: string,
        @Query('limit') limit?: string,
    ) {
        return this.audit.list(user.tenantId, {
            entityTable,
            entityId: entityId ? Number(entityId) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }
}
