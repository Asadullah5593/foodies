import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StaffDiscountsService } from './staff-discounts.service';
import type { StaffDiscountDto } from './staff-discounts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type StaffDiscountUser = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
    permissions?: string[];
    staffDiscountCeiling?: {
        maxPercent: number | null;
        maxAmount: number | null;
    };
};

@ApiTags('Admin – Staff Discounts')
@ApiBearerAuth()
@Controller('admin/staff-discounts')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class StaffDiscountsController {
    constructor(private service: StaffDiscountsService) {}

    @Get()
    @RequirePermission(Permissions.STAFF_DISCOUNTS_VIEW)
    index(
        @CurrentUser() user: StaffDiscountUser,
        @Query('active') active?: string,
    ) {
        return this.service.findAll(
            user.tenantId,
            active === '1' || active === 'true',
            user.allowedBrandIds,
        );
    }

    /**
     * The till's picker. Deliberately gated on `apply`, not `view`: a cashier
     * grants these without being able to see or edit the admin module. Returns
     * only what this user could actually be granted, so the POS never shows a
     * button that would be refused.
     */
    @Get('for-till')
    @RequirePermission(Permissions.STAFF_DISCOUNTS_APPLY)
    forTill(
        @CurrentUser() user: StaffDiscountUser,
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
        @Query('subtotal') subtotal?: string,
    ) {
        return this.service.findForTill(
            user.tenantId,
            user.staffDiscountCeiling ?? { maxPercent: 0, maxAmount: 0 },
            {
                branchId: branchId ? Number(branchId) : null,
                brandId: brandId ? Number(brandId) : null,
                subtotal: subtotal ? Number(subtotal) : null,
            },
        );
    }

    @Post()
    @RequirePermission(Permissions.STAFF_DISCOUNTS_CREATE)
    store(
        @CurrentUser() user: StaffDiscountUser,
        @Body() body: StaffDiscountDto,
    ) {
        return this.service.create(user.tenantId, body, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.STAFF_DISCOUNTS_EDIT)
    update(
        @CurrentUser() user: StaffDiscountUser,
        @Param('id') id: string,
        @Body() body: StaffDiscountDto,
    ) {
        return this.service.update(
            +id,
            user.tenantId,
            body,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.STAFF_DISCOUNTS_DELETE)
    remove(@CurrentUser() user: StaffDiscountUser, @Param('id') id: string) {
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
