import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { MenuAddon } from './menu-addon.entity';

@Entity('order_item_addons')
export class OrderItemAddon {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderItemId: number;

    @Column()
    addonId: number;

    @Column({ default: 1 })
    quantity: number;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    unitPrice: number;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    subtotal: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => OrderItem, (oi) => oi.addons, { onDelete: 'CASCADE' })
    orderItem: OrderItem;

    @ManyToOne(() => MenuAddon, { onDelete: 'CASCADE' })
    addon: MenuAddon;
}
