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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => OrderItem, (oi) => oi.modifiers, { onDelete: 'CASCADE' })
    orderItem: OrderItem;

    @ManyToOne(() => Modifier, { onDelete: 'SET NULL' })
    modifier: Modifier;
}
