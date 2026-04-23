import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../inventory/inventory.service';
import { Recipe } from '../entities/recipe.entity';
import { RecipeLine } from '../entities/recipe-line.entity';
import { RecipeCostSnapshot } from '../entities/recipe-cost-snapshot.entity';
import { InventoryItemCost } from '../entities/inventory-item-cost.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuVariant } from '../entities/menu-variant.entity';

type TenantContextUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
};

@Injectable()
export class RecipesService {
    constructor(
        private branchesService: BranchesService,
        private inventoryService: InventoryService,
        @InjectRepository(Recipe) private recipesRepo: Repository<Recipe>,
        @InjectRepository(RecipeLine)
        private recipeLinesRepo: Repository<RecipeLine>,
        @InjectRepository(RecipeCostSnapshot)
        private costSnapshotsRepo: Repository<RecipeCostSnapshot>,
        @InjectRepository(InventoryItemCost)
        private itemCostsRepo: Repository<InventoryItemCost>,
        @InjectRepository(MenuItem) private menuItemsRepo: Repository<MenuItem>,
        @InjectRepository(MenuVariant)
        private menuVariantsRepo: Repository<MenuVariant>,
    ) {}

    async resolveTenantId(user: TenantContextUser, branchId?: number) {
        return this.inventoryService.resolveTenantId(user, branchId);
    }

    listRecipes(tenantId: number, menuItemId?: number) {
        return this.recipesRepo.find({
            where: {
                tenantId,
                ...(menuItemId ? { menuItemId } : {}),
            } as any,
            relations: { lines: true },
            order: { menuItemId: 'ASC', variantId: 'ASC', version: 'DESC' },
        });
    }

    async createRecipe(
        tenantId: number,
        userId: number,
        dto: { menu_item_id: number; variant_id?: number | null; notes?: string },
    ) {
        const menuItem = await this.menuItemsRepo.findOne({
            where: { id: dto.menu_item_id },
            relations: { brand: true },
        });
        if (!menuItem) throw new NotFoundException('Menu item not found');
        if ((menuItem as any).brand?.tenantId != null && (menuItem as any).brand.tenantId !== tenantId) {
            throw new ForbiddenException('Menu item is not in this tenant');
        }

        if (dto.variant_id != null) {
            const variant = await this.menuVariantsRepo.findOne({
                where: { id: dto.variant_id, menuItemId: menuItem.id },
            });
            if (!variant) throw new NotFoundException('Menu variant not found');
        }

        const latest = await this.recipesRepo.findOne({
            where: {
                tenantId,
                menuItemId: dto.menu_item_id,
                variantId: dto.variant_id ?? null,
            } as any,
            order: { version: 'DESC' },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        return this.recipesRepo.save(
            this.recipesRepo.create({
                tenantId,
                menuItemId: dto.menu_item_id,
                variantId: dto.variant_id ?? null,
                version: nextVersion,
                status: 'draft',
                notes: dto.notes ?? null,
                createdBy: userId,
            }),
        );
    }

    async addRecipeLine(
        tenantId: number,
        recipeId: number,
        dto: {
            inventory_item_id: number;
            qty: number;
            uom_id: number;
            wastage_factor?: number | null;
            notes?: string | null;
        },
    ) {
        const recipe = await this.recipesRepo.findOne({
            where: { id: recipeId, tenantId },
        });
        if (!recipe) throw new NotFoundException('Recipe not found');
        if (recipe.status !== 'draft') {
            throw new BadRequestException('Only draft recipes can be edited');
        }

        return this.recipeLinesRepo.save(
            this.recipeLinesRepo.create({
                recipeId: recipe.id,
                inventoryItemId: dto.inventory_item_id,
                qty: dto.qty,
                uomId: dto.uom_id,
                wastageFactor: dto.wastage_factor ?? null,
                notes: dto.notes ?? null,
            }),
        );
    }

    async activateRecipe(tenantId: number, recipeId: number) {
        const recipe = await this.recipesRepo.findOne({
            where: { id: recipeId, tenantId },
        });
        if (!recipe) throw new NotFoundException('Recipe not found');

        // Archive all other recipes for same menu item + variant
        await this.recipesRepo.update(
            {
                tenantId,
                menuItemId: recipe.menuItemId,
                variantId: recipe.variantId,
            } as any,
            { status: 'archived' },
        );

        recipe.status = 'active';
        return this.recipesRepo.save(recipe);
    }

    async computeRecipeCost(args: {
        tenantId: number;
        recipeId: number;
        branchId: number;
    }) {
        const recipe = await this.recipesRepo.findOne({
            where: { tenantId: args.tenantId, id: args.recipeId },
            relations: { lines: true },
        });
        if (!recipe) throw new NotFoundException('Recipe not found');
        if (!recipe.lines || recipe.lines.length === 0) {
            throw new BadRequestException('Recipe has no lines');
        }

        const breakdown: Array<{
            inventory_item_id: number;
            qty_in_base: number;
            unit_cost: number | null;
            line_cost: number | null;
        }> = [];

        let total = 0;
        let anyMissing = false;

        for (const line of recipe.lines) {
            const qtyBase = await this.inventoryService.convertToItemBaseQty(
                args.tenantId,
                line.inventoryItemId,
                Number(line.qty),
                line.uomId,
            );

            const latestCost = await this.itemCostsRepo.findOne({
                where: {
                    tenantId: args.tenantId,
                    branchId: args.branchId,
                    inventoryItemId: line.inventoryItemId,
                },
                order: { effectiveAt: 'DESC' },
            });
            const unitCost = latestCost ? Number(latestCost.unitCost) : null;

            const wastageFactor = line.wastageFactor
                ? Number(line.wastageFactor)
                : 0;
            const qtyWithWastage = qtyBase * (1 + wastageFactor);

            const lineCost = unitCost != null ? qtyWithWastage * unitCost : null;
            if (lineCost == null) anyMissing = true;
            if (lineCost != null) total += lineCost;

            breakdown.push({
                inventory_item_id: line.inventoryItemId,
                qty_in_base: qtyWithWastage,
                unit_cost: unitCost,
                line_cost: lineCost,
            });
        }

        const snapshot = await this.costSnapshotsRepo.save(
            this.costSnapshotsRepo.create({
                recipeId: recipe.id,
                computedAt: new Date(),
                totalCost: total,
                currency: null,
                costBreakdown: { anyMissing, lines: breakdown },
            }),
        );

        // Margin info (optional) using menu base price + variant modifier
        const menuItem = await this.menuItemsRepo.findOne({
            where: { id: recipe.menuItemId },
            relations: { brand: true },
        });
        if (menuItem && (menuItem as any).brand?.tenantId != null && (menuItem as any).brand.tenantId !== args.tenantId) {
            throw new ForbiddenException('Menu item is not in this tenant');
        }
        const variant = recipe.variantId
            ? await this.menuVariantsRepo.findOne({
                  where: { id: recipe.variantId },
              })
            : null;
        const sellPrice =
            Number(menuItem?.basePrice ?? 0) + Number(variant?.priceModifier ?? 0);

        const grossMargin =
            sellPrice > 0 && total >= 0 ? (sellPrice - total) / sellPrice : null;

        return { snapshot, sell_price: sellPrice, gross_margin: grossMargin };
    }
}

