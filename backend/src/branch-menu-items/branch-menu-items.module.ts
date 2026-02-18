import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { Branch } from '../entities/branch.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { BranchMenuItemsController } from './branch-menu-items.controller';
import { BranchMenuItemsService } from './branch-menu-items.service';

@Module({
    imports: [TypeOrmModule.forFeature([BranchMenuItem, Branch, MenuItem])],
    controllers: [BranchMenuItemsController],
    providers: [BranchMenuItemsService],
    exports: [BranchMenuItemsService],
})
export class BranchMenuItemsModule {}
