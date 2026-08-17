import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
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
import { LeavesService } from './leaves.service';
import type { HrUser } from './employee-scope';
import {
    CreateLeaveRequestDto,
    DecideLeaveDto,
    LeaveQueryDto,
    PublicHolidayDto,
} from './dto/leave.dto';

@ApiTags('Admin – Leaves')
@ApiBearerAuth()
@Controller('admin/hr/leaves')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class LeavesController {
    constructor(private readonly leaves: LeavesService) {}

    @Get()
    @RequirePermission(Permissions.LEAVES_VIEW)
    list(@CurrentUser() user: HrUser, @Query() query: LeaveQueryDto) {
        return this.leaves.list(user, query);
    }

    @Get('balances/:employeeId')
    @RequirePermission(Permissions.LEAVES_VIEW)
    @ApiOperation({
        summary: 'Entitlement position for one employee in one month',
        description:
            'Includes the monthly-off type, whose unused balance is encashed at payroll by client policy.',
    })
    balances(
        @CurrentUser() user: HrUser,
        @Param('employeeId', ParseIntPipe) employeeId: number,
        @Query('year') year?: string,
        @Query('month') month?: string,
    ) {
        const now = new Date();
        return this.leaves.balanceFor(
            user,
            employeeId,
            year ? Number(year) : now.getUTCFullYear(),
            month ? Number(month) : now.getUTCMonth() + 1,
        );
    }

    @Post()
    @RequirePermission(Permissions.LEAVES_REQUEST)
    @ApiOperation({
        summary: 'Raise a leave request',
        description:
            'Chargeable days exclude weekly offs and public holidays — an employee is never charged entitlement for a day they were not going to work.',
    })
    create(@CurrentUser() user: HrUser, @Body() dto: CreateLeaveRequestDto) {
        return this.leaves.create(user, dto);
    }

    @Patch(':id')
    @RequirePermission(Permissions.LEAVES_APPROVE)
    @ApiOperation({
        summary: 'Approve, reject or cancel',
        description:
            'Approval writes leave_paid / leave_unpaid into attendance_days so payroll reads one source. Days inside an approved payroll period are skipped and reported as locked_days rather than rewritten.',
    })
    decide(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: DecideLeaveDto,
    ) {
        return this.leaves.decide(user, id, dto.decision, dto.note);
    }
}

@ApiTags('Admin – Leaves')
@ApiBearerAuth()
@Controller('admin/hr/settings')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class LeaveSettingsController {
    constructor(private readonly leaves: LeavesService) {}

    /** Readable with leaves:view — every request form needs the type list. */
    @Get('leave-types')
    @RequirePermission(Permissions.LEAVES_VIEW)
    listTypes(@CurrentUser() user: HrUser) {
        return this.leaves.listTypes(user);
    }

    @Get('public-holidays')
    @RequirePermission(Permissions.LEAVES_VIEW)
    listHolidays(@CurrentUser() user: HrUser, @Query('year') year?: string) {
        return this.leaves.listHolidays(user, year ? Number(year) : undefined);
    }

    @Post('public-holidays')
    @RequirePermission(Permissions.HOLIDAYS_MANAGE)
    @ApiOperation({
        summary: 'Add a public holiday',
        description:
            'Separate from the 4 monthly offs and does NOT consume that quota — a holiday is the business not opening.',
    })
    createHoliday(@CurrentUser() user: HrUser, @Body() dto: PublicHolidayDto) {
        return this.leaves.createHoliday(user, dto);
    }

    @Delete('public-holidays/:id')
    @RequirePermission(Permissions.HOLIDAYS_MANAGE)
    removeHoliday(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.leaves.removeHoliday(user, id);
    }
}
