import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { RequirePermission } from '../roles/require-permission.decorator';
import { Permissions } from '../roles/permissions.dto';
import { CurrentUser } from '../auth/current-user.decorator';

type ActivityUser = {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
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
    constructor(private readonly service: ActivityLogService) {}

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
        return this.service.findRelated(requestId, createdAt, user.tenantId);
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
