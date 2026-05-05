import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { InventoryModule } from '../inventory/inventory.module';
import { Recipe } from '../entities/recipe.entity';
import { RecipeLine } from '../entities/recipe-line.entity';
import { RecipeCostSnapshot } from '../entities/recipe-cost-snapshot.entity';
import { InventoryItemCost } from '../entities/inventory-item-cost.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { Uom } from '../entities/uom.entity';
import { RecipesService } from './recipes.service';
import { RecipesAdminController } from './recipes.admin.controller';

@Module({
    imports: [
        AuthModule,
        BranchesModule,
        InventoryModule,
        TypeOrmModule.forFeature([
            Recipe,
            RecipeLine,
            RecipeCostSnapshot,
            InventoryItemCost,
            MenuItem,
            MenuVariant,
            InventoryItem,
            Uom,
        ]),
    ],
    controllers: [RecipesAdminController],
    providers: [RecipesService],
    exports: [RecipesService],
})
export class RecipesModule {}
