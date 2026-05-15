import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RiderHrmService } from './rider-hrm.service';

function parseOptionalIsoDate(param?: string): Date | undefined {
    if (param == null || String(param).trim() === '') return undefined;
    const d = new Date(String(param));
    if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid date: ${param}`);
    }
    return d;
}

@ApiTags('Admin – Rider HRM')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class AdminRiderHrmController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Post('profiles')
    upsertProfile(
        @CurrentUser() user: { tenantId: number | null },
        @Body()
        dto: {
            user_id: number;
            employment_status?: string;
            salary_type?: string;
            employee_code?: string;
            base_salary?: number;
            default_per_ride_commission?: number;
            max_active_orders?: number;
            min_rating?: number;
            min_timely_rate?: number;
            is_active?: boolean;
            metadata?: Record<string, unknown>;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.upsertRiderProfile(user.tenantId, dto);
    }

    @Get('profiles')
    listProfiles(@CurrentUser() user: { tenantId: number | null }) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listRiderProfiles(user.tenantId);
    }

    @Get('on-duty')
    listOnDuty(
        @CurrentUser() user: { tenantId: number | null },
        @Query('branch_id') branchId: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listOnDuty(
            user.tenantId,
            branchId ? +branchId : undefined,
        );
    }

    @Post('attendance/check-in')
    checkIn(
        @Body()
        body: {
            rider_user_id: number;
            branch_id: number;
            notes?: string;
        },
    ) {
        if (
            body?.rider_user_id == null ||
            body?.branch_id == null ||
            typeof body.rider_user_id !== 'number' ||
            typeof body.branch_id !== 'number'
        ) {
            throw new BadRequestException(
                'rider_user_id and branch_id are required',
            );
        }
        return this.riderHrmService.checkIn(
            body.rider_user_id,
            body.branch_id,
            body.notes,
        );
    }

    @Post('attendance/check-out')
    checkOut(@Body() body: { rider_user_id: number; notes?: string }) {
        if (
            body?.rider_user_id == null ||
            typeof body.rider_user_id !== 'number'
        ) {
            throw new BadRequestException('rider_user_id is required');
        }
        return this.riderHrmService.checkOut(body.rider_user_id, body.notes);
    }

    @Get('attendance/breaks')
    @ApiOperation({
        summary: 'List break history for a rider',
        description:
            'Tenant-scoped. Returns `rider_break_sessions` rows (newest first). Use for audits and payroll adjustments.',
    })
    @ApiQuery({ name: 'rider_user_id', required: true, description: 'Rider staff user id (`users.id`).' })
    @ApiQuery({
        name: 'from',
        required: false,
        description: 'Optional ISO date/time — filter `started_at >= from`.',
    })
    @ApiQuery({
        name: 'to',
        required: false,
        description: 'Optional ISO date/time — filter `started_at <= to`.',
    })
    @ApiQuery({
        name: 'limit',
        required: false,
        description: 'Max rows (default 120, max 500).',
    })
    @ApiOkResponse({
        description: 'Break session rows',
        schema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'number' },
                            rider_user_id: { type: 'number' },
                            attendance_session_id: { type: 'number', nullable: true },
                            branch_id: { type: 'number', nullable: true },
                            started_at: { type: 'string' },
                            ended_at: { type: 'string', nullable: true },
                            reason: { type: 'string', nullable: true },
                            created_at: { type: 'string' },
                        },
                    },
                },
            },
        },
    })
    listAttendanceBreaks(
        @CurrentUser() user: { tenantId: number | null },
        @Query('rider_user_id') riderUserIdParam: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        const riderUserId = +riderUserIdParam;
        if (!Number.isFinite(riderUserId) || riderUserId <= 0) {
            throw new BadRequestException('rider_user_id is required');
        }
        const parsedLimit = limit != null && String(limit).trim() !== ''
            ? Number(limit)
            : undefined;
        if (
            parsedLimit != null &&
            (!Number.isFinite(parsedLimit) || parsedLimit < 1)
        ) {
            throw new BadRequestException('limit must be a positive number');
        }
        return this.riderHrmService.listRiderBreakSessionsForAdmin(
            user.tenantId,
            riderUserId,
            {
                from: parseOptionalIsoDate(from),
                to: parseOptionalIsoDate(to),
                limit: parsedLimit,
            },
        );
    }

    @Post('comp-plans')
    createCompPlan(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            name: string;
            pay_method: string;
            branch_id?: number;
            effective_from?: string;
            effective_to?: string;
            components: Array<{
                component_key: string;
                name: string;
                component_type: string;
                calc_basis: string;
                value: number;
                conditions?: Record<string, unknown>;
                is_enabled?: boolean;
                sort_order?: number;
            }>;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.createCompPlan(user.tenantId, user.id, dto);
    }

    @Get('comp-plans')
    listCompPlans(
        @CurrentUser() user: { tenantId: number | null },
        @Query('branch_id') branchId: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listCompPlans(
            user.tenantId,
            branchId ? +branchId : undefined,
        );
    }

    @Patch('comp-plans/:id/activate')
    activateCompPlan(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.activateCompPlan(
            +id,
            user.tenantId,
            user.id,
        );
    }

    @Get('comp-plans/:id')
    getCompPlan(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.getCompPlan(+id, user.tenantId);
    }

    @Post('payroll/runs')
    runPayroll(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            from: string;
            to: string;
            branch_id?: number;
            timely_minutes?: number;
            expected_monthly_minutes?: number;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.runPayroll(user.tenantId, user.id, dto);
    }

    @Get('payroll/runs')
    listPayrollRuns(
        @CurrentUser() user: { tenantId: number | null },
        @Query('branch_id') branchId: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listPayrollRuns(
            user.tenantId,
            branchId ? +branchId : undefined,
        );
    }

    @Get('payroll/runs/:id')
    getPayrollRun(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.getPayrollRun(+id, user.tenantId);
    }

    @Post('payroll/runs/:id/reverse')
    reversePayrollRun(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.reversePayrollRun(
            +id,
            user.tenantId,
            user.id,
        );
    }
}
