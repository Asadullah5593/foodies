import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { MenuItem } from './menu-item.entity';
import { MenuVariant } from './menu-variant.entity';
import { OrderItemAddon } from './order-item-addon.entity';
import { OrderItemModifier } from './order-item-modifier.entity';

@Entity('order_items')
export class OrderItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderId: number;

    @Column()
    menuItemId: number;

    /** Brand of this line (from menu item); used for brand-specific invoicing. */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column({ nullable: true })
    variantId: number | null;

    @Column({ type: 'text', nullable: true })
    nameSnapshot: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    priceSnapshot: number | null;

    @Column()
    quantity: number;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    unitPrice: number;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    subtotal: number;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Order, (o) => o.orderItems, { onDelete: 'CASCADE' })
    order: Order;

    @ManyToOne(() => MenuItem, (i) => i.orderItems, { onDelete: 'CASCADE' })
    menuItem: MenuItem;

    @ManyToOne(() => MenuVariant, (v) => v.orderItems, { onDelete: 'SET NULL' })
    variant: MenuVariant;

    @OneToMany(() => OrderItemAddon, (a) => a.orderItem)
    addons: OrderItemAddon[];

    @OneToMany(() => OrderItemModifier, (m) => m.orderItem)
    modifiers: OrderItemModifier[];
}
