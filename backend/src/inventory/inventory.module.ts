import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { Tenant } from '../entities/tenant.entity';
import { Branch } from '../entities/branch.entity';
import { User } from '../entities/user.entity';
import { Uom } from '../entities/uom.entity';
import { Vendor } from '../entities/vendor.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryItemBranchSetting } from '../entities/inventory-item-branch-setting.entity';
import { InventoryLocation } from '../entities/inventory-location.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { InventoryOnHand } from '../entities/inventory-on-hand.entity';
import { InventoryBatchOnHand } from '../entities/inventory-batch-on-hand.entity';
import { InventoryLedgerEntry } from '../entities/inventory-ledger-entry.entity';
import { WastageEvent } from '../entities/wastage-event.entity';
import { InventoryItemCost } from '../entities/inventory-item-cost.entity';
import { Stocktake } from '../entities/stocktake.entity';
import { StocktakeLine } from '../entities/stocktake-line.entity';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Recipe } from '../entities/recipe.entity';
import { RecipeLine } from '../entities/recipe-line.entity';
import { OrderInventoryAllocation } from '../entities/order-inventory-allocation.entity';
import { InventoryService } from './inventory.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { UomsAdminController } from './uoms.admin.controller';
import { VendorsAdminController } from './vendors.admin.controller';
import { InventoryItemsAdminController } from './inventory-items.admin.controller';
import { InventoryLocationsAdminController } from './inventory-locations.admin.controller';
import { InventoryAdminController } from './inventory.admin.controller';
import { StocktakesAdminController } from './stocktakes.admin.controller';

@Module({
    imports: [
        AuthModule,
        BranchesModule,
        TypeOrmModule.forFeature([
            Tenant,
            Branch,
            User,
            Uom,
            Vendor,
            InventoryItem,
            InventoryItemBranchSetting,
            InventoryLocation,
            InventoryBatch,
            InventoryOnHand,
            InventoryBatchOnHand,
            InventoryLedgerEntry,
            WastageEvent,
            InventoryItemCost,
            Stocktake,
            StocktakeLine,
            Order,
            OrderItem,
            Recipe,
            RecipeLine,
            OrderInventoryAllocation,
        ]),
    ],
    controllers: [
        UomsAdminController,
        VendorsAdminController,
        InventoryItemsAdminController,
        InventoryLocationsAdminController,
        InventoryAdminController,
        StocktakesAdminController,
    ],
    providers: [InventoryService, InventoryConsumptionService],
    exports: [InventoryService, InventoryConsumptionService],
})
export class InventoryModule {}

