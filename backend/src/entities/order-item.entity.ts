import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    JoinColumn,
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

    /** When set, this line is part of a deal; value is the deal menu_item_id. */
    @Column({ name: 'deal_id', type: 'int', nullable: true })
    dealId: number | null;

    /** Order of this line within the deal (for receipt grouping). */
    @Column({ name: 'deal_slot_index', type: 'int', nullable: true })
    dealSlotIndex: number | null;

    /** POS per-order price override: true when a cashier set unitPrice manually. priceSnapshot keeps the real menu price. */
    @Column({ name: 'price_overridden', type: 'boolean', default: false })
    priceOverridden: boolean;

    /** User id who applied the price override (audit). */
    @Column({ name: 'overridden_by', type: 'int', nullable: true })
    overriddenBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Order, (o) => o.orderItems, { onDelete: 'CASCADE' })
    order: Order;

    @ManyToOne(() => MenuItem, (i) => i.orderItems, { onDelete: 'CASCADE' })
    menuItem: MenuItem;

    /**
     * Read-only relation to the parent deal's menu item (joined on deal_id),
     * used to show the deal's name on receipts / kitchen tickets / order view.
     * The writable column is `dealId`; this only adds the join for reads.
     */
    @ManyToOne(() => MenuItem, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'deal_id' })
    dealMenuItem: MenuItem | null;

    @ManyToOne(() => MenuVariant, (v) => v.orderItems, { onDelete: 'SET NULL' })
    variant: MenuVariant;

    @OneToMany(() => OrderItemAddon, (a) => a.orderItem)
    addons: OrderItemAddon[];

    @OneToMany(() => OrderItemModifier, (m) => m.orderItem)
    modifiers: OrderItemModifier[];
}
