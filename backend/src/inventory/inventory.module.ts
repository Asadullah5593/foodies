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
import { BranchBrand } from '../entities/branch-brand.entity';
import { InventoryTransferRequest } from '../entities/inventory-transfer-request.entity';
import { InventoryTransferRequestLine } from '../entities/inventory-transfer-request-line.entity';
import { InventoryTransferOrder } from '../entities/inventory-transfer-order.entity';
import { InventoryTransferReceipt } from '../entities/inventory-transfer-receipt.entity';
import { InventoryTransferReceiptLine } from '../entities/inventory-transfer-receipt-line.entity';
import { InventoryAdjustment } from '../entities/inventory-adjustment.entity';
import { InventoryAdjustmentLine } from '../entities/inventory-adjustment-line.entity';
import { InventoryService } from './inventory.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { InventoryAlertsJob } from './inventory-alerts.job';
import { NotificationsModule } from '../notifications/notifications.module';
import { UomsAdminController } from './uoms.admin.controller';
import { VendorsAdminController } from './vendors.admin.controller';
import { InventoryItemsAdminController } from './inventory-items.admin.controller';
import { InventoryLocationsAdminController } from './inventory-locations.admin.controller';
import { InventoryAdminController } from './inventory.admin.controller';
import { StocktakesAdminController } from './stocktakes.admin.controller';
import { InventoryTransfersAdminController } from './inventory-transfers.admin.controller';
import { InventoryAdjustmentsAdminController } from './inventory-adjustments.admin.controller';
import { InventoryTransferService } from './inventory-transfer.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';

@Module({
    imports: [
        AuthModule,
        BranchesModule,
        NotificationsModule,
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
            BranchBrand,
            InventoryTransferRequest,
            InventoryTransferRequestLine,
            InventoryTransferOrder,
            InventoryTransferReceipt,
            InventoryTransferReceiptLine,
            InventoryAdjustment,
            InventoryAdjustmentLine,
        ]),
    ],
    controllers: [
        UomsAdminController,
        VendorsAdminController,
        InventoryItemsAdminController,
        InventoryLocationsAdminController,
        InventoryAdminController,
        StocktakesAdminController,
        InventoryTransfersAdminController,
        InventoryAdjustmentsAdminController,
    ],
    providers: [
        InventoryService,
        InventoryConsumptionService,
        InventoryTransferService,
        InventoryAdjustmentService,
        InventoryAlertsJob,
    ],
    exports: [InventoryService, InventoryConsumptionService],
})
export class InventoryModule {}
