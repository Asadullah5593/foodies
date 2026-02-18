import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/tenant.entity';
import { Order } from '../entities/order.entity';
import { Customer } from '../entities/customer.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyService } from './loyalty.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Tenant, Order, Customer, LoyaltyTransaction]),
    ],
    providers: [LoyaltyService],
    exports: [LoyaltyService],
})
export class LoyaltyModule {}
