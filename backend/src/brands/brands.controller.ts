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

@ApiTags('Admin – Brands')
@ApiBearerAuth()
@Controller('admin/brands')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BrandsController {
    constructor(private service: BrandsService) {}

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
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException(
                'Super admin cannot create brands; use a tenant user.',
            );
        return this.service.create(dto, user.tenantId);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            name?: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
        },
    ) {
        return this.service.updateForAdmin(+id, user.tenantId, dto);
    }

    @Delete(':id')
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.removeForAdmin(+id, user.tenantId);
    }
}
