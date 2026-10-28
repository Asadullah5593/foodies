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

    /**
     * `quantity` and `subtotal` are for ONE unit of the order line: a plain
     * (non-deal) line of 3 bills the subtotal 3 times; a deal component row
     * bills it once.
     */
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
