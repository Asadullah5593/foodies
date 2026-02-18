import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../entities/branch.entity';
import { Brand } from '../entities/brand.entity';
import { BranchBrand } from '../entities/branch-brand.entity';
import { BranchMenuItemsModule } from '../branch-menu-items/branch-menu-items.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Branch, Brand, BranchBrand]),
        BranchMenuItemsModule,
    ],
    controllers: [BranchesController],
    providers: [BranchesService],
    exports: [BranchesService],
})
export class BranchesModule {}
