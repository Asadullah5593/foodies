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
import { UsersService } from './users.service';
import { UpdateUserDto } from './update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class UsersController {
    constructor(private service: UsersService) {}

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
    @RequirePermission(Permissions.USERS_CREATE)
    store(
        @Body()
        dto: {
            name: string;
            email: string;
            password: string;
            phone?: string;
            branch_ids?: number[];
            tenant_id?: number;
            role?: string;
            role_id?: number;
            /** Home brand for the new user (owner/GM only; brand-locked admins use their own brand). */
            brand_id?: number;
        },
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        const tenantId = user.tenantId ?? dto.tenant_id ?? null;
        if (tenantId == null)
            throw new ForbiddenException(
                'Tenant required to create user. When creating users as super admin, provide tenant_id.',
            );
        return this.service.create(dto, tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.USERS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: UpdateUserDto,
    ) {
        const tenantId = user.tenantId;
        if (tenantId == null)
            throw new ForbiddenException(
                'Tenant context required to update user',
            );
        return this.service.update(
            +id,
            tenantId,
            dto,
            user.allowedBrandIds,
            user.id,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.USERS_DELETE)
    destroy(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        const tenantId = user.tenantId;
        if (tenantId == null)
            throw new ForbiddenException(
                'Tenant context required to delete user',
            );
        return this.service.remove(
            +id,
            tenantId,
            user.allowedBrandIds,
            user.id,
        );
    }
}
