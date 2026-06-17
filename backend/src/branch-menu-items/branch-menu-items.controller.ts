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
import { BranchMenuItemsService } from './branch-menu-items.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Branch Menu Items')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BranchMenuItemsController {
    constructor(private service: BranchMenuItemsService) {}

    @Get('branch-menu-items')
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
    ) {
        if (branchId)
            return this.service.findAll(+branchId, user.allowedBrandIds);
        return this.service.findAllForAdmin(
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Post('branch-menu-items')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_MENU_MANAGE)
    store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            branch_id: number;
            menu_item_id: number;
            price_override?: number;
            is_enabled?: boolean;
            is_hidden_online?: boolean;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        if (!dto.menu_item_id) return { message: 'menu_item_id is required' };
        return this.service.linkBrandMenuItem(
            {
                branch_id: dto.branch_id,
                menu_item_id: dto.menu_item_id,
                price_override: dto.price_override,
                is_enabled: dto.is_enabled,
                is_hidden_online: dto.is_hidden_online,
            },
            user.allowedBrandIds,
        );
    }

    @Put('branch-menu-items/sync')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_MENU_MANAGE)
    sync(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: { branch_id: number; menu_item_ids: number[] },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.sync(
            dto.branch_id,
            dto.menu_item_ids ?? [],
            user.allowedBrandIds,
        );
    }

    @Put('branch-menu-items/:id')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_MENU_MANAGE)
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
            price_override?: number | null;
            is_enabled?: boolean;
            is_hidden_online?: boolean;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(+id, dto, user.allowedBrandIds);
    }

    @Delete('branch-menu-items/:id')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_MENU_MANAGE)
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
        return this.service.remove(+id, user.allowedBrandIds);
    }
}
