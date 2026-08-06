import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Put,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { RequirePermission } from '../roles/require-permission.decorator';
import { Permissions } from '../roles/permissions.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { ClientEventBatchDto } from './client-event.dto';
import { PurgeMonthDto } from './purge-month.dto';
import { ActivityLogSettingsService } from './activity-log-settings.service';
import { UpdateSettingsDto } from './update-settings.dto';

type ActivityUser = {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    name?: string;
    email?: string;
    isSuperAdmin?: boolean;
    roles?: Array<{ slug: string; name: string }>;
};

/**
 * Read-only API over the activity log.
 *
 * There is deliberately **no POST, PUT, PATCH or DELETE here, and there never
 * will be**. Rows are written by the middleware; the table's trigger refuses
 * modification; expiring history is a partition drop performed by the
 * maintenance service (Phase 6), not an endpoint.
 *
 * Reading the log is itself an audited event: `/admin/activity-logs` is on the
 * sensitive-read allow-list, so "who has been reading the audit trail" is as
 * answerable as anything else.
 */
@ApiTags('Admin – Activity Log')
@ApiBearerAuth()
@Controller('admin/activity-logs')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class ActivityLogController {
    constructor(
        private readonly service: ActivityLogService,
        private readonly settings: ActivityLogSettingsService,
    ) {}

    /** Current capture settings. Readable by anyone who can read the log. */
    @Get('settings')
    @RequirePermission(Permissions.ACTIVITY_LOG_VIEW)
    getSettings() {
        return this.settings.get();
    }

    /**
     * Change what is captured. Needs activity-log:configure AND the caller's
     * own password — turning capture off is the obvious way to work unobserved,
     * so it is gated like the purge and logged before it takes effect.
     */
    @Put('settings')
    @RequirePermission(Permissions.ACTIVITY_LOG_CONFIGURE)
    updateSettings(
        @CurrentUser() user: ActivityUser,
        @Body() dto: UpdateSettingsDto,
    ) {
        return this.settings.update(dto, user);
    }

    @Get()
    @RequirePermission(Permissions.ACTIVITY_LOG_VIEW)
    @ApiOperation({
        summary:
            'List activity, newest first. The date range is bounded (default 7 days, max 92) so queries stay inside a partition.',
    })
    list(
        @CurrentUser() user: ActivityUser,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('actor_user_id') actorUserId?: string,
        @Query('actor_type') actorType?: string,
        @Query('action') action?: string,
        @Query('action_group') actionGroup?: string,
        @Query('entity_type') entityType?: string,
        @Query('entity_id') entityId?: string,
        @Query('outcome') outcome?: string,
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
        @Query('request_id') requestId?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('page_size') pageSize?: string,
    ) {
        return this.service.find(
            {
                date_from: dateFrom,
                date_to: dateTo,
                actor_user_id: actorUserId ? +actorUserId : undefined,
                actor_type: actorType,
                action,
                action_group: actionGroup,
                entity_type: entityType,
                entity_id: entityId,
                outcome,
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                request_id: requestId,
                search,
                page: page ? +page : undefined,
                page_size: pageSize ? +pageSize : undefined,
            },
            user.tenantId,
            user.allowedBranchIds,
        );
    }

    /**
     * Client-side events the server never sees: printing a receipt, exporting a
     * CSV, opening a screen full of customer phone numbers.
     *
     * **The client supplies the WHAT; the server supplies the WHO.** Actor,
     * tenant, roles and IP come from the JWT and the request, never from the
     * body — otherwise any logged-in browser could write rows attributed to
     * someone else. The action and subject are validated against closed enums
     * for the same reason.
     *
     * Deliberately NOT permission-gated beyond being logged in: a cashier
     * printing a receipt must produce a row, and cashiers hold no admin rights.
     */
    @Post('events')
    @HttpCode(202)
    recordClientEvents(
        @CurrentUser() user: ActivityUser,
        @Body() body: ClientEventBatchDto,
        @Req() req: Request,
    ) {
        return this.service.recordClientEvents(body.events ?? [], user, req);
    }

    /**
     * Archive one past month and drop it from the database.
     *
     * Four gates, all server-side: the `activity-log:purge` permission, the
     * caller re-entering their own password, a 90-day floor no role can reach
     * past, and archive → verify → drop so a purge is a move rather than a
     * deletion. The purge writes its own audit row.
     */
    @Post('purge')
    @HttpCode(200)
    @RequirePermission(Permissions.ACTIVITY_LOG_PURGE)
    purge(@CurrentUser() user: ActivityUser, @Body() dto: PurgeMonthDto) {
        return this.service.purgeMonth(dto.month, dto.password, user);
    }

    /** Options for the filter dropdowns (last 30 days of distinct values). */
    @Get('filter-options')
    @RequirePermission(Permissions.ACTIVITY_LOG_VIEW)
    filterOptions(@CurrentUser() user: ActivityUser) {
        return this.service.filterOptions(user.tenantId);
    }

    /** History of one record — what the "History" drawer on a record page uses. */
    @Get('entity/:entityType/:entityId')
    @RequirePermission(Permissions.ACTIVITY_LOG_VIEW)
    forEntity(
        @CurrentUser() user: ActivityUser,
        @Param('entityType') entityType: string,
        @Param('entityId') entityId: string,
        @Query('days') days?: string,
    ) {
        return this.service.findForEntity(
            entityType,
            entityId,
            user.tenantId,
            user.allowedBranchIds,
            days ? +days : undefined,
        );
    }

    /**
     * Everything else from the same request. `created_at` is required so the
     * lookup stays inside one partition.
     */
    @Get('related/:requestId')
    @RequirePermission(Permissions.ACTIVITY_LOG_VIEW)
    related(
        @CurrentUser() user: ActivityUser,
        @Param('requestId') requestId: string,
        @Query('created_at') createdAt: string,
    ) {
        return this.service.findRelated(
            requestId,
            createdAt,
            user.tenantId,
            user.allowedBranchIds,
        );
    }

    /**
     * One row in full. `created_at` is required alongside the id because the
     * primary key is (created_at, id) — without it, finding one row would mean
     * searching every partition.
     */
    @Get(':id')
    @RequirePermission(Permissions.ACTIVITY_LOG_VIEW)
    detail(
        @CurrentUser() user: ActivityUser,
        @Param('id') id: string,
        @Query('created_at') createdAt: string,
    ) {
        return this.service.findOne(
            id,
            createdAt,
            user.tenantId,
            user.allowedBranchIds,
        );
    }
}
