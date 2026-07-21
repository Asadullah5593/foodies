import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Shifts')
@ApiBearerAuth()
@Controller('admin/shifts')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class ShiftsController {
    constructor(private service: ShiftsService) {}

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('status') status: string,
        @Query('opened_from') openedFrom?: string,
        @Query('opened_to') openedTo?: string,
    ) {
        // ISO instants (the client converts its local calendar range), so the
        // window is timezone-exact; invalid values are ignored.
        const from = openedFrom ? new Date(openedFrom) : null;
        const to = openedTo ? new Date(openedTo) : null;
        const validRange =
            from && to && !isNaN(from.getTime()) && !isNaN(to.getTime());
        return this.service.findAll(
            branchId ? +branchId : undefined,
            status,
            user.tenantId,
            user.allowedBranchIds,
            user.allowedBrandIds,
            brandId ? +brandId : undefined,
            validRange ? from : null,
            validRange ? to : null,
        );
    }

    @Get(':id')
    show(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Param('id') id: string,
    ) {
        return this.service.findOne(
            +id,
            user.tenantId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get(':id/orders')
    orders(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Param('id') id: string,
    ) {
        return this.service.getOrdersInShift(
            +id,
            user.tenantId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get(':id/pending-orders')
    pendingOrders(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Param('id') id: string,
    ) {
        return this.service.getPendingOrdersInShift(
            +id,
            user.tenantId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Post()
    @RequirePermission(Permissions.SHIFTS_OPEN)
    store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            branch_id: number;
            brand_id: number;
            // The shift owner is always the authenticated user; any user_id in
            // the body is ignored.
            user_id?: number;
            opening_cash: number;
            notes?: string;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(
            {
                branch_id: dto.branch_id,
                brand_id: dto.brand_id,
                user_id: user.id,
                opening_cash: dto.opening_cash,
                notes: dto.notes,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Post(':id/close')
    @RequirePermission(Permissions.SHIFTS_CLOSE)
    close(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: { actual_cash: number; notes?: string },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.close(
            +id,
            dto,
            user.tenantId,
            user.allowedBranchIds,
            user.id,
            user.allowedBrandIds,
        );
    }
}
