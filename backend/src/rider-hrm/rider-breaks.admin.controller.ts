import {
    BadRequestException,
    Controller,
    Get,
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

@ApiTags('Admin – Rider HRM – Breaks')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class RiderBreaksAdminController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

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
}
