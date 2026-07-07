import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { Discount } from '../entities/discount.entity';
import { Voucher } from '../entities/voucher.entity';
import { CouponRealization } from '../entities/coupon-realization.entity';
import { Customer } from '../entities/customer.entity';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
    imports: [
        RoleAccessModule,
        DiscountsModule,
        TypeOrmModule.forFeature([
            Discount,
            Voucher,
            CouponRealization,
            Customer,
        ]),
    ],
    controllers: [CouponsController],
    providers: [CouponsService],
    exports: [CouponsService],
})
export class CouponsModule {}
