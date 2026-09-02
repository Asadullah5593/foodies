import { Module } from '@nestjs/common';
import { CustomerAddressesService } from './customer-addresses.service';
import { PosCustomerAddressesController } from './pos-customer-addresses.controller';
import { RoleAccessModule } from '../auth/role-access.module';
import { RolesModule } from '../roles/roles.module';

@Module({
    imports: [RoleAccessModule, RolesModule],
    controllers: [PosCustomerAddressesController],
    providers: [CustomerAddressesService],
    exports: [CustomerAddressesService],
})
export class CustomerAddressesModule {}
