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
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiBody,
    ApiOperation,
    ApiQuery,
} from '@nestjs/swagger';
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
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
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
    @RequirePermission(Permissions.CATEGORIES_CREATE)
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
    @RequirePermission(Permissions.CATEGORIES_EDIT)
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
    @RequirePermission(Permissions.CATEGORIES_DELETE)
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

    @Get('items/sort-order-map')
    @RequirePermission(Permissions.MENU_EDIT)
    @ApiOperation({
        summary: 'Sort orders already used in a brand + category',
        description:
            'Feeds the admin hint "1-5 taken · suggested 6". `taken` excludes 0, which means "not yet numbered".',
    })
    @ApiQuery({ name: 'brand_id', required: true, example: '1' })
    @ApiQuery({ name: 'category_id', required: true, example: '4' })
    async getItemSortOrderMap(
        @CurrentUser() user: MenuUser,
        @Query('brand_id') brandIdParam: string,
        @Query('category_id') categoryIdParam: string,
    ) {
        const brandId = brandIdParam ? +brandIdParam : NaN;
        const categoryId = categoryIdParam ? +categoryIdParam : NaN;
        if (!Number.isFinite(brandId) || !Number.isFinite(categoryId)) {
            throw new BadRequestException(
                'brand_id and category_id are required',
            );
        }
        this.resolveBrandScope(user, brandId);
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                brandId,
                user.tenantId,
            );
        return this.service.getItemSortOrderMap(brandId, categoryId);
    }

    @Patch('items/reorder')
    @RequirePermission(Permissions.MENU_EDIT)
    @ApiOperation({
        summary: 'Reorder menu items within a brand + category',
        description:
            'Rewrites the category to a contiguous 1..N in the order given. Ids outside this brand+category are ignored.',
    })
    async reorderItems(
        @CurrentUser() user: MenuUser,
        @Body()
        body: { brand_id: number; category_id: number; ordered_ids: number[] },
    ) {
        this.resolveBrandScope(user, body.brand_id);
        if (user.tenantId != null)
            await this.service.assertBrandBelongsToTenant(
                body.brand_id,
                user.tenantId,
            );
        return this.service.reorderItems(
            body.brand_id,
            body.category_id,
            body.ordered_ids ?? [],
        );
    }

    @Post('items')
    @RequirePermission(Permissions.MENU_CREATE)
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
                sort_order: {
                    type: 'integer',
                    minimum: 0,
                    description:
                        'Manual position within the category (1 = first). 0 means not yet numbered, and sorts last. Unique within brand + category; a clash returns 409.',
                },
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
            label?: string | null;
            available_time_start?: string | null;
            available_time_end?: string | null;
            available_days_of_week?: number[] | null;
            sort_order?: number | null;
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
    @RequirePermission(Permissions.MENU_EDIT)
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
                sort_order: {
                    type: 'integer',
                    minimum: 0,
                    description:
                        'Manual position within the category (1 = first). 0 means not yet numbered, and sorts last. Unique within brand + category; a clash returns 409.',
                },
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
            label?: string | null;
            available_time_start?: string | null;
            available_time_end?: string | null;
            available_days_of_week?: number[] | null;
            sort_order?: number | null;
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
    @RequirePermission(Permissions.MENU_DELETE)
    async deleteItem(@CurrentUser() user: MenuUser, @Param('id') id: string) {
        await this.assertEntityBrand(user, 'item', +id);
        return this.service.deleteItem(+id);
    }

    @Post('items/:id/link-addons')
    @RequirePermission(Permissions.MENU_EDIT)
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
    @RequirePermission(Permissions.ADDONS_CREATE)
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
    @RequirePermission(Permissions.ADDONS_EDIT)
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
    @RequirePermission(Permissions.ADDONS_DELETE)
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
    @RequirePermission(Permissions.VARIANTS_CREATE)
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
    @RequirePermission(Permissions.VARIANTS_EDIT)
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
    @RequirePermission(Permissions.VARIANTS_DELETE)
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
        @Query('menu_item_id') menuItemIdParam: string,
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
        const menuItemId = menuItemIdParam ? +menuItemIdParam : null;
        return this.service.getModifierGroups(
            brandId,
            user.tenantId,
            menuItemId,
        );
    }

    @Post('modifier-groups')
    @RequirePermission(Permissions.MODIFIERS_CREATE)
    async createModifierGroup(
        @CurrentUser() user: MenuUser,
        @Body()
        dto: {
            brand_id: number;
            name: string;
            min_select?: number;
            max_select?: number;
            min_select_by_size?: Record<string, number> | null;
            max_select_by_size?: Record<string, number> | null;
            included_quantity?: number;
            included_by_size?: Record<string, number> | null;
            allow_quantity?: boolean;
            price_tiers?: Record<string, number> | null;
            hide_in_deals?: boolean;
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
    @RequirePermission(Permissions.MODIFIERS_EDIT)
    async reorderModifierGroups(
        @CurrentUser() user: MenuUser,
        @Body() body: { brand_id: number; ordered_ids: number[] },
    ) {
        this.resolveBrandScope(user, body.brand_id);
        return this.service.reorderModifierGroups(
            body.brand_id,
            body.ordered_ids ?? [],
        );
    }

    @Patch('items/:itemId/reorder-modifier-groups')
    @RequirePermission(Permissions.MENU_EDIT)
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
    @RequirePermission(Permissions.MODIFIERS_EDIT)
    async updateModifierGroup(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            min_select?: number;
            max_select?: number;
            min_select_by_size?: Record<string, number> | null;
            max_select_by_size?: Record<string, number> | null;
            included_quantity?: number;
            included_by_size?: Record<string, number> | null;
            allow_quantity?: boolean;
            price_tiers?: Record<string, number> | null;
            hide_in_deals?: boolean;
        },
    ) {
        await this.assertEntityBrand(user, 'modifier-group', +id);
        return this.service.updateModifierGroup(+id, dto);
    }

    @Delete('modifier-groups/:id')
    @RequirePermission(Permissions.MODIFIERS_DELETE)
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
    @RequirePermission(Permissions.MODIFIERS_CREATE)
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
    @RequirePermission(Permissions.MODIFIERS_EDIT)
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
    @RequirePermission(Permissions.MODIFIERS_DELETE)
    async deleteModifier(
        @CurrentUser() user: MenuUser,
        @Param('id') id: string,
    ) {
        await this.assertEntityBrand(user, 'modifier', +id);
        return this.service.deleteModifier(+id);
    }

    @Patch('modifier-groups/:groupId/reorder')
    @RequirePermission(Permissions.MODIFIERS_EDIT)
    async reorderModifiers(
        @Param('groupId') groupId: string,
        @Body() body: { ordered_ids: number[] },
    ) {
        return this.service.reorderModifiers(+groupId, body.ordered_ids ?? []);
    }

    @Post('items/:id/link-modifier-groups')
    @RequirePermission(Permissions.MENU_EDIT)
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
                slot_size_key?: string | null;
                allowed_size_keys?: string[] | null;
                mirror_slot_index?: number | null;
                mirror_match_size?: boolean;
                mirror_match_category?: boolean;
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
