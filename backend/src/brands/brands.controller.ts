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
import { BrandsService } from './brands.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Brands')
@ApiBearerAuth()
@Controller('admin/brands')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BrandsController {
    constructor(private service: BrandsService) {}

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.findAllForAdmin(
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.findOneForAdmin(
            +id,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Post()
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_MANAGE)
    store(
        @Body()
        dto: {
            name: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
            delivery_flat_fee?: number;
        },
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException(
                'Super admin cannot create brands; use a tenant user.',
            );
        if (user.allowedBrandIds != null)
            throw new ForbiddenException(
                'Brand-locked accounts cannot create brands',
            );
        return this.service.create(dto, user.tenantId);
    }

    @Put(':id')
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
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
            delivery_flat_fee?: number;
        },
    ) {
        // Brand admins configure their OWN brand (delivery fee, logo, …);
        // any other brand is off-limits. Unlocked users are owner/GM level
        // (tenant-scoped in the service).
        if (
            user.allowedBrandIds != null &&
            !user.allowedBrandIds.includes(+id)
        ) {
            throw new ForbiddenException('You can only manage your own brand');
        }
        return this.service.updateForAdmin(+id, user.tenantId, dto);
    }

    @Delete(':id')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_MANAGE)
    destroy(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.allowedBrandIds != null)
            throw new ForbiddenException(
                'Brand-locked accounts cannot delete brands',
            );
        return this.service.removeForAdmin(+id, user.tenantId);
    }
}
