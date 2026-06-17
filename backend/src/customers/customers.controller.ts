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

@ApiTags('Admin – Customers')
@ApiBearerAuth()
@Controller('admin/customers')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
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
    store(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body() dto: { phone: string; name: string },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(user.tenantId, dto);
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
