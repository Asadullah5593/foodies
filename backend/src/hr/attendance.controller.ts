import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
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
import { AttendanceService } from './attendance.service';
import { AttendanceRecomputeService } from './attendance-recompute.service';
import type { HrUser } from './employee-scope';
import {
    CreateExceptionDto,
    DecideExceptionDto,
    ManagerAttestDto,
    PunchDto,
    RegisterQueryDto,
    SetPinDto,
} from './dto/attendance.dto';

@ApiTags('Admin – Attendance')
@ApiBearerAuth()
@Controller('admin/hr/attendance')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class AttendanceController {
    constructor(
        private readonly attendance: AttendanceService,
        private readonly recompute: AttendanceRecomputeService,
    ) {}

    @Post('punch')
    @RequirePermission(Permissions.ATTENDANCE_PUNCH)
    @ApiOperation({
        summary: 'Clock in or out at the attendance station',
        description:
            'Identity is an employee code + PIN, or a scanned QR card. The timestamp is the server’s — no client clock is accepted. A repeat within the branch’s duplicate window returns the original punch rather than erroring.',
    })
    punch(@CurrentUser() user: HrUser, @Body() dto: PunchDto) {
        return this.attendance.punch(user, dto);
    }

    @Post('attest')
    @RequirePermission(Permissions.ATTENDANCE_ATTEST)
    @ApiOperation({
        summary: 'Roll call — record attendance for someone else',
        description:
            'Always tagged manager_attestation and always listed in the exceptions report. Never silently equivalent to a self-punch.',
    })
    attest(@CurrentUser() user: HrUser, @Body() dto: ManagerAttestDto) {
        return this.attendance.managerAttest(user, dto);
    }

    @Get('register')
    @RequirePermission(Permissions.ATTENDANCE_VIEW)
    @ApiOperation({ summary: 'Daily attendance register' })
    register(@CurrentUser() user: HrUser, @Query() query: RegisterQueryDto) {
        return this.attendance.register(user, query);
    }

    @Get('exceptions-report')
    @RequirePermission(Permissions.ATTENDANCE_VIEW)
    @ApiOperation({
        summary: 'Everything needing a human',
        description:
            'Flagged days (missing clock-out, manager-attested, no schedule, no photo) plus burst detection — many punches under one till session in a minute, i.e. one person punching for everybody.',
    })
    exceptionsReport(
        @CurrentUser() user: HrUser,
        @Query() query: RegisterQueryDto,
    ) {
        return this.attendance.exceptionsReport(user, query);
    }

    @Get('exceptions')
    @RequirePermission(Permissions.ATTENDANCE_VIEW)
    listExceptions(
        @CurrentUser() user: HrUser,
        @Query('status') status?: string,
    ) {
        return this.attendance.listExceptions(user, status ?? 'pending');
    }

    @Post('days/:id/exceptions')
    @RequirePermission(Permissions.ATTENDANCE_ADJUST)
    @ApiOperation({
        summary: 'Request a correction, a waiver or overtime approval',
        description:
            'A reason is mandatory on every kind — the database rejects a blank one.',
    })
    createException(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: CreateExceptionDto,
    ) {
        return this.attendance.requestException(user, id, dto);
    }

    @Patch('exceptions/:id')
    @RequirePermission(Permissions.ATTENDANCE_ADJUST)
    @ApiOperation({
        summary: 'Approve or reject a request',
        description:
            'The specific right is checked in the service by kind: waivers need attendance-waiver:approve, overtime needs overtime:approve, corrections need attendance:approve.',
    })
    decideException(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: DecideExceptionDto,
    ) {
        return this.attendance.decideException(user, id, dto.decision);
    }

    @Get('days/:id/punches')
    @RequirePermission(Permissions.ATTENDANCE_VIEW)
    @ApiOperation({
        summary: 'Full punch history for one day',
        description:
            'Every in/out with its source, device and method, plus the paired sessions. Several pairs a day are normal — this is how an admin sees them.',
    })
    dayPunches(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.attendance.dayPunches(user, id);
    }

    @Post('recompute')
    @RequirePermission(Permissions.ATTENDANCE_RECOMPUTE)
    @ApiOperation({
        summary: 'Force a recompute of one day',
        description:
            'Idempotent. Refuses days locked by an approved payroll run.',
    })
    recomputeDay(@Body() body: { employee_id: number; work_date: string }) {
        return this.recompute.recomputeDay(body.employee_id, body.work_date);
    }
}

@ApiTags('Admin – Attendance')
@ApiBearerAuth()
@Controller('admin/hr/employees')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class AttendancePinController {
    constructor(private readonly attendance: AttendanceService) {}

    @Put(':id/pin')
    @RequirePermission(Permissions.EMPLOYEE_PIN_RESET)
    @ApiOperation({
        summary: 'Set or reset an attendance PIN',
        description:
            'Hashed like a password. The PIN itself is never written to the audit log — only that it changed, and by whom.',
    })
    setPin(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: SetPinDto,
    ) {
        return this.attendance.setPin(user, id, dto);
    }

    @Post(':id/qr-card')
    @RequirePermission(Permissions.EMPLOYEE_PIN_RESET)
    @ApiOperation({
        summary: 'Issue or reissue a QR employee card',
        description:
            'Returns the token ONCE, for printing — no read endpoint exposes it. Reissuing replaces the previous token, which is how a lost card is revoked.',
    })
    issueQr(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.attendance.issueQrToken(user, id);
    }

    @Delete(':id/qr-card')
    @RequirePermission(Permissions.EMPLOYEE_PIN_RESET)
    @ApiOperation({ summary: 'Revoke a QR card without issuing a new one' })
    revokeQr(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.attendance.revokeQrToken(user, id);
    }
}
