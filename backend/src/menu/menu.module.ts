import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { MenuCategory } from '../entities/menu-category.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { Discount } from '../entities/discount.entity';
import { MenuAddon } from '../entities/menu-addon.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
import { Brand } from '../entities/brand.entity';
import { Branch } from '../entities/branch.entity';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { DealComponent } from '../entities/deal-component.entity';
import { ModifierGroup } from '../entities/modifier-group.entity';
import { Modifier } from '../entities/modifier.entity';
import { MenuItemModifierGroupPosition } from '../entities/menu-item-modifier-group-position.entity';
import { MediaModule } from '../media/media.module';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
    imports: [
        RoleAccessModule,
        MediaModule,
        TypeOrmModule.forFeature([
            MenuCategory,
            MenuItem,
            MenuAddon,
            MenuVariant,
            Brand,
            Branch,
            BranchMenuItem,
            DealComponent,
            ModifierGroup,
            Modifier,
            MenuItemModifierGroupPosition,
            Discount,
        ]),
    ],
    controllers: [MenuController],
    providers: [MenuService],
    exports: [MenuService],
})
export class MenuModule {}
