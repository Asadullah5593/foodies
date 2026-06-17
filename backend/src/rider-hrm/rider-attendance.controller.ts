import {
    BadRequestException,
    Body,
    Controller,
    DefaultValuePipe,
    Get,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiBody,
    ApiOkResponse,
    ApiOperation,
    ApiQuery,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RiderAuthGuard } from '../auth/rider-auth.guard';
import { RiderHrmService } from './rider-hrm.service';
import {
    RiderCheckInDto,
    RiderCheckOutDto,
    RiderHeartbeatDto,
    RiderPauseDto,
} from './dto/rider-attendance.dto';

function parseOptionalIsoDate(param?: string): Date | undefined {
    if (param == null || String(param).trim() === '') return undefined;
    const d = new Date(String(param));
    if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid date: ${param}`);
    }
    return d;
}

const attendanceStatusSchema = {
    type: 'object',
    description:
        'Current rider presence for dispatch. All datetime fields are ISO-8601 strings.',
    properties: {
        rider_user_id: { type: 'number', example: 42 },
        branch_id: { type: 'number', nullable: true, example: 10 },
        branch_name: { type: 'string', nullable: true, example: 'Emporium' },
        is_checked_in: { type: 'boolean', example: true },
        is_paused: { type: 'boolean', example: false },
        pause_reason: { type: 'string', nullable: true, example: null },
        last_heartbeat_at: {
            type: 'string',
            nullable: true,
            example: '2026-05-13T12:00:00.000Z',
        },
        last_location_at: {
            type: 'string',
            nullable: true,
            example: '2026-05-13T12:00:00.000Z',
        },
        last_latitude: { type: 'number', nullable: true, example: 31.4522 },
        last_longitude: { type: 'number', nullable: true, example: 74.2759 },
    },
} as const;

const riderBranchSchema = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            id: { type: 'number', example: 10 },
            name: { type: 'string', example: 'Emporium' },
            code: { type: 'string', example: 'EMP-01' },
            address: {
                type: 'string',
                nullable: true,
                example: '123 Main St',
            },
        },
    },
} as const;

@ApiTags('Rider – Attendance')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('rider/attendance')
@UseGuards(JwtAuthGuard, RiderAuthGuard)
export class RiderAttendanceController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Get('branches')
    @ApiOperation({
        summary: 'List branches where the rider can check in',
        description:
            'Returns active branches where the authenticated user has the `rider` role via `branch_users`. Use `id` as `branch_id` in POST /rider/attendance/check-in.',
    })
    @ApiOkResponse({
        description: 'Ordered by branch name ascending.',
        schema: riderBranchSchema,
    })
    listBranches(@CurrentUser() user: { id: number }) {
        return this.riderHrmService.listRiderBranches(user.id);
    }

    @Get('status')
    @ApiOperation({
        summary: 'Get current attendance / presence status',
        description:
            'Use after login and while on shift. When `is_checked_in` is false, rider should not receive auto-assigned orders until they check in.',
    })
    @ApiOkResponse({
        description: 'Presence snapshot used by dispatch and the rider app.',
        schema: attendanceStatusSchema,
    })
    getStatus(@CurrentUser() user: { id: number }) {
        return this.riderHrmService.getPresenceStatus(user.id);
    }

    @Get('breaks')
    @ApiOperation({
        summary: 'List my break history',
        description:
            'Returns break intervals for this rider (newest first). Each start of a break creates a row with `started_at`; ending the break sets `ended_at`. An open break shows `ended_at: null`.',
    })
    @ApiQuery({
        name: 'from',
        required: false,
        description:
            'Optional ISO date/time — filter breaks with started_at on or after this instant.',
    })
    @ApiQuery({
        name: 'to',
        required: false,
        description:
            'Optional ISO date/time — filter breaks with started_at on or before this instant.',
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
                            attendance_session_id: {
                                type: 'number',
                                nullable: true,
                            },
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
    listMyBreaks(
        @CurrentUser() user: { id: number },
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
    ) {
        const parsedLimit =
            limit != null && String(limit).trim() !== ''
                ? Number(limit)
                : undefined;
        if (
            parsedLimit != null &&
            (!Number.isFinite(parsedLimit) || parsedLimit < 1)
        ) {
            throw new BadRequestException('limit must be a positive number');
        }
        return this.riderHrmService.listMyBreakSessions(user.id, {
            from: parseOptionalIsoDate(from),
            to: parseOptionalIsoDate(to),
            limit: parsedLimit,
        });
    }

    @Post('check-in')
    @ApiOperation({
        summary: 'Check in at a branch',
        description:
            'Opens an attendance session and marks the rider on duty for that branch. Fails if already checked in, or if the user is not a rider at `branch_id`.',
    })
    @ApiBody({
        type: RiderCheckInDto,
        examples: {
            minimal: {
                summary: 'Required fields only',
                value: { branch_id: 10 },
            },
            withNote: {
                summary: 'With optional note',
                value: { branch_id: 10, notes: 'Morning shift' },
            },
        },
    })
    @ApiOkResponse({
        description: 'Attendance session created; presence updated.',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'number', example: 501 },
                rider_user_id: { type: 'number', example: 42 },
                branch_id: { type: 'number', example: 10 },
                status: { type: 'string', example: 'checked_in' },
                checked_in_at: {
                    type: 'string',
                    example: '2026-05-13T08:00:00.000Z',
                },
                checked_out_at: {
                    type: 'string',
                    nullable: true,
                    example: null,
                },
                notes: {
                    type: 'string',
                    nullable: true,
                    example: 'Morning shift',
                },
            },
        },
    })
    checkIn(
        @CurrentUser() user: { id: number },
        @Body() body: RiderCheckInDto,
    ) {
        return this.riderHrmService.checkIn(
            user.id,
            body.branch_id,
            body.notes,
        );
    }

    @Post('check-out')
    @ApiOperation({
        summary: 'Check out (end shift)',
        description:
            'Closes the open attendance session and clears on-duty presence. Body may be `{}`.',
    })
    @ApiBody({
        type: RiderCheckOutDto,
        examples: {
            empty: { summary: 'No note', value: {} },
            withNote: {
                summary: 'With note',
                value: { notes: 'End of shift' },
            },
        },
    })
    @ApiOkResponse({
        description: 'Attendance session closed.',
        schema: {
            type: 'object',
            properties: {
                id: { type: 'number' },
                rider_user_id: { type: 'number' },
                branch_id: { type: 'number' },
                status: { type: 'string', example: 'checked_out' },
                checked_in_at: { type: 'string' },
                checked_out_at: { type: 'string' },
                notes: { type: 'string', nullable: true },
            },
        },
    })
    checkOut(
        @CurrentUser() user: { id: number },
        @Body(new DefaultValuePipe({})) body: RiderCheckOutDto,
    ) {
        return this.riderHrmService.checkOut(user.id, body?.notes);
    }

    @Patch('pause')
    @ApiOperation({
        summary: 'Start or end break',
        description:
            '`is_paused: true` marks the rider on break (unavailable for new auto-assignments). `is_paused: false` clears the break. Rider must be checked in first. ' +
            'Each break start is stored in `rider_break_sessions` with `started_at` / optional `reason`; ending the break sets `ended_at`. Check-out auto-closes any open break.',
    })
    @ApiBody({
        type: RiderPauseDto,
        examples: {
            startBreak: {
                summary: 'Start break',
                value: { is_paused: true, pause_reason: 'Lunch' },
            },
            startBreakMinimal: {
                summary: 'Start break (minimal)',
                value: { is_paused: true },
            },
            endBreak: {
                summary: 'End break / resume',
                value: { is_paused: false },
            },
        },
    })
    @ApiOkResponse({
        description: 'Updated pause flags (subset of full presence).',
        schema: {
            type: 'object',
            properties: {
                rider_user_id: { type: 'number' },
                is_checked_in: { type: 'boolean' },
                is_paused: { type: 'boolean' },
                pause_reason: { type: 'string', nullable: true },
            },
        },
    })
    pause(@CurrentUser() user: { id: number }, @Body() body: RiderPauseDto) {
        return this.riderHrmService.setPause(
            user.id,
            body.is_paused,
            body.pause_reason,
        );
    }

    @Patch('heartbeat')
    @ApiOperation({
        summary: 'Heartbeat + optional GPS',
        description:
            'Call periodically while checked in. Updates `last_heartbeat_at`. When `latitude` and `longitude` are both sent, updates last location used for dispatch radius checks.',
    })
    @ApiBody({
        type: RiderHeartbeatDto,
        examples: {
            coords: {
                summary: 'With GPS (recommended)',
                value: { latitude: 31.4522, longitude: 74.2759 },
            },
            heartbeatOnly: {
                summary: 'Heartbeat timestamps only (no GPS)',
                value: {},
            },
        },
    })
    @ApiOkResponse({
        description: 'Updated presence including freshness timestamps.',
        schema: attendanceStatusSchema,
    })
    heartbeat(
        @CurrentUser() user: { id: number },
        @Body(new DefaultValuePipe({})) body: RiderHeartbeatDto,
    ) {
        return this.riderHrmService.heartbeat(user.id, body ?? {});
    }
}
