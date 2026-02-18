import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { RequirePermissionGuard } from './require-permission.guard';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([Role, Permission])],
    controllers: [RolesController],
    providers: [RolesService, RequirePermissionGuard],
    exports: [RolesService, RequirePermissionGuard],
})
export class RolesModule {}
