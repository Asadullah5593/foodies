import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    ManyToMany,
    OneToMany,
    JoinTable,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { Modifier } from './modifier.entity';
import { MenuItem } from './menu-item.entity';

@Entity('modifier_groups')
export class ModifierGroup {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    brandId: number;

    @Column()
    name: string;

    @Column({ default: 0 })
    minSelect: number;

    @Column({ default: 1 })
    maxSelect: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Brand, (b) => b.modifierGroups, { onDelete: 'CASCADE' })
    brand: Brand;

    @OneToMany(() => Modifier, (m) => m.modifierGroup)
    modifiers: Modifier[];

    @ManyToMany(() => MenuItem, (mi) => mi.modifierGroups)
    @JoinTable({
        name: 'menu_item_modifier_groups',
        joinColumn: { name: 'modifier_group_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'menu_item_id', referencedColumnName: 'id' },
    })
    menuItems: MenuItem[];
}
