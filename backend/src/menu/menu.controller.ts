import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody, ApiOperation } from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type MenuUser = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Menu')
@ApiBearerAuth()
@Controller('admin/menu')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class MenuController {
    constructor(private service: MenuService) {}

    /**
     * Resolve the effective brand filter for list/create endpoints.
     * Brand-locked users may only address their own brand; with no explicit
     * brand_id their single locked brand is used.
     */
    private resolveBrandScope(
        user: MenuUser,
        brandId: number | null,
    ): number | null {
        const allowed = user.allowedBrandIds;
        if (allowed == null) return brandId;
        if (brandId != null) {
            if (!allowed.includes(brandId)) {
                throw new ForbiddenException(
                    'You do not have access to this brand',
                );
            }
            return brandId;
        }
        if (allowed.length === 1) return allowed[0];
        throw new ForbiddenException(
            'brand_id is required for brand-locked accounts',
        );
    }

    /** Throw unless the menu entity belongs to one of the user's brands. */
    private async assertEntityBrand(
        user: MenuUser,
        kind:
            | 'category'
            | 'item'
            | 'addon'
            | 'variant'
            | 'modifier-group'
            | 'modifier',
        id: number,
    ): Promise<void> {
        if (user.allowedBrandIds == null) return;
        const brandId = await this.service.getEntityBrandId(kind, id);
        if (brandId == null || !user.allowedBrandIds.includes(brandId)) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
    }

    @Get('categories')
    async categories(
        @CurrentUser() user: MenuUser,
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getCategories(brandId, user.tenantId);
    }

    @Post('categories')
    async createCategory(
        @CurrentUser() user: MenuUser,
        @Body() dto: { brand_id: number; name: string; is_active?: boolean },
    ) {
        this.resolveBrandScope(user, dto.brand_id);
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createCategory(dto);
    }

    @Put('categories/:id')
    async updateCategory(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body()
        dto: { name?: string; is_active?: boolean; sort_order?: number },
    ) {
        await this.assertEntityBrand(user, 'category', +id);
        return this.service.updateCategory(+id, dto);
    }

    @Delete('categories/:id')
    async deleteCategory(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
    ) {
        await this.assertEntityBrand(user, 'category', +id);
        return this.service.deleteCategory(+id);
    }

    @Get('items')
    async items(
        @CurrentUser() user: MenuUser,
        @Query('brand_id') brandIdParam: string,
        @Query('category_id') categoryIdParam: string,
        @Query('is_active') isActiveParam: string,
        @Query('search') searchParam: string,
    ) {
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
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
                gallery_image_urls: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
                    description:
                        'Optional extra photos (max 12, unique URLs). Consumer website: gallery/slider below the main image. POS/menu grids: main thumbnail only (`image_url`).',
                },
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
        @CurrentUser() user: MenuUser,
        @Body()
        dto: {
            brand_id: number;
            category_id: number;
            name: string;
            description?: string;
            base_price: number;
            is_active?: boolean;
            image_url?: string | null;
            gallery_image_urls?: string[] | null;
            deal_only?: boolean;
            available_for_order_types?: string[] | null;
            allergens?: string[] | null;
            calories?: number | null;
            available_time_start?: string | null;
            available_time_end?: string | null;
            available_days_of_week?: number[] | null;
        },
    ) {
        this.resolveBrandScope(user, dto.brand_id);
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
                gallery_image_urls: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
                    description:
                        'Replaces the full gallery list (max 12). Send [] to clear. Omit to leave gallery unchanged.',
                },
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
        @CurrentUser() user: MenuUser,
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
            gallery_image_urls?: string[] | null;
            deal_only?: boolean;
            available_for_order_types?: string[] | null;
            allergens?: string[] | null;
            calories?: number | null;
            available_time_start?: string | null;
            available_time_end?: string | null;
            available_days_of_week?: number[] | null;
        },
    ) {
        await this.assertEntityBrand(user, 'item', +id);
        if (dto.brand_id != null) this.resolveBrandScope(user, dto.brand_id);
        if (dto.brand_id != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.updateItem(+id, dto);
    }

    @Delete('items/:id')
    async deleteItem(@CurrentUser() user: MenuUser, @Param('id') id: string) {
        await this.assertEntityBrand(user, 'item', +id);
        return this.service.deleteItem(+id);
    }

    @Post('items/:id/link-addons')
    async linkAddons(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body() body: { addon_ids: number[] },
    ) {
        await this.assertEntityBrand(user, 'item', +id);
        return this.service.linkAddons(+id, body.addon_ids ?? []);
    }

    @Get('addons')
    async addons(
        @CurrentUser() user: MenuUser,
        @Query('brand_id') brandIdParam: string,
        @Query('category_id') categoryId: string,
        @Query('search') searchParam: string,
        @Query('is_active') isActiveParam: string,
    ) {
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
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
        @CurrentUser() user: MenuUser,
        @Body()
        dto: {
            brand_id: number;
            category_id?: number;
            name: string;
            price: number;
            is_active?: boolean;
        },
    ) {
        this.resolveBrandScope(user, dto.brand_id);
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createAddon(dto);
    }

    @Put('addons/:id')
    async updateAddon(
        @CurrentUser() user: MenuUser,
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
        await this.assertEntityBrand(user, 'addon', +id);
        if (dto.brand_id != null) this.resolveBrandScope(user, dto.brand_id);
        if (dto.brand_id != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.updateAddon(+id, dto);
    }

    @Delete('addons/:id')
    async deleteAddon(@CurrentUser() user: MenuUser, @Param('id') id: string) {
        await this.assertEntityBrand(user, 'addon', +id);
        return this.service.deleteAddon(+id);
    }

    @Get('variants')
    async variants(
        @CurrentUser() user: MenuUser,
        @Query('menu_item_id') menuItemId: string,
        @Query('brand_id') brandIdParam: string,
    ) {
        if (menuItemId) {
            await this.assertEntityBrand(user, 'item', +menuItemId);
            return this.service.getVariants(+menuItemId);
        }
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getVariantsForBrand(brandId, user.tenantId);
    }

    @Post('variants')
    async createVariant(
        @CurrentUser() user: MenuUser,
        @Body()
        dto: {
            menu_item_id: number;
            name: string;
            price_modifier?: number;
            is_default?: boolean;
            sort_order?: number;
            size_key?: string | null;
        },
    ) {
        await this.assertEntityBrand(user, 'item', dto.menu_item_id);
        return this.service.createVariant(dto);
    }

    @Put('variants/:id')
    async updateVariant(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            price_modifier?: number;
            is_default?: boolean;
            menu_item_id?: number;
            sort_order?: number;
            size_key?: string | null;
        },
    ) {
        await this.assertEntityBrand(user, 'variant', +id);
        if (dto.menu_item_id != null)
            await this.assertEntityBrand(user, 'item', dto.menu_item_id);
        return this.service.updateVariant(+id, dto);
    }

    @Delete('variants/:id')
    async deleteVariant(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
    ) {
        await this.assertEntityBrand(user, 'variant', +id);
        return this.service.deleteVariant(+id);
    }

    @Get('modifier-groups')
    async modifierGroups(
        @CurrentUser() user: MenuUser,
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
        if (brandId != null && user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getModifierGroups(brandId, user.tenantId);
    }

    @Post('modifier-groups')
    async createModifierGroup(
        @CurrentUser() user: MenuUser,
        @Body()
        dto: {
            brand_id: number;
            name: string;
            min_select?: number;
            max_select?: number;
            included_quantity?: number;
            included_by_size?: Record<string, number> | null;
            allow_quantity?: boolean;
            price_tiers?: Record<string, number> | null;
        },
    ) {
        this.resolveBrandScope(user, dto.brand_id);
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                dto.brand_id,
                user.tenantId,
            );
        return this.service.createModifierGroup(dto);
    }

    @Patch('modifier-groups/reorder')
    async reorderModifierGroups(
        @CurrentUser() user: MenuUser,
        @Body() body: { brand_id: number; ordered_ids: number[] },
    ) {
        this.resolveBrandScope(user, body.brand_id);
        return this.service.reorderModifierGroups(body.brand_id, body.ordered_ids ?? []);
    }

    @Patch('items/:itemId/reorder-modifier-groups')
    async reorderItemModifierGroups(
        @CurrentUser() user: MenuUser,
        @Param('itemId') itemId: string,
        @Body() body: { ordered_ids: number[] },
    ) {
        return this.service.reorderItemModifierGroups(
            +itemId,
            body.ordered_ids ?? [],
            user.allowedBrandIds ?? null,
        );
    }

    @Put('modifier-groups/:id')
    async updateModifierGroup(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            min_select?: number;
            max_select?: number;
            included_quantity?: number;
            included_by_size?: Record<string, number> | null;
            allow_quantity?: boolean;
            price_tiers?: Record<string, number> | null;
        },
    ) {
        await this.assertEntityBrand(user, 'modifier-group', +id);
        return this.service.updateModifierGroup(+id, dto);
    }

    @Delete('modifier-groups/:id')
    async deleteModifierGroup(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
    ) {
        await this.assertEntityBrand(user, 'modifier-group', +id);
        return this.service.deleteModifierGroup(+id);
    }

    @Get('modifiers')
    async modifiers(
        @CurrentUser() user: MenuUser,
        @Query('modifier_group_id') modifierGroupIdParam: string,
        @Query('brand_id') brandIdParam: string,
    ) {
        const modifierGroupId = modifierGroupIdParam
            ? +modifierGroupIdParam
            : null;
        if (modifierGroupId != null) {
            await this.assertEntityBrand(
                user,
                'modifier-group',
                modifierGroupId,
            );
        }
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
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
        @CurrentUser() user: MenuUser,
        @Body()
        dto: {
            modifier_group_id: number;
            name: string;
            price?: number;
            price_by_size?: Record<string, number> | null;
            available_for_sizes?: string[] | null;
        },
    ) {
        await this.assertEntityBrand(
            user,
            'modifier-group',
            dto.modifier_group_id,
        );
        if (user.tenantId != null)
            await this.service.assertModifierGroupBelongsToTenant(
                dto.modifier_group_id,
                user.tenantId,
            );
        return this.service.createModifier(dto);
    }

    @Put('modifiers/:id')
    async updateModifier(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            price?: number;
            price_by_size?: Record<string, number> | null;
            available_for_sizes?: string[] | null;
        },
    ) {
        await this.assertEntityBrand(user, 'modifier', +id);
        return this.service.updateModifier(+id, dto);
    }

    @Delete('modifiers/:id')
    async deleteModifier(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
    ) {
        await this.assertEntityBrand(user, 'modifier', +id);
        return this.service.deleteModifier(+id);
    }

    @Patch('modifier-groups/:groupId/reorder')
    async reorderModifiers(
        @Param('groupId') groupId: string,
        @Body() body: { ordered_ids: number[] },
    ) {
        return this.service.reorderModifiers(+groupId, body.ordered_ids ?? []);
    }

    @Post('items/:id/link-modifier-groups')
    async linkModifierGroups(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body() body: { modifier_group_ids: number[] },
    ) {
        await this.assertEntityBrand(user, 'item', +id);
        return this.service.linkModifierGroups(
            +id,
            body.modifier_group_ids ?? [],
        );
    }

    @Get('deals')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.DEALS_VIEW)
    async listDeals(
        @CurrentUser() user: MenuUser,
        @Query('brand_id') brandIdParam: string,
    ) {
        const brandId = this.resolveBrandScope(
            user,
            brandIdParam ? +brandIdParam : null,
        );
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
        @CurrentUser() user: MenuUser,
        @Param('menuItemId') menuItemIdParam: string,
    ) {
        const menuItemId = +menuItemIdParam;
        await this.assertEntityBrand(user, 'item', menuItemId);
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
        @CurrentUser() user: MenuUser,
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
                slot_surcharges?: Record<string, number> | null;
            }>;
        },
    ) {
        const menuItemId = +menuItemIdParam;
        await this.assertEntityBrand(user, 'item', menuItemId);
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
        @CurrentUser() user: MenuUser,
        @Param('menuItemId') menuItemIdParam: string,
    ) {
        const menuItemId = +menuItemIdParam;
        await this.assertEntityBrand(user, 'item', menuItemId);
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
