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
import { PosMenuController } from './pos-menu.controller';
import { PosOrdersController } from './pos-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { RiderOrdersController } from './rider-orders.controller';
import { RiderOrderLocationController } from './rider-order-location.controller';
import { RiderOrderLocation } from '../entities/rider-order-location.entity';
import { OrdersService } from './orders.service';
import { RiderOrderLocationService } from './rider-order-location.service';
import { MenuModule } from '../menu/menu.module';
import { PaymentsModule } from '../payments/payments.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { BranchesModule } from '../branches/branches.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
    imports: [
        AuthModule,
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
            RiderOrderLocation,
        ]),
        MenuModule,
        PaymentsModule,
        LoyaltyModule,
        ShiftsModule,
        BranchesModule,
        CustomersModule,
        InventoryModule,
    ],
    controllers: [
        PosMenuController,
        PosOrdersController,
        AdminOrdersController,
        RiderOrdersController,
        RiderOrderLocationController,
    ],
    providers: [OrdersService, RiderOrderLocationService],
    exports: [OrdersService, RiderOrderLocationService],
})
export class OrdersModule {}
