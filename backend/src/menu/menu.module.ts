import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuCategory } from '../entities/menu-category.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuAddon } from '../entities/menu-addon.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
import { Brand } from '../entities/brand.entity';
import { Branch } from '../entities/branch.entity';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            MenuCategory,
            MenuItem,
            MenuAddon,
            MenuVariant,
            Brand,
            Branch,
            BranchMenuItem,
        ]),
    ],
    controllers: [MenuController],
    providers: [MenuService],
    exports: [MenuService],
})
export class MenuModule {}
