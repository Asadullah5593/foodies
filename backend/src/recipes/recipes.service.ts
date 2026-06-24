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
import { MenuAddon } from '../entities/menu-addon.entity';
import { Modifier } from '../entities/modifier.entity';

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
        @InjectRepository(MenuAddon)
        private menuAddonsRepo: Repository<MenuAddon>,
        @InjectRepository(Modifier)
        private modifiersRepo: Repository<Modifier>,
    ) {}

    async resolveTenantId(user: TenantContextUser, branchId?: number) {
        return this.inventoryService.resolveTenantId(user, branchId);
    }

    listRecipes(
        tenantId: number,
        filters?: {
            menuItemId?: number;
            addonId?: number;
            modifierId?: number;
        },
    ) {
        const where: any = { tenantId };
        if (filters?.menuItemId) where.menuItemId = filters.menuItemId;
        if (filters?.addonId) where.addonId = filters.addonId;
        if (filters?.modifierId) where.modifierId = filters.modifierId;
        return this.recipesRepo.find({
            where,
            relations: { lines: true },
            order: { menuItemId: 'ASC', variantId: 'ASC', version: 'DESC' },
        });
    }

    async createRecipe(
        tenantId: number,
        userId: number,
        dto: {
            menu_item_id?: number | null;
            variant_id?: number | null;
            addon_id?: number | null;
            modifier_id?: number | null;
            notes?: string;
        },
    ) {
        // A recipe targets exactly one of: menu item (+variant) | add-on | modifier.
        const targets = [
            dto.menu_item_id != null,
            dto.addon_id != null,
            dto.modifier_id != null,
        ].filter(Boolean).length;
        if (targets !== 1) {
            throw new BadRequestException(
                'A recipe must target exactly one of: a menu item, an add-on, or a modifier',
            );
        }

        const target = await this.resolveRecipeTarget(tenantId, dto);

        const latest = await this.recipesRepo.findOne({
            where: {
                tenantId,
                menuItemId: target.menuItemId,
                variantId: target.variantId,
                addonId: target.addonId,
                modifierId: target.modifierId,
            } as any,
            order: { version: 'DESC' },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        return this.recipesRepo.save(
            this.recipesRepo.create({
                tenantId,
                menuItemId: target.menuItemId,
                variantId: target.variantId,
                addonId: target.addonId,
                modifierId: target.modifierId,
                version: nextVersion,
                status: 'draft',
                notes: dto.notes ?? null,
                createdBy: userId,
            }),
        );
    }

    /**
     * Validates the recipe target and returns the normalized target columns.
     * Enforces: a menu item that HAS variants must be recipe'd per-variant.
     */
    private async resolveRecipeTarget(
        tenantId: number,
        dto: {
            menu_item_id?: number | null;
            variant_id?: number | null;
            addon_id?: number | null;
            modifier_id?: number | null;
        },
    ): Promise<{
        menuItemId: number | null;
        variantId: number | null;
        addonId: number | null;
        modifierId: number | null;
    }> {
        if (dto.menu_item_id != null) {
            const menuItem = await this.menuItemsRepo.findOne({
                where: { id: dto.menu_item_id },
                relations: { brand: true },
            });
            if (!menuItem) throw new NotFoundException('Menu item not found');
            if (
                (menuItem as any).brand?.tenantId != null &&
                (menuItem as any).brand.tenantId !== tenantId
            ) {
                throw new ForbiddenException('Menu item is not in this tenant');
            }

            const variantCount = await this.menuVariantsRepo.count({
                where: { menuItemId: menuItem.id },
            });
            if (variantCount > 0 && dto.variant_id == null) {
                throw new BadRequestException(
                    'This menu item has variants — pick a variant for the recipe',
                );
            }
            if (dto.variant_id != null) {
                const variant = await this.menuVariantsRepo.findOne({
                    where: { id: dto.variant_id, menuItemId: menuItem.id },
                });
                if (!variant)
                    throw new NotFoundException('Menu variant not found');
            }
            return {
                menuItemId: menuItem.id,
                variantId: dto.variant_id ?? null,
                addonId: null,
                modifierId: null,
            };
        }

        if (dto.addon_id != null) {
            const addon = await this.menuAddonsRepo.findOne({
                where: { id: dto.addon_id },
                relations: { brand: true },
            });
            if (!addon) throw new NotFoundException('Add-on not found');
            if (
                (addon as any).brand?.tenantId != null &&
                (addon as any).brand.tenantId !== tenantId
            ) {
                throw new ForbiddenException('Add-on is not in this tenant');
            }
            return {
                menuItemId: null,
                variantId: null,
                addonId: addon.id,
                modifierId: null,
            };
        }

        // modifier_id
        const modifier = await this.modifiersRepo.findOne({
            where: { id: dto.modifier_id as number },
            relations: { modifierGroup: { brand: true } },
        });
        if (!modifier) throw new NotFoundException('Modifier not found');
        const modTenantId = (modifier as any).modifierGroup?.brand?.tenantId;
        if (modTenantId != null && modTenantId !== tenantId) {
            throw new ForbiddenException('Modifier is not in this tenant');
        }
        return {
            menuItemId: null,
            variantId: null,
            addonId: null,
            modifierId: modifier.id,
        };
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

    async updateRecipeLine(
        tenantId: number,
        recipeId: number,
        lineId: number,
        dto: {
            qty?: number;
            uom_id?: number;
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
        const line = await this.recipeLinesRepo.findOne({
            where: { id: lineId, recipeId: recipe.id },
        });
        if (!line) throw new NotFoundException('Recipe line not found');

        if (dto.qty !== undefined) line.qty = dto.qty;
        if (dto.uom_id !== undefined) line.uomId = dto.uom_id;
        if (dto.wastage_factor !== undefined)
            line.wastageFactor = dto.wastage_factor ?? null;
        if (dto.notes !== undefined) line.notes = dto.notes ?? null;
        return this.recipeLinesRepo.save(line);
    }

    async deleteRecipeLine(tenantId: number, recipeId: number, lineId: number) {
        const recipe = await this.recipesRepo.findOne({
            where: { id: recipeId, tenantId },
        });
        if (!recipe) throw new NotFoundException('Recipe not found');
        if (recipe.status !== 'draft') {
            throw new BadRequestException('Only draft recipes can be edited');
        }
        const line = await this.recipeLinesRepo.findOne({
            where: { id: lineId, recipeId: recipe.id },
        });
        if (!line) throw new NotFoundException('Recipe line not found');
        await this.recipeLinesRepo.delete({ id: lineId });
        return { ok: true };
    }

    async activateRecipe(tenantId: number, recipeId: number) {
        const recipe = await this.recipesRepo.findOne({
            where: { id: recipeId, tenantId },
        });
        if (!recipe) throw new NotFoundException('Recipe not found');

        // Archive all other recipes for the same target (menu item+variant, add-on,
        // or modifier) so only one is active per target.
        await this.recipesRepo.update(
            {
                tenantId,
                menuItemId: recipe.menuItemId,
                variantId: recipe.variantId,
                addonId: recipe.addonId,
                modifierId: recipe.modifierId,
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

            const lineCost =
                unitCost != null ? qtyWithWastage * unitCost : null;
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

        // Margin info (optional). Sell price comes from the recipe's target:
        // a menu item (base + variant modifier), an add-on, or a modifier.
        let sellPrice = 0;
        if (recipe.menuItemId != null) {
            const menuItem = await this.menuItemsRepo.findOne({
                where: { id: recipe.menuItemId },
                relations: { brand: true },
            });
            if (
                menuItem &&
                (menuItem as any).brand?.tenantId != null &&
                (menuItem as any).brand.tenantId !== args.tenantId
            ) {
                throw new ForbiddenException('Menu item is not in this tenant');
            }
            const variant = recipe.variantId
                ? await this.menuVariantsRepo.findOne({
                      where: { id: recipe.variantId },
                  })
                : null;
            sellPrice =
                Number(menuItem?.basePrice ?? 0) +
                Number(variant?.priceModifier ?? 0);
        } else if (recipe.addonId != null) {
            const addon = await this.menuAddonsRepo.findOne({
                where: { id: recipe.addonId },
            });
            sellPrice = Number(addon?.price ?? 0);
        } else if (recipe.modifierId != null) {
            const modifier = await this.modifiersRepo.findOne({
                where: { id: recipe.modifierId },
            });
            sellPrice = Number(modifier?.price ?? 0);
        }

        const grossMargin =
            sellPrice > 0 && total >= 0
                ? (sellPrice - total) / sellPrice
                : null;

        return { snapshot, sell_price: sellPrice, gross_margin: grossMargin };
    }
}
