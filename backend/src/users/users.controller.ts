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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
    constructor(private service: UsersService) {}

    @Get()
    index(@CurrentUser() user: { id: number; tenantId: number | null }) {
        return this.service.findAllForAdmin(user.tenantId);
    }

    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.findOneForAdmin(+id, user.tenantId);
    }

    @Post()
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
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        const tenantId = user.tenantId ?? dto.tenant_id ?? null;
        if (tenantId == null)
            throw new ForbiddenException(
                'Tenant required to create user. When creating users as super admin, provide tenant_id.',
            );
        return this.service.create(dto, tenantId);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            name?: string;
            email?: string;
            password?: string;
            phone?: string;
            status?: string;
            branch_ids?: number[];
            role_id?: number;
        },
    ) {
        const tenantId = user.tenantId;
        if (tenantId == null)
            throw new ForbiddenException(
                'Tenant context required to update user',
            );
        return this.service.update(+id, tenantId, dto);
    }

    @Delete(':id')
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        const tenantId = user.tenantId;
        if (tenantId == null)
            throw new ForbiddenException(
                'Tenant context required to delete user',
            );
        return this.service.remove(+id, tenantId);
    }
}
