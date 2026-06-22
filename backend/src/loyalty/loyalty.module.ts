import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { Customer } from '../entities/customer.entity';
import { Brand } from '../entities/brand.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyWallet } from '../entities/loyalty-wallet.entity';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyExpiryJob } from './loyalty-expiry.job';
import { CustomersModule } from '../customers/customers.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Order,
            Customer,
            Brand,
            LoyaltyTransaction,
            LoyaltyWallet,
        ]),
        CustomersModule,
    ],
    providers: [LoyaltyService, LoyaltyExpiryJob],
    exports: [LoyaltyService],
})
export class LoyaltyModule {}
