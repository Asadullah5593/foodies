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
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Customers')
@ApiBearerAuth()
@Controller('admin/customers')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class CustomersController {
    constructor(private service: CustomersService) {}

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds);
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
        return this.service.findOne(+id, user.tenantId, user.allowedBrandIds);
    }

    @Post()
    @RequirePermission(Permissions.CUSTOMERS_CREATE)
    store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: { phone: string; name: string; link?: boolean },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(
            user.tenantId,
            dto,
            user.allowedBrandIds,
            dto.link,
        );
    }

    @Put(':id')
    @RequirePermission(Permissions.CUSTOMERS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: { name?: string },
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
    @RequirePermission(Permissions.CUSTOMERS_DELETE)
    async remove(
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
        await this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
