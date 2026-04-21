import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { User } from '../entities/user.entity';
import { TenantUser } from '../entities/tenant-user.entity';
import { BranchUser } from '../entities/branch-user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([User, TenantUser, BranchUser]),
    ],
    controllers: [UsersController],
    providers: [UsersService],
    exports: [UsersService],
})
export class UsersModule {}
