import {
    BadRequestException,
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { RiderSupervisorService } from './rider-supervisor.service';

type SupervisorUser = {
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
    /** Per-role history window (roles.order_history_days); null = unlimited. */
    orderHistoryDays?: number | null;
    /** Expanded permission names, set by RoleAccessGuard. */
    permissions?: string[];
};

/** Order status is a separate grant on this surface — see the migration. */
function canViewStatus(user: SupervisorUser): boolean {
    return (
        user.permissions?.includes(Permissions.RIDER_SUPERVISOR_VIEW_STATUS) ??
        false
    );
}

/**
 * Read-only oversight endpoints for the "Rider supervisor" sub-module. Every
 * handler is gated by RIDER_SUPERVISOR_VIEW (the path prefix guard never blocks
 * — see auth/role-access.guard.ts — so the decorator is the real gate) and the
 * service applies branch/brand scope from the request user.
 */
@ApiTags('Admin – Rider HRM – Supervisor')
@ApiBearerAuth()
@Controller('admin/rider-hrm/supervisor')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RiderSupervisorAdminController {
    constructor(private readonly service: RiderSupervisorService) {}

    /**
     * Delivery orders bucketed by status. Defaults to the last 30 days;
     * date_from / date_to (YYYY-MM-DD, on order placement date) narrow or widen
     * that, always clamped by the caller's role history window.
     */
    @Get('delivery-orders')
    @RequirePermission(Permissions.RIDER_SUPERVISOR_VIEW)
    listDeliveryOrders(
        @CurrentUser() user: SupervisorUser,
        @Query('status') status?: string,
        @Query('page') page?: string,
        @Query('page_size') pageSize?: string,
        @Query('brand_id') brandId?: string,
        @Query('branch_id') branchId?: string,
        @Query('rider_id') riderId?: string,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
    ) {
        if (user.tenantId == null)
            throw new BadRequestException('Tenant context required');
        return this.service.listDeliveryOrders(
            { ...user, canViewStatus: canViewStatus(user) },
            {
                status,
                page: page ? +page : undefined,
                page_size: pageSize ? +pageSize : undefined,
                brand_id: brandId ? +brandId : undefined,
                branch_id: branchId ? +branchId : undefined,
                rider_id: riderId ? +riderId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
        );
    }

    /** Live rider roster with attendance + base salary. */
    @Get('riders')
    @RequirePermission(Permissions.RIDER_SUPERVISOR_VIEW)
    listRiders(
        @CurrentUser() user: SupervisorUser,
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
        @Query('status') status?: string,
        @Query('rider_id') riderId?: string,
    ) {
        if (user.tenantId == null)
            throw new BadRequestException('Tenant context required');
        return this.service.listRiders(user, {
            branchId: branchId ? +branchId : undefined,
            brandId: brandId ? +brandId : undefined,
            status,
            riderId: riderId ? +riderId : undefined,
        });
    }

    /** Brand + branch options for the page filters, scoped to the caller. */
    @Get('filters')
    @RequirePermission(Permissions.RIDER_SUPERVISOR_VIEW)
    getFilters(@CurrentUser() user: SupervisorUser) {
        if (user.tenantId == null)
            throw new BadRequestException('Tenant context required');
        return this.service.getFilterOptions(user);
    }
}
