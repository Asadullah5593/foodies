import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Shift } from '../entities/shift.entity';
import { Payment } from '../entities/payment.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([Order, OrderItem, Shift, Payment]),
    ],
    controllers: [ReportsController],
    providers: [ReportsService],
})
export class ReportsModule {}
