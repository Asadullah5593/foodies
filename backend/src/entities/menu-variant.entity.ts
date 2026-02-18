import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { MenuItem } from './menu-item.entity';
import { OrderItem } from './order-item.entity';

@Entity('menu_variants')
export class MenuVariant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    menuItemId: number;

    @Column()
    name: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    priceModifier: number;

    @Column({ default: false })
    isDefault: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => MenuItem, (i) => i.variants, { onDelete: 'CASCADE' })
    menuItem: MenuItem;

    @OneToMany(() => OrderItem, (oi) => oi.variant)
    orderItems: OrderItem[];
}
