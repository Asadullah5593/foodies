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
import { HrSettingsService } from './hr-settings.service';
import { LabourCostService } from './labour-cost.service';
import { RosterService } from './roster.service';
import { DesignationDto, SaveRosterDto } from './dto/hr-support.dto';
import {
    ApprovalRuleDto,
    CapturePolicyDto,
    DeductionRuleDto,
    HolidayPolicyDto,
    LeaveTypeDto,
    OvertimePolicyDto,
    ScheduleTemplateDto,
} from './dto/hr-settings.dto';
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

/**
 * HR → Settings.
 *
 * Reading the rules you work under is `hr-settings:view`; changing them is
 * `hr-settings:manage`. Every write lands in the HR audit log with a named
 * actor, because "who shortened the grace period" is exactly the question these
 * screens create.
 */
@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/settings')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class HrConfigController {
    constructor(private readonly settings: HrSettingsService) {}

    // ---------------------------------------------------- schedule templates

    @Get('schedule-templates')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    @ApiOperation({
        summary: 'Shift templates',
        description:
            'What attendance is judged against: start, end, grace, the half-day-after-late threshold, and the punch attribution window for shifts crossing midnight.',
    })
    listTemplates(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.settings.listTemplates(user, inc === '1' || inc === 'true');
    }

    @Post('schedule-templates')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Create or update a shift template',
        description:
            '`crossesMidnight` is DERIVED from the times, never taken from the request — a shift wrongly flagged as crossing midnight computes a 33-hour day and zeroes overtime.',
    })
    saveTemplate(
        @CurrentUser() user: HrUser,
        @Body() dto: ScheduleTemplateDto,
    ) {
        return this.settings.saveTemplate(user, dto);
    }

    @Delete('schedule-templates/:id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Deactivate a shift template',
        description:
            'Deactivated, never deleted: days already computed against it must stay explainable.',
    })
    deactivateTemplate(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.settings.deactivateTemplate(user, id);
    }

    // ------------------------------------------------------ capture policies

    @Get('capture-policies')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    @ApiOperation({
        summary: 'How attendance may be recorded',
        description:
            'PIN, QR, photo or manager attestation, per branch with a tenant default. A branch row wins over the tenant one.',
    })
    listCapturePolicies(@CurrentUser() user: HrUser) {
        return this.settings.listCapturePolicies(user);
    }

    @Post('capture-policies')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    saveCapturePolicy(
        @CurrentUser() user: HrUser,
        @Body() dto: CapturePolicyDto,
    ) {
        return this.settings.saveCapturePolicy(user, dto);
    }

    @Delete('capture-policies/:id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    deleteCapturePolicy(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.settings.deleteCapturePolicy(user, id);
    }

    // ----------------------------------------------------- overtime policies

    @Get('overtime-policies')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    listOvertimePolicies(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.settings.listOvertimePolicies(
            user,
            inc === '1' || inc === 'true',
        );
    }

    @Post('overtime-policies')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Create or update an overtime policy',
        description:
            'Branch-specific and role-specific, as the client asked. Overtime still accrues as pending and needs confirming before payroll locks.',
    })
    saveOvertimePolicy(
        @CurrentUser() user: HrUser,
        @Body() dto: OvertimePolicyDto,
    ) {
        return this.settings.saveOvertimePolicy(user, dto);
    }

    @Delete('overtime-policies/:id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    deactivateOvertimePolicy(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.settings.deactivateOvertimePolicy(user, id);
    }

    // --------------------------------------------------------- offs policies

    @Get('offs-policies')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    @ApiOperation({
        summary: 'Monthly offs entitlement',
        description:
            'The 4-offs-per-month policy: how many, paid or not, carried forward or encashed.',
    })
    listHolidayPolicies(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.settings.listHolidayPolicies(
            user,
            inc === '1' || inc === 'true',
        );
    }

    @Post('offs-policies')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    saveHolidayPolicy(
        @CurrentUser() user: HrUser,
        @Body() dto: HolidayPolicyDto,
    ) {
        return this.settings.saveHolidayPolicy(user, dto);
    }

    @Delete('offs-policies/:id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    deactivateHolidayPolicy(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.settings.deactivateHolidayPolicy(user, id);
    }

    // ----------------------------------------------------------- leave types

    @Get('leave-types/manage')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    listLeaveTypes(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.settings.listLeaveTypes(
            user,
            inc === '1' || inc === 'true',
        );
    }

    @Post('leave-types')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Create or update a leave type',
        description:
            'The monthly-off flag is fixed once created: balances and encashment are computed from exactly one type, and moving that flag would detach what everyone has accrued.',
    })
    saveLeaveType(@CurrentUser() user: HrUser, @Body() dto: LeaveTypeDto) {
        return this.settings.saveLeaveType(user, dto);
    }

    // ------------------------------------------------------- deduction rules

    @Get('deduction-rules')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    @ApiOperation({
        summary: 'Deduction rules',
        description:
            'The late ladder and the per-day deductions payroll applies. A tenant with no rules is charged on the shipped defaults, so an empty list is not a disabled one.',
    })
    listDeductionRules(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.settings.listDeductionRules(
            user,
            inc === '1' || inc === 'true',
        );
    }

    @Post('deduction-rules')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    saveDeductionRule(
        @CurrentUser() user: HrUser,
        @Body() dto: DeductionRuleDto,
    ) {
        return this.settings.saveDeductionRule(user, dto);
    }

    @Delete('deduction-rules/:id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    deactivateDeductionRule(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.settings.deactivateDeductionRule(user, id);
    }

    // -------------------------------------------------------- approval rules

    @Get('approval-rules')
    @RequirePermission(Permissions.HR_SETTINGS_VIEW)
    @ApiOperation({
        summary: 'Approval thresholds',
        description:
            '"A branch manager may waive up to 2,000; above that needs the GM" as a row. A rule only ADDS a requirement, so an empty list means the endpoint permissions are the only check.',
    })
    listApprovalRules(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.settings.listApprovalRules(
            user,
            inc === '1' || inc === 'true',
        );
    }

    @Post('approval-rules')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    saveApprovalRule(
        @CurrentUser() user: HrUser,
        @Body() dto: ApprovalRuleDto,
    ) {
        return this.settings.saveApprovalRule(user, dto);
    }

    @Delete('approval-rules/:id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    deactivateApprovalRule(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.settings.deactivateApprovalRule(user, id);
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
