import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { Modifier } from './modifier.entity';

@Entity('order_item_modifiers')
export class OrderItemModifier {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderItemId: number;

    @Column({ nullable: true })
    modifierId: number | null;

    @Column({ type: 'text', nullable: true })
    nameSnapshot: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    priceSnapshot: number | null;

    @Column({ default: 1 })
    quantity: number;

    /**
     * Of the `quantity` units selected, how many were included free by the modifier
     * group's allowance (`ModifierGroup.includedQuantity`/`includedBySize`).
     * Charged units = quantity - freeQuantity, each at `priceSnapshot`.
     */
    @Column({ name: 'free_quantity', default: 0 })
    freeQuantity: number;

    /**
     * The parent line's variant sizeKey at order time (e.g. '12'), captured so the
     * size-dependent `priceSnapshot` can be reconstructed for receipts/refunds even if
     * the modifier's price map later changes. Null when the item had no size.
     */
    @Column({ name: 'variant_size_snapshot', type: 'varchar', length: 32, nullable: true })
    variantSizeSnapshot: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => OrderItem, (oi) => oi.modifiers, { onDelete: 'CASCADE' })
    orderItem: OrderItem;

    @ManyToOne(() => Modifier, { onDelete: 'SET NULL' })
    modifier: Modifier;
}
