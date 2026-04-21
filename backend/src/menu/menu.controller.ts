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
    NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody, ApiOperation } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Menu')
@ApiBearerAuth()
@Controller('admin/menu')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
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
        @Query('category_id') categoryIdParam: string,
        @Query('is_active') isActiveParam: string,
        @Query('search') searchParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        const categoryId = categoryIdParam ? +categoryIdParam : undefined;
        const isActive =
            isActiveParam === 'true'
                ? true
                : isActiveParam === 'false'
                  ? false
                  : undefined;
        const search = searchParam?.trim() || undefined;
        return this.service.getItems(brandId, user.tenantId, {
            category_id: categoryId,
            is_active: isActive,
            search,
        });
    }

    @Post('items')
    @ApiOperation({
        summary: 'Create menu item',
        description:
            'Optional `available_for_order_types` limits which order channels can include this item (delivery, pickup, dine_in). Omit or null = all channels.',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['brand_id', 'category_id', 'name', 'base_price'],
            properties: {
                brand_id: { type: 'number' },
                category_id: { type: 'number' },
                name: { type: 'string' },
                description: { type: 'string' },
                base_price: { type: 'number' },
                is_active: { type: 'boolean' },
                image_url: { type: 'string', nullable: true },
                deal_only: { type: 'boolean' },
                available_for_order_types: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['delivery', 'pickup', 'dine_in'],
                    },
                    description:
                        'Which channels may order this item. `takeaway` in requests is normalized to `pickup`. At least one channel required when provided.',
                    example: ['delivery', 'dine_in'],
                },
            },
        },
    })
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
            image_url?: string | null;
            deal_only?: boolean;
            available_for_order_types?: string[] | null;
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
    @ApiOperation({
        summary: 'Update menu item',
        description:
            'Set `available_for_order_types` to restrict channels, or `null` to mean all channels.',
    })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                base_price: { type: 'number' },
                is_active: { type: 'boolean' },
                brand_id: { type: 'number' },
                category_id: { type: 'number' },
                image_url: { type: 'string', nullable: true },
                deal_only: { type: 'boolean' },
                available_for_order_types: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['delivery', 'pickup', 'dine_in'],
                    },
                    nullable: true,
                    description:
                        'Null = all channels. Omit field to leave unchanged.',
                },
            },
        },
    })
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
            image_url?: string | null;
            deal_only?: boolean;
            available_for_order_types?: string[] | null;
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
        @Query('search') searchParam: string,
        @Query('is_active') isActiveParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        const search = searchParam?.trim() || undefined;
        const isActive =
            isActiveParam === 'true'
                ? true
                : isActiveParam === 'false'
                  ? false
                  : undefined;
        return this.service.getAddons(
            brandId,
            categoryId ? +categoryId : undefined,
            user.tenantId,
            search,
            isActive,
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
            sort_order?: number;
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
            sort_order?: number;
        },
    ) {
        return this.service.updateVariant(+id, dto);
    }

    @Delete('variants/:id')
    deleteVariant(@Param('id') id: string) {
        return this.service.deleteVariant(+id);
    }

    @Get('modifier-groups')
    async modifierGroups(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getModifierGroups(brandId, user.tenantId);
    }

    @Post('modifier-groups')
    async createModifierGroup(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            brand_id: number;
            name: string;
            min_select?: number;
            max_select?: number;
        },
    ) {
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createModifierGroup(dto);
    }

    @Put('modifier-groups/:id')
    async updateModifierGroup(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('id') id: string,
        @Body()
        dto: { name?: string; min_select?: number; max_select?: number },
    ) {
        return this.service.updateModifierGroup(+id, dto);
    }

    @Delete('modifier-groups/:id')
    deleteModifierGroup(@Param('id') id: string) {
        return this.service.deleteModifierGroup(+id);
    }

    @Get('modifiers')
    async modifiers(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('modifier_group_id') modifierGroupIdParam: string,
        @Query('brand_id') brandIdParam: string,
    ) {
        const modifierGroupId = modifierGroupIdParam
            ? +modifierGroupIdParam
            : null;
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getModifiers(
            modifierGroupId,
            brandId,
            user.tenantId,
        );
    }

    @Post('modifiers')
    async createModifier(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: { modifier_group_id: number; name: string; price?: number },
    ) {
        if (user.tenantId != null)
            await this.service.assertModifierGroupBelongsToTenant(
                dto.modifier_group_id,
                user.tenantId,
            );
        return this.service.createModifier(dto);
    }

    @Put('modifiers/:id')
    updateModifier(
        @Param('id') id: string,
        @Body() dto: { name?: string; price?: number },
    ) {
        return this.service.updateModifier(+id, dto);
    }

    @Delete('modifiers/:id')
    deleteModifier(@Param('id') id: string) {
        return this.service.deleteModifier(+id);
    }

    @Post('items/:id/link-modifier-groups')
    async linkModifierGroups(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('id') id: string,
        @Body() body: { modifier_group_ids: number[] },
    ) {
        return this.service.linkModifierGroups(
            +id,
            body.modifier_group_ids ?? [],
        );
    }

    @Get('deals')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.DEALS_VIEW)
    async listDeals(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : null;
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.listDeals(brandId, user.tenantId);
    }

    @Get('deals/:menuItemId')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.DEALS_VIEW)
    async getDeal(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('menuItemId') menuItemIdParam: string,
    ) {
        const menuItemId = +menuItemIdParam;
        const item = await this.service.findMenuItem(menuItemId);
        if (!item) return null;
        if (user.tenantId != null) {
            const brandId =
                (item as { brandId?: number }).brandId ??
                (item as { brand?: { id: number } }).brand?.id;
            if (brandId != null)
                await this.service.assertBrandBelongsToTenant(
                    brandId,
                    user.tenantId,
                );
        }
        return this.service.getDealForAdmin(menuItemId);
    }

    @Put('deals/:menuItemId')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.DEALS_EDIT)
    async saveDeal(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('menuItemId') menuItemIdParam: string,
        @Body()
        body: {
            slots: Array<{
                slot_index: number;
                type: 'fixed' | 'choice_category' | 'choice_list';
                source_menu_item_id?: number | null;
                source_category_id?: number | null;
                source_menu_item_ids?: number[] | null;
                quantity: number;
                allow_customization: boolean;
            }>;
        },
    ) {
        const menuItemId = +menuItemIdParam;
        const item = await this.service.findMenuItem(menuItemId);
        if (!item) return null;
        if (user.tenantId != null) {
            const brandId =
                (item as { brandId?: number }).brandId ??
                (item as { brand?: { id: number } }).brand?.id;
            if (brandId != null)
                await this.service.assertBrandBelongsToTenant(
                    brandId,
                    user.tenantId,
                );
        }
        return this.service.saveDealComponents(menuItemId, body.slots ?? []);
    }

    @Delete('deals/:menuItemId')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.DEALS_DELETE)
    async deleteDeal(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('menuItemId') menuItemIdParam: string,
    ) {
        const menuItemId = +menuItemIdParam;
        const item = await this.service.findMenuItem(menuItemId);
        if (!item) throw new NotFoundException('Menu item not found');
        if (user.tenantId != null) {
            const brandId =
                (item as { brandId?: number }).brandId ??
                (item as { brand?: { id: number } }).brand?.id;
            if (brandId != null)
                await this.service.assertBrandBelongsToTenant(
                    brandId,
                    user.tenantId,
                );
        }
        return this.service.deleteDealComponents(menuItemId);
    }
}
