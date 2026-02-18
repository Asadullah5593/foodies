import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { MenuItem } from './menu-item.entity';

@Entity('menu_categories')
export class MenuCategory {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    brandId: number;

    @Column()
    name: string;

    @Column({ default: 0 })
    sortOrder: number;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Brand, (b) => b.menuCategories, { onDelete: 'CASCADE' })
    brand: Brand;

    @OneToMany(() => MenuItem, (i) => i.category)
    menuItems: MenuItem[];
}
