import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Branch } from '../entities/branch.entity';
import { User } from '../entities/user.entity';
import { BranchUser } from '../entities/branch-user.entity';
import { Role } from '../entities/role.entity';
import { BranchUsersController } from './branch-users.controller';
import { BranchUsersService } from './branch-users.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([Branch, User, BranchUser, Role]),
    ],
    controllers: [BranchUsersController],
    providers: [BranchUsersService],
})
export class BranchUsersModule {}
