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
import { CategoriesService, CategoryFilters } from './categories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type CategoriesUser = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Categories')
@ApiBearerAuth()
@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class CategoriesController {
    constructor(private service: CategoriesService) {}

    @Get()
    index(
        @CurrentUser() user: CategoriesUser,
        @Query('brand_id') brandIdParam?: string,
        @Query('is_active') isActiveParam?: string,
        @Query('search') search?: string,
        @Query('sort') sort?: 'name' | 'sort_order' | 'created_at',
        @Query('order') order?: 'asc' | 'desc',
    ) {
        const filters: CategoryFilters = {};
        if (brandIdParam != null && brandIdParam !== '') {
            const n = parseInt(brandIdParam, 10);
            if (!Number.isNaN(n)) filters.brand_id = n;
        }
        if (isActiveParam !== undefined && isActiveParam !== '') {
            filters.is_active =
                isActiveParam === 'true' || isActiveParam === '1';
        }
        if (search?.trim()) filters.search = search.trim();
        if (sort) filters.sort = sort;
        if (order) filters.order = order;
        return this.service.findAll(
            user.tenantId,
            Object.keys(filters).length ? filters : undefined,
            user.allowedBrandIds,
        );
    }

    @Get(':id')
    show(@Param('id') id: string, @CurrentUser() user: CategoriesUser) {
        return this.service.findOne(+id, user.tenantId, user.allowedBrandIds);
    }

    @Post()
    store(
        @CurrentUser() user: CategoriesUser,
        @Body()
        dto: {
            brand_id: number;
            name: string;
            is_active?: boolean;
            sort_order?: number;
        },
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException(
                'Tenant context required to create categories',
            );
        return this.service.create(dto, user.tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: CategoriesUser,
        @Body()
        dto: { name?: string; is_active?: boolean; sort_order?: number },
    ) {
        return this.service.update(
            +id,
            dto,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    destroy(@Param('id') id: string, @CurrentUser() user: CategoriesUser) {
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
