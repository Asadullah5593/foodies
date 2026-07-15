import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Order } from '../entities/order.entity';
import { BankCard } from '../entities/bank-card.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Shift } from '../entities/shift.entity';
import { Payment } from '../entities/payment.entity';
import { BrandOrderRating } from '../entities/brand-order-rating.entity';
import { RiderOrderRating } from '../entities/rider-order-rating.entity';
import { RiderPresence } from '../entities/rider-presence.entity';
import { InventoryOnHand } from '../entities/inventory-on-hand.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryItemBranchSetting } from '../entities/inventory-item-branch-setting.entity';
import { WastageEvent } from '../entities/wastage-event.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([
            Order,
            OrderItem,
            Shift,
            Payment,
            BrandOrderRating,
            RiderOrderRating,
            RiderPresence,
            InventoryOnHand,
            InventoryItem,
            InventoryItemBranchSetting,
            WastageEvent,
            BankCard,
        ]),
    ],
    controllers: [ReportsController],
    providers: [ReportsService],
})
export class ReportsModule {}
