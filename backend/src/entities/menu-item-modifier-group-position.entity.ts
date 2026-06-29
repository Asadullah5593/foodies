import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('menu_item_modifier_group_positions')
export class MenuItemModifierGroupPosition {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'menu_item_id' })
    menuItemId: number;

    @Column({ name: 'modifier_group_id' })
    modifierGroupId: number;

    @Column({ name: 'sort_order', default: 0 })
    sortOrder: number;
}
