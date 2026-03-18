import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Customer } from '../entities/customer.entity';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
    imports: [RoleAccessModule, TypeOrmModule.forFeature([Customer])],
    controllers: [CustomersController],
    providers: [CustomersService],
    exports: [CustomersService],
})
export class CustomersModule {}
