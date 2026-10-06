import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

/**
 * One kind of printed voucher used on an order, and how many papers of it.
 * Several rows per order once vouchers combine: three pizza vouchers are one
 * row with quantity 3; a burger meal and a full chicken are two rows. The
 * name and amount are snapshots, and the voucher id is ON DELETE SET NULL, so
 * retiring a voucher never rewrites order history. `orders.voucher_*` keep
 * the order-level total and a one-line summary for receipts and lists.
 */
@Entity('order_printed_vouchers')
@Index(['orderId'])
@Index(['printedVoucherId'])
export class OrderPrintedVoucher {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'order_id', type: 'int' })
    orderId: number;

    @ManyToOne(() => Order, (o) => o.printedVouchers, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;

    @Column({ name: 'printed_voucher_id', type: 'int', nullable: true })
    printedVoucherId: number | null;

    /** The voucher's name when it was applied. */
    @Column({ name: 'voucher_name', type: 'varchar' })
    voucherName: string;

    /** Papers of this voucher the customer handed over. */
    @Column({ type: 'int', default: 1 })
    quantity: number;

    /** What these papers took off together. */
    @Column({
        name: 'discount_amount',
        type: 'decimal',
        precision: 12,
        scale: 2,
        default: 0,
    })
    discountAmount: number;

    /** Who applied it. */
    @Column({ name: 'applied_by', type: 'int', nullable: true })
    appliedBy: number | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
