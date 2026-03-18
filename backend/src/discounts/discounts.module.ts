import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Discount } from '../entities/discount.entity';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';

@Module({
    imports: [RoleAccessModule, TypeOrmModule.forFeature([Discount])],
    controllers: [DiscountsController],
    providers: [DiscountsService],
    exports: [DiscountsService],
})
export class DiscountsModule {}
