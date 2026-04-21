import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Tenant } from '../entities/tenant.entity';
import { User } from '../entities/user.entity';
import { TenantUser } from '../entities/tenant-user.entity';
import { Role } from '../entities/role.entity';
import { TenantsController } from './tenants.controller';
import { BusinessSettingsController } from './business-settings.controller';
import { TenantsService } from './tenants.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([Tenant, User, TenantUser, Role]),
    ],
    controllers: [TenantsController, BusinessSettingsController],
    providers: [TenantsService],
    exports: [TenantsService],
})
export class TenantsModule {}
