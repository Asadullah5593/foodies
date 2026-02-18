import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../entities/branch.entity';
import { BrandsModule } from '../brands/brands.module';
import { BranchesModule } from '../branches/branches.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ConsumerController } from './consumer.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Branch]),
        BrandsModule,
        BranchesModule,
        MenuModule,
        OrdersModule,
        LoyaltyModule,
    ],
    controllers: [ConsumerController],
})
export class ConsumerModule {}
