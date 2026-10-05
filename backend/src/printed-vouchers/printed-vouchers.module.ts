import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { PrintedVoucher } from '../entities/printed-voucher.entity';
import { PrintedVouchersController } from './printed-vouchers.controller';
import { PrintedVouchersService } from './printed-vouchers.service';

@Module({
    imports: [RoleAccessModule, TypeOrmModule.forFeature([PrintedVoucher])],
    controllers: [PrintedVouchersController],
    providers: [PrintedVouchersService],
    exports: [PrintedVouchersService],
})
export class PrintedVouchersModule {}
