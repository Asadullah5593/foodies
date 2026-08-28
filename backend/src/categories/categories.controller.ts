import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    Patch,
    UseGuards,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiQuery,
} from '@nestjs/swagger';
import { CategoriesService, CategoryFilters } from './categories.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type CategoriesUser = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Categories')
@ApiBearerAuth()
@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
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

    // Declared above @Get(':id') — otherwise the param route swallows it.
    @Get('sort-order-map')
    @RequirePermission(Permissions.CATEGORIES_EDIT)
    @ApiOperation({
        summary: "Sort orders already used in a brand's categories",
        description:
            'Feeds the admin hint "1-5 taken · suggested 6". `taken` excludes 0, which means "not yet numbered".',
    })
    @ApiQuery({ name: 'brand_id', required: true, example: '1' })
    sortOrderMap(
        @CurrentUser() user: CategoriesUser,
        @Query('brand_id') brandIdParam?: string,
    ) {
        const brandId = brandIdParam ? parseInt(brandIdParam, 10) : NaN;
        if (!Number.isFinite(brandId)) {
            throw new BadRequestException('brand_id is required');
        }
        if (
            user.allowedBrandIds != null &&
            !user.allowedBrandIds.includes(brandId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        return this.service.sortOrderMap(brandId, user.tenantId);
    }

    @Patch('reorder')
    @RequirePermission(Permissions.CATEGORIES_EDIT)
    @ApiOperation({
        summary: "Reorder a brand's categories",
        description:
            'Rewrites the brand to a contiguous 1..N in the order given. Ids from other brands are ignored.',
    })
    reorder(
        @CurrentUser() user: CategoriesUser,
        @Body() body: { brand_id: number; ordered_ids: number[] },
    ) {
        return this.service.reorder(
            body.brand_id,
            body.ordered_ids ?? [],
            user.tenantId,
            user.allowedBrandIds ?? null,
        );
    }

    @Get(':id')
    show(@Param('id') id: string, @CurrentUser() user: CategoriesUser) {
        return this.service.findOne(+id, user.tenantId, user.allowedBrandIds);
    }

    @Post()
    @RequirePermission(Permissions.CATEGORIES_CREATE)
    store(
        @CurrentUser() user: CategoriesUser,
        @Body()
        dto: {
            brand_id: number;
            name: string;
            is_active?: boolean;
            sort_order?: number;
            description?: string | null;
            image_url?: string | null;
        },
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException(
                'Tenant context required to create categories',
            );
        return this.service.create(dto, user.tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.CATEGORIES_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser() user: CategoriesUser,
        @Body()
        dto: {
            name?: string;
            is_active?: boolean;
            sort_order?: number;
            description?: string | null;
            image_url?: string | null;
        },
    ) {
        return this.service.update(
            +id,
            dto,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.CATEGORIES_DELETE)
    destroy(@Param('id') id: string, @CurrentUser() user: CategoriesUser) {
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
