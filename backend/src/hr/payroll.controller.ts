import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Post,
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
import { PayrollService } from './payroll.service';
import type { HrUser } from './employee-scope';
import {
    ApproveRunDto,
    CreateAdvanceDto,
    CreatePayrollAdjustmentDto,
    CreateRunDto,
    ReverseRunDto,
    SalaryStructureDto,
    WriteOffAdvanceDto,
} from './dto/payroll.dto';

@ApiTags('Admin – Payroll')
@ApiBearerAuth()
@Controller('admin/hr/payroll')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class PayrollController {
    constructor(private readonly payroll: PayrollService) {}

    @Get('runs')
    @RequirePermission(Permissions.PAYROLL_VIEW)
    listRuns(@CurrentUser() user: HrUser) {
        return this.payroll.listRuns(user);
    }

    @Get('runs/:id')
    @RequirePermission(Permissions.PAYROLL_VIEW)
    getRun(@CurrentUser() user: HrUser, @Param('id', ParseIntPipe) id: number) {
        return this.payroll.getRun(user, id);
    }

    @Get('runs/:id/preflight')
    @RequirePermission(Permissions.PAYROLL_VIEW)
    @ApiOperation({
        summary: 'What would block approval',
        description:
            'Unapproved overtime is the important one — those minutes are never paid, so approving with some still pending silently underpays whoever earned it.',
    })
    preflight(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.payroll.preflight(user, id);
    }

    @Get('payslips/:lineId')
    @RequirePermission(Permissions.PAYROLL_VIEW)
    @ApiOperation({
        summary: 'One payslip with the arithmetic behind every figure',
        description:
            'Each line carries calc_meta — the sum that produced it. Waivers and adjustments appear as their own lines beside the deduction they offset, never netted into it.',
    })
    payslip(
        @CurrentUser() user: HrUser,
        @Param('lineId', ParseIntPipe) lineId: number,
    ) {
        return this.payroll.getPayslip(user, lineId);
    }

    @Post('runs')
    @RequirePermission(Permissions.PAYROLL_RUN)
    createRun(@CurrentUser() user: HrUser, @Body() dto: CreateRunDto) {
        return this.payroll.createRun(user, dto);
    }

    @Post('runs/:id/compute')
    @RequirePermission(Permissions.PAYROLL_RUN)
    @ApiOperation({
        summary: 'Compute or recompute every line',
        description:
            'Freely repeatable while the run is draft or computed; lines are rebuilt from scratch. By default pay is earned only up to TODAY, so a mid-month run shows what has been earned so far rather than a full month. Pass project_full_period=1 to project the whole period instead, for budgeting.',
    })
    compute(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Query('project_full_period') projectFullPeriod?: string,
    ) {
        return this.payroll.compute(
            user,
            id,
            projectFullPeriod === '1' || projectFullPeriod === 'true',
        );
    }

    @Post('runs/:id/approve')
    @RequirePermission(Permissions.PAYROLL_APPROVE)
    @ApiOperation({
        summary: 'Approve and lock the attendance period',
        description:
            'After approval there is no edit path — only a reversal or an adjustment carried into the next period. `force` accepts the preflight blockers, and records that it did.',
    })
    approve(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ApproveRunDto,
    ) {
        return this.payroll.approve(user, id, dto?.force ?? false);
    }

    @Post('runs/:id/reverse')
    @RequirePermission(Permissions.PAYROLL_REVERSE)
    @ApiOperation({
        summary: 'Reverse an approved run and unlock the period',
        description: 'A reason is mandatory and enforced by the database.',
    })
    reverse(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ReverseRunDto,
    ) {
        return this.payroll.reverse(user, id, dto.reason);
    }

    @Post('runs/:id/mark-paid')
    @RequirePermission(Permissions.PAYROLL_APPROVE)
    markPaid(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.payroll.markPaid(user, id);
    }

    @Post('payslips/:lineId/adjustments')
    @RequirePermission(Permissions.PAYROLL_ADJUST)
    @ApiOperation({
        summary: 'Waive a deduction or add one, with a reason',
        description:
            'Never edits a computed figure — it adds an immutable row and its own payslip line, so the machine’s number stays visible next to the human’s override.',
    })
    addAdjustment(
        @CurrentUser() user: HrUser,
        @Param('lineId', ParseIntPipe) lineId: number,
        @Body() dto: CreatePayrollAdjustmentDto,
    ) {
        return this.payroll.addAdjustment(user, lineId, dto);
    }
}

@ApiTags('Admin – Payroll')
@ApiBearerAuth()
@Controller('admin/hr/advances')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class AdvancesController {
    constructor(private readonly payroll: PayrollService) {}

    @Get()
    @RequirePermission(Permissions.PAYROLL_VIEW)
    list(
        @CurrentUser() user: HrUser,
        @Query('employee_id') employeeId?: string,
    ) {
        return this.payroll.listAdvances(
            user,
            employeeId ? Number(employeeId) : undefined,
        );
    }

    @Post()
    @RequirePermission(Permissions.PAYROLL_ADJUST)
    @ApiOperation({
        summary: 'Record a salary advance',
        description:
            'Recovered automatically by payroll: one instalment per approved run, or the whole outstanding balance on a leaver’s final payslip.',
    })
    create(@CurrentUser() user: HrUser, @Body() dto: CreateAdvanceDto) {
        return this.payroll.createAdvance(user, dto);
    }

    @Post(':id/write-off')
    @RequirePermission(Permissions.PAYROLL_ADJUST)
    @ApiOperation({
        summary: 'Write off the remaining balance',
        description:
            'A decision on the advance, not a payslip waiver — forgiving it inside payroll would hide that real money was given up.',
    })
    writeOff(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: WriteOffAdvanceDto,
    ) {
        return this.payroll.writeOffAdvance(user, id, dto.reason);
    }
}

@ApiTags('Admin – Payroll')
@ApiBearerAuth()
@Controller('admin/hr/employees')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class SalaryController {
    constructor(private readonly payroll: PayrollService) {}

    @Get(':id/salary')
    @RequirePermission(Permissions.SALARY_VIEW)
    @ApiOperation({
        summary: 'Salary history, newest first',
        description:
            'Gated by salary:view, which is standalone — never implied by employees:view.',
    })
    history(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.payroll.salaryHistory(user, id);
    }

    @Post(':id/salary')
    @RequirePermission(Permissions.SALARY_EDIT)
    @ApiOperation({
        summary: 'Set or revise salary',
        description:
            'Closes the current structure the day before and opens a new one. A raise leaves a dated trail rather than overwriting what someone used to earn.',
    })
    setSalary(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: SalaryStructureDto,
    ) {
        return this.payroll.setSalary(user, id, dto);
    }
}
