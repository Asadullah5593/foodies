import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { ShiftsModule } from '../shifts/shifts.module';

@Module({
    imports: [TypeOrmModule.forFeature([Order]), ShiftsModule],
    controllers: [KitchenController],
    providers: [KitchenService],
    exports: [KitchenService],
})
export class KitchenModule {}
