import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Put,
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
import { RiderSharingService } from './rider-sharing.service';

type AuthUser = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

/**
 * Owner/GM only (gated by rider-sharing:manage in path-permissions, plus an
 * in-method owner assertion as defense-in-depth): manage rider↔brand links and
 * review share requests for the whole tenant pool.
 */
@ApiTags('Admin – Rider Pool & Sharing')
@ApiBearerAuth()
@Controller('admin/rider-sharing')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RiderSharingAdminController {
    constructor(private readonly sharing: RiderSharingService) {}

    /** Reject super admin (no tenant) and brand-locked admins. */
    private assertOwner(user: AuthUser): number {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        if (user.allowedBrandIds != null) {
            throw new ForbiddenException(
                'Only the owner/GM can manage the rider pool',
            );
        }
        return user.tenantId;
    }

    @Get('riders')
    listRiders(@CurrentUser() user: AuthUser) {
        const tenantId = this.assertOwner(user);
        return this.sharing.listRidersForOwner(tenantId);
    }

    @Get('riders/:userId/brands')
    listRiderBrands(
        @CurrentUser() user: AuthUser,
        @Param('userId', ParseIntPipe) userId: number,
    ) {
        const tenantId = this.assertOwner(user);
        return this.sharing.getRiderBrandLinks(tenantId, userId);
    }

    @Post('riders/:userId/brands')
    @RequirePermission(Permissions.RIDER_SHARING_MANAGE)
    assignBrand(
        @CurrentUser() user: AuthUser,
        @Param('userId', ParseIntPipe) userId: number,
        @Body() body: { brand_id: number },
    ) {
        const tenantId = this.assertOwner(user);
        if (!body?.brand_id) {
            throw new BadRequestException('brand_id is required');
        }
        return this.sharing.assignRiderToBrand(
            tenantId,
            userId,
            Number(body.brand_id),
            user.id,
        );
    }

    @Delete('riders/:userId/brands/:brandId')
    @RequirePermission(Permissions.RIDER_SHARING_MANAGE)
    removeBrand(
        @CurrentUser() user: AuthUser,
        @Param('userId', ParseIntPipe) userId: number,
        @Param('brandId', ParseIntPipe) brandId: number,
    ) {
        const tenantId = this.assertOwner(user);
        return this.sharing.removeRiderFromBrand(tenantId, userId, brandId);
    }

    @Put('riders/:userId/brands')
    @RequirePermission(Permissions.RIDER_SHARING_MANAGE)
    setBrands(
        @CurrentUser() user: AuthUser,
        @Param('userId', ParseIntPipe) userId: number,
        @Body() body: { brand_ids: number[] },
    ) {
        const tenantId = this.assertOwner(user);
        const brandIds = Array.isArray(body?.brand_ids)
            ? body.brand_ids.map((b) => Number(b))
            : [];
        return this.sharing.setRiderBrands(tenantId, userId, brandIds, user.id);
    }

    @Get('requests')
    listRequests(
        @CurrentUser() user: AuthUser,
        @Query('status') status?: string,
    ) {
        const tenantId = this.assertOwner(user);
        return this.sharing.listShareRequests(tenantId, {
            status: status || undefined,
            allowedBrandIds: null,
        });
    }

    @Post('requests/:id/approve')
    @RequirePermission(Permissions.RIDER_SHARING_MANAGE)
    approve(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        const tenantId = this.assertOwner(user);
        return this.sharing.approveShareRequest(tenantId, id, user.id);
    }

    @Post('requests/:id/decline')
    @RequirePermission(Permissions.RIDER_SHARING_MANAGE)
    decline(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { reason?: string },
    ) {
        const tenantId = this.assertOwner(user);
        return this.sharing.declineShareRequest(
            tenantId,
            id,
            user.id,
            body?.reason,
        );
    }
}

/**
 * Brand-admin facing (gated by rider-share:request): browse the Foodies pool
 * and submit/cancel share requests for the caller's own brand(s).
 */
@ApiTags('Admin – Rider HRM – Sharing')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RiderShareRequestsController {
    constructor(private readonly sharing: RiderSharingService) {}

    private assertTenant(user: AuthUser): number {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return user.tenantId;
    }

    @Get('pool-riders')
    poolRiders(
        @CurrentUser() user: AuthUser,
        @Query('brand_id') brandId: string,
    ) {
        const tenantId = this.assertTenant(user);
        if (!brandId) {
            throw new BadRequestException('brand_id is required');
        }
        return this.sharing.listAvailablePoolRiders(
            tenantId,
            Number(brandId),
            user.allowedBrandIds,
        );
    }

    @Post('share-requests')
    @RequirePermission(Permissions.RIDER_SHARE_REQUEST)
    create(
        @CurrentUser() user: AuthUser,
        @Body()
        body: { brand_id: number; rider_user_id: number; note?: string },
    ) {
        const tenantId = this.assertTenant(user);
        return this.sharing.createShareRequest(
            tenantId,
            body,
            user.id,
            user.allowedBrandIds,
        );
    }

    @Get('share-requests')
    list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
        const tenantId = this.assertTenant(user);
        return this.sharing.listShareRequests(tenantId, {
            status: status || undefined,
            allowedBrandIds: user.allowedBrandIds,
        });
    }

    @Post('share-requests/:id/cancel')
    @RequirePermission(Permissions.RIDER_SHARE_REQUEST)
    cancel(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        const tenantId = this.assertTenant(user);
        return this.sharing.cancelShareRequest(
            tenantId,
            id,
            user.id,
            user.allowedBrandIds,
        );
    }
}
