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
import { PromotionsService } from './promotions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Promotions')
@ApiBearerAuth()
@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class PromotionsController {
    constructor(private service: PromotionsService) {}

    @Get()
    index(@CurrentUser() user: { tenantId: number | null }) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.findAll(user.tenantId);
    }

    @Post()
    @RequirePermission(Permissions.PROMOTIONS_CREATE)
    store(
        @CurrentUser() user: { tenantId: number | null },
        @Body()
        dto: {
            name: string;
            description?: string;
            image_url?: string;
            promotion_type: string;
            discount_type?: string;
            discount_value?: number;
            free_menu_item_id?: number;
            eligibility_type?: string;
            is_active?: boolean;
            expires_in_days?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(user.tenantId, dto);
    }

    @Put(':id')
    @RequirePermission(Permissions.PROMOTIONS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
        @Body()
        dto: {
            name?: string;
            description?: string;
            image_url?: string;
            is_active?: boolean;
            expires_in_days?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(+id, user.tenantId, dto);
    }

    @Delete(':id')
    @RequirePermission(Permissions.PROMOTIONS_DELETE)
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId);
    }

    @Get(':id/assignments')
    assignments(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.getAssignments(+id, user.tenantId);
    }

    @Post(':id/assign')
    @RequirePermission(Permissions.PROMOTIONS_EDIT)
    assign(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
        @Body() dto: { customer_id: number },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.manualAssign(+id, dto.customer_id, user.tenantId);
    }
}
