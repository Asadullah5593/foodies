import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Discount } from '../entities/discount.entity';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';

@Module({
    imports: [TypeOrmModule.forFeature([Discount])],
    controllers: [DiscountsController],
    providers: [DiscountsService],
    exports: [DiscountsService],
})
export class DiscountsModule {}
