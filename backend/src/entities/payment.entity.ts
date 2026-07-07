import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';

@Entity('payments')
export class Payment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderId: number;

    @Column({ type: 'varchar' })
    paymentMethod: string; // cash, card, other

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    amount: number;

    @Column({ type: 'varchar', nullable: true })
    referenceNumber: string | null;

    /** For card tenders: which bank card (bank_cards id) was used — enables card-linked discounts + audit. */
    @Column({ name: 'bank_card_id', type: 'int', nullable: true })
    bankCardId: number | null;

    /**
     * Optional client-supplied idempotency key. When set, a retried / double-submitted
     * tender with the same (order_id, idempotency_key) is deduplicated instead of
     * recording a second payment. Backed by UQ_payments_order_idempotency.
     */
    @Column({ name: 'idempotency_key', type: 'varchar', nullable: true })
    idempotencyKey: string | null;

    @Column({ default: 'pending' })
    status: string;

    @Column({ type: 'timestamp', nullable: true })
    processedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    paidAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Order, (o) => o.payments, { onDelete: 'CASCADE' })
    order: Order;
}
