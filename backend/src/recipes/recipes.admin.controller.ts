import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { RecipesService } from './recipes.service';

@ApiTags('Admin – Recipes')
@ApiBearerAuth()
@Controller('admin/recipes')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RecipesAdminController {
    constructor(private recipesService: RecipesService) {}

    @Get()
    async index(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('menu_item_id') menuItemId?: string,
        @Query('addon_id') addonId?: string,
        @Query('modifier_id') modifierId?: string,
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.listRecipes(tenantId, {
            menuItemId: menuItemId ? +menuItemId : undefined,
            addonId: addonId ? +addonId : undefined,
            modifierId: modifierId ? +modifierId : undefined,
        });
    }

    @Post()
    @RequirePermission(Permissions.RECIPES_CREATE)
    async create(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            menu_item_id?: number | null;
            variant_id?: number | null;
            addon_id?: number | null;
            modifier_id?: number | null;
            notes?: string;
        },
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.createRecipe(tenantId, user.id, dto);
    }

    @Post(':id/lines')
    @RequirePermission(Permissions.RECIPES_EDIT)
    async addLine(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            inventory_item_id: number;
            qty: number;
            uom_id: number;
            wastage_factor?: number | null;
            notes?: string | null;
        },
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.addRecipeLine(tenantId, +id, dto);
    }

    @Patch(':id/lines/:lineId')
    @RequirePermission(Permissions.RECIPES_EDIT)
    async updateLine(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Param('lineId') lineId: string,
        @Body()
        dto: {
            qty?: number;
            uom_id?: number;
            wastage_factor?: number | null;
            notes?: string | null;
        },
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.updateRecipeLine(
            tenantId,
            +id,
            +lineId,
            dto,
        );
    }

    @Delete(':id/lines/:lineId')
    @RequirePermission(Permissions.RECIPES_EDIT)
    async deleteLine(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Param('lineId') lineId: string,
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.deleteRecipeLine(tenantId, +id, +lineId);
    }

    @Post(':id/activate')
    @RequirePermission(Permissions.RECIPES_ACTIVATE)
    async activate(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.activateRecipe(tenantId, +id);
    }

    @Post(':id/compute-cost')
    @RequirePermission(Permissions.RECIPES_VIEW, Permissions.COSTING_VIEW)
    async computeCost(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body() dto: { branch_id: number },
    ) {
        const tenantId = await this.recipesService.resolveTenantId(
            user,
            dto.branch_id,
        );
        return this.recipesService.computeRecipeCost({
            tenantId,
            recipeId: +id,
            branchId: dto.branch_id,
        });
    }
}
