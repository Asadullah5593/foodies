import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RecipesService } from './recipes.service';

@ApiTags('Admin – Recipes')
@ApiBearerAuth()
@Controller('admin/recipes')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class RecipesAdminController {
    constructor(private recipesService: RecipesService) {}

    @Get()
    async index(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('menu_item_id') menuItemId?: string,
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.listRecipes(
            tenantId,
            menuItemId ? +menuItemId : undefined,
        );
    }

    @Post()
    async create(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            menu_item_id: number;
            variant_id?: number | null;
            notes?: string;
        },
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.createRecipe(tenantId, user.id, dto);
    }

    @Post(':id/lines')
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

    @Post(':id/activate')
    async activate(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        const tenantId = await this.recipesService.resolveTenantId(user);
        return this.recipesService.activateRecipe(tenantId, +id);
    }

    @Post(':id/compute-cost')
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
