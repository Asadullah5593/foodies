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
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DiscountsService } from './discounts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Discounts')
@ApiBearerAuth()
@Controller('admin/discounts')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class DiscountsController {
    constructor(private service: DiscountsService) {}

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        // The "Discounts" surface owns order/category/brand/branch auto discounts.
        // Product promotions, coupons and bank card offers each have their own
        // module — a card's discount lives on the card itself.
        return this.service.findAll(user.tenantId, user.allowedBrandIds, [
            'discount',
        ]);
    }

    /**
     * The till's picker: offers a cashier may switch on for one cart. Gated on
     * `orders:apply-manual-offer`, NOT on discounts:view — a cashier applies
     * these without any access to the admin module.
     *
     * Whether the cart actually qualifies is the pricing engine's job; this only
     * says which offers are offerable here at all.
     */
    @Get('for-till')
    @RequirePermission(Permissions.ORDERS_APPLY_MANUAL_OFFER)
    forTill(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
    ) {
        return this.service.findManualForTill(
            user.tenantId,
            user.allowedBrandIds,
            {
                branchId: branchId ? Number(branchId) : null,
                brandId: brandId ? Number(brandId) : null,
            },
        );
    }

    @Post()
    @RequirePermission(Permissions.DISCOUNTS_CREATE)
    store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            name: string;
            code?: string;
            type: string;
            value: number;
            min_order_amount?: number;
            max_discount_amount?: number;
            pos_only?: boolean;
            channels?: string[] | null;
            allowed_roles?: string[];
            requires_code?: boolean;
            application_scope?: string;
            application_scope_ids?: number[];
            eligibility_branch_ids?: number[];
            eligibility_brand_ids?: number[];
            is_active?: boolean;
            valid_from?: string;
            valid_until?: string;
            valid_time_start?: string | null;
            valid_time_end?: string | null;
            valid_days_of_week?: number[] | null;
            buy_quantity?: number | null;
            get_quantity?: number | null;
            get_discount_percent?: number | null;
            bogo_match_same_group?: boolean;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(dto, user.tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.DISCOUNTS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            name?: string;
            code?: string;
            type?: string;
            value?: number;
            min_order_amount?: number;
            max_discount_amount?: number;
            pos_only?: boolean;
            channels?: string[] | null;
            allowed_roles?: string[];
            requires_code?: boolean;
            application_scope?: string;
            application_scope_ids?: number[];
            eligibility_branch_ids?: number[];
            eligibility_brand_ids?: number[];
            is_active?: boolean;
            valid_from?: string;
            valid_until?: string;
            valid_time_start?: string | null;
            valid_time_end?: string | null;
            valid_days_of_week?: number[] | null;
            buy_quantity?: number | null;
            get_quantity?: number | null;
            get_discount_percent?: number | null;
            bogo_match_same_group?: boolean;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(
            +id,
            user.tenantId,
            dto,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.DISCOUNTS_DELETE)
    destroy(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
