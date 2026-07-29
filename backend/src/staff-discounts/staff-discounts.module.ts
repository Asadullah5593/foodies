import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { StaffDiscount } from '../entities/staff-discount.entity';
import { Brand } from '../entities/brand.entity';
import { StaffDiscountsController } from './staff-discounts.controller';
import { StaffDiscountsService } from './staff-discounts.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([StaffDiscount, Brand]),
    ],
    controllers: [StaffDiscountsController],
    providers: [StaffDiscountsService],
    exports: [StaffDiscountsService],
})
export class StaffDiscountsModule {}
