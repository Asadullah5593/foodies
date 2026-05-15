import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Order } from '../entities/order.entity';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { ShiftsModule } from '../shifts/shifts.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([Order]),
        ShiftsModule,
        OrdersModule,
    ],
    controllers: [KitchenController],
    providers: [KitchenService],
    exports: [KitchenService],
})
export class KitchenModule {}
