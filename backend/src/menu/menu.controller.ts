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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Menu')
@ApiBearerAuth()
@Controller('admin/menu')
@UseGuards(JwtAuthGuard)
export class MenuController {
    constructor(private service: MenuService) {}

    @Get('categories')
    async categories(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getCategories(brandId, user.tenantId);
    }

    @Post('categories')
    async createCategory(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body() dto: { brand_id: number; name: string; is_active?: boolean },
    ) {
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createCategory(dto);
    }

    @Put('categories/:id')
    updateCategory(
        @Param('id') id: string,
        @Body()
        dto: { name?: string; is_active?: boolean; sort_order?: number },
    ) {
        return this.service.updateCategory(+id, dto);
    }

    @Delete('categories/:id')
    deleteCategory(@Param('id') id: string) {
        return this.service.deleteCategory(+id);
    }

    @Get('items')
    async items(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getItems(brandId, user.tenantId);
    }

    @Post('items')
    async createItem(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            brand_id: number;
            category_id: number;
            name: string;
            description?: string;
            base_price: number;
            is_active?: boolean;
        },
    ) {
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createItem(dto);
    }

    @Put('items/:id')
    async updateItem(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            description?: string;
            base_price?: number;
            is_active?: boolean;
            brand_id?: number;
            category_id?: number;
        },
    ) {
        if (dto.brand_id != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.updateItem(+id, dto);
    }

    @Delete('items/:id')
    deleteItem(@Param('id') id: string) {
        return this.service.deleteItem(+id);
    }

    @Post('items/:id/link-addons')
    linkAddons(@Param('id') id: string, @Body() body: { addon_ids: number[] }) {
        return this.service.linkAddons(+id, body.addon_ids ?? []);
    }

    @Get('addons')
    async addons(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('brand_id') brandIdParam: string,
        @Query('category_id') categoryId: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getAddons(
            brandId,
            categoryId ? +categoryId : undefined,
            user.tenantId,
        );
    }

    @Post('addons')
    async createAddon(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            brand_id: number;
            category_id?: number;
            name: string;
            price: number;
            is_active?: boolean;
        },
    ) {
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createAddon(dto);
    }

    @Put('addons/:id')
    async updateAddon(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            price?: number;
            is_active?: boolean;
            category_id?: number | null;
            brand_id?: number;
        },
    ) {
        if (dto.brand_id != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.updateAddon(+id, dto);
    }

    @Delete('addons/:id')
    deleteAddon(@Param('id') id: string) {
        return this.service.deleteAddon(+id);
    }

    @Get('variants')
    async variants(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('menu_item_id') menuItemId: string,
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        if (menuItemId) return this.service.getVariants(+menuItemId);
        return this.service.getVariantsForBrand(brandId, user.tenantId);
    }

    @Post('variants')
    createVariant(
        @Body()
        dto: {
            menu_item_id: number;
            name: string;
            price_modifier?: number;
            is_default?: boolean;
        },
    ) {
        return this.service.createVariant(dto);
    }

    @Put('variants/:id')
    updateVariant(
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            price_modifier?: number;
            is_default?: boolean;
            menu_item_id?: number;
        },
    ) {
        return this.service.updateVariant(+id, dto);
    }

    @Delete('variants/:id')
    deleteVariant(@Param('id') id: string) {
        return this.service.deleteVariant(+id);
    }
}
