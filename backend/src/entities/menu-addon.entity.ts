import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    ManyToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { MenuCategory } from './menu-category.entity';
import { MenuItem } from './menu-item.entity';

@Entity('menu_addons')
export class MenuAddon {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    brandId: number;

    /** When set, this addon is category-specific (only for items in that category). */
    @Column({ nullable: true })
    categoryId: number | null;

    @Column()
    name: string;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    price: number;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: 0 })
    sortOrder: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Brand, (b) => b.menuAddons, { onDelete: 'CASCADE' })
    brand: Brand;

    @ManyToOne(() => MenuCategory, { onDelete: 'SET NULL' })
    category: MenuCategory;

    @ManyToMany(() => MenuItem, (i) => i.addons)
    menuItems: MenuItem[];
}
