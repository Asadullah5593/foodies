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
import { BannersService } from './banners.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – CMS Banners')
@ApiBearerAuth()
@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class BannersController {
    constructor(private service: BannersService) {}

    @Get()
    index(@CurrentUser() user: { tenantId: number | null }) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.findAll(user.tenantId);
    }

    @Post()
    @RequirePermission(Permissions.BANNERS_CREATE)
    store(
        @CurrentUser() user: { tenantId: number | null },
        @Body()
        dto: {
            title: string;
            subtitle?: string;
            image_url: string;
            link_url?: string;
            is_active?: boolean;
            sort_order?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(user.tenantId, dto);
    }

    @Put(':id')
    @RequirePermission(Permissions.BANNERS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
        @Body()
        dto: {
            title?: string;
            subtitle?: string;
            image_url?: string;
            link_url?: string;
            is_active?: boolean;
            sort_order?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(+id, user.tenantId, dto);
    }

    @Delete(':id')
    @RequirePermission(Permissions.BANNERS_DELETE)
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId);
    }
}
