import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Shift } from '../entities/shift.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([Shift, Order, Payment]),
    ],
    controllers: [ShiftsController],
    providers: [ShiftsService],
    exports: [ShiftsService],
})
export class ShiftsModule {}
