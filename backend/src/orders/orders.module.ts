import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Branch } from '../entities/branch.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
import { MenuAddon } from '../entities/menu-addon.entity';
import { OrderItemAddon } from '../entities/order-item-addon.entity';
import { OrderItemModifier } from '../entities/order-item-modifier.entity';
import { Modifier } from '../entities/modifier.entity';
import { User } from '../entities/user.entity';
import { Tenant } from '../entities/tenant.entity';
import { Discount } from '../entities/discount.entity';
import { BankCard } from '../entities/bank-card.entity';
import { PosMenuController } from './pos-menu.controller';
import { PosOrdersController } from './pos-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { RiderOrdersController } from './rider-orders.controller';
import { RiderOrderLocationController } from './rider-order-location.controller';
import { RiderOrderLocation } from '../entities/rider-order-location.entity';
import { RiderOrderLocationSummary } from '../entities/rider-order-location-summary.entity';
import { RiderProfile } from '../entities/rider-profile.entity';
import { RiderPresence } from '../entities/rider-presence.entity';
import { RiderDispatchState } from '../entities/rider-dispatch-state.entity';
import { RiderAssignmentLedger } from '../entities/rider-assignment-ledger.entity';
import { OrdersService } from './orders.service';
import { RiderOrderLocationService } from './rider-order-location.service';
import { RiderLocationGateway } from './rider-location.gateway';
import { RiderLocationEventsService } from './rider-location-events.service';
import { RiderLocationRetentionService } from './rider-location-retention.service';
import { DeliveryDispatchJob } from './delivery-dispatch.job';
import { MenuModule } from '../menu/menu.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { BranchesModule } from '../branches/branches.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RiderHrmModule } from '../rider-hrm/rider-hrm.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        AuthModule,
        PushNotificationsModule,
        TypeOrmModule.forFeature([
            Order,
            OrderItem,
            OrderItemAddon,
            OrderItemModifier,
            Modifier,
            Branch,
            MenuItem,
            MenuVariant,
            MenuAddon,
            User,
            Tenant,
            Discount,
            BankCard,
            RiderOrderLocation,
            RiderOrderLocationSummary,
            RiderProfile,
            RiderPresence,
            RiderDispatchState,
            RiderAssignmentLedger,
        ]),
        MenuModule,
        PaymentsModule,
        LoyaltyModule,
        ShiftsModule,
        BranchesModule,
        CustomersModule,
        InventoryModule,
        RiderHrmModule,
        NotificationsModule,
        InvoicesModule,
    ],
    controllers: [
        PosMenuController,
        PosOrdersController,
        AdminOrdersController,
        RiderOrdersController,
        RiderOrderLocationController,
    ],
    providers: [
        OrdersService,
        RiderOrderLocationService,
        RiderLocationGateway,
        RiderLocationEventsService,
        RiderLocationRetentionService,
        DeliveryDispatchJob,
    ],
    exports: [OrdersService, RiderOrderLocationService],
})
export class OrdersModule {}
