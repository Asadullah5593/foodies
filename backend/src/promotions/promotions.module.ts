import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Promotion } from '../entities/promotion.entity';
import { CustomerPromotion } from '../entities/customer-promotion.entity';
import { Discount } from '../entities/discount.entity';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([Promotion, CustomerPromotion, Discount]),
    ],
    controllers: [PromotionsController],
    providers: [PromotionsService],
    exports: [PromotionsService],
})
export class PromotionsModule {}
