import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/tenant.entity';
import { Order } from '../entities/order.entity';
import { Customer } from '../entities/customer.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyService } from './loyalty.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Tenant, Order, Customer, LoyaltyTransaction]),
        CustomersModule,
    ],
    providers: [LoyaltyService],
    exports: [LoyaltyService],
})
export class LoyaltyModule {}
