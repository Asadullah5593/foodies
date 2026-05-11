import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { RiderOrderRating } from '../entities/rider-order-rating.entity';
import { BrandOrderRating } from '../entities/brand-order-rating.entity';
import { OrdersModule } from '../orders/orders.module';
import { BrandsModule } from '../brands/brands.module';
import { RatingsService } from './ratings.service';
import { AdminRiderRatingsController } from './admin-rider-ratings.controller';
import { AdminOrderRatingsController } from './admin-order-ratings.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Order, RiderOrderRating, BrandOrderRating]),
        OrdersModule,
        BrandsModule,
    ],
    controllers: [AdminRiderRatingsController, AdminOrderRatingsController],
    providers: [RatingsService],
    exports: [RatingsService],
})
export class RatingsModule {}
