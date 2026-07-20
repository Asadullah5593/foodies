import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
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

type User = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

type PromoBody = {
    name: string;
    type?: string;
    value: number;
    application_scope_ids: number[];
    max_discount_amount?: number;
    eligibility_branch_ids?: number[];
    eligibility_brand_ids?: number[];
    is_active?: boolean;
    valid_from?: string;
    valid_until?: string;
    valid_time_start?: string | null;
    valid_time_end?: string | null;
    valid_days_of_week?: number[] | null;
    priority?: number;
    funding?: string;
    channels?: string[] | null;
};

/**
 * Product promotions = auto price cuts scoped to specific product(s). A thin
 * facade over DiscountsService that pins offer_kind='product_promotion',
 * application_scope='products' and requires_code=false.
 */
@ApiTags('Admin – Product Promotions')
@ApiBearerAuth()
@Controller('admin/product-promotions')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class ProductPromotionsController {
    constructor(private service: DiscountsService) {}

    @Get()
    index(@CurrentUser() user: User) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds, [
            'product_promotion',
        ]);
    }

    @Post()
    @RequirePermission(Permissions.PRODUCT_PROMOTIONS_CREATE)
    store(@CurrentUser() user: User, @Body() dto: PromoBody) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(
            {
                ...dto,
                type: dto.type ?? 'percentage',
                requires_code: false,
                application_scope: 'products',
                offer_kind: 'product_promotion',
            },
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Put(':id')
    @RequirePermission(Permissions.PRODUCT_PROMOTIONS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: Partial<PromoBody>,
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(
            +id,
            user.tenantId,
            { ...dto, application_scope: 'products' },
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.PRODUCT_PROMOTIONS_DELETE)
    destroy(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
