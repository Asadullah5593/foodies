import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseRequisition } from '../entities/purchase-requisition.entity';
import { PurchaseRequisitionLine } from '../entities/purchase-requisition-line.entity';
import { PurchaseOrder } from '../entities/purchase-order.entity';
import { PurchaseOrderLine } from '../entities/purchase-order-line.entity';
import { GoodsReceiptNote } from '../entities/goods-receipt-note.entity';
import { GoodsReceiptNoteLine } from '../entities/goods-receipt-note-line.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { Vendor } from '../entities/vendor.entity';
import { ProcurementService } from './procurement.service';
import { ProcurementAdminController } from './procurement.admin.controller';

@Module({
    imports: [
        AuthModule,
        BranchesModule,
        InventoryModule,
        TypeOrmModule.forFeature([
            PurchaseRequisition,
            PurchaseRequisitionLine,
            PurchaseOrder,
            PurchaseOrderLine,
            GoodsReceiptNote,
            GoodsReceiptNoteLine,
            InventoryBatch,
            InventoryItem,
            Vendor,
        ]),
    ],
    controllers: [ProcurementAdminController],
    providers: [ProcurementService],
})
export class ProcurementModule {}

