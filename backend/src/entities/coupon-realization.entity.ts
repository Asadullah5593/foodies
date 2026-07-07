import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Discount } from './discount.entity';
import { Order } from './order.entity';
import { Voucher } from './voucher.entity';

/**
 * Append-only redemption ledger ("realizations"). One row per coupon applied to
 * an order. Enforces per-customer / global usage limits (counted under an
 * advisory lock at order-create) and powers campaign/offer reporting.
 * Cancellation sets `reversed_at` instead of deleting (audit trail); counts
 * always filter `reversed_at IS NULL`.
 */
@Entity('coupon_realizations')
@Unique('UQ_coupon_realizations_offer_order', ['offerId', 'orderId'])
@Index('IDX_coupon_realizations_offer_customer', ['offerId', 'customerId'])
@Index('IDX_coupon_realizations_offer_phone', ['offerId', 'customerPhone'])
@Index('IDX_coupon_realizations_voucher', ['voucherId'])
export class CouponRealization {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ name: 'offer_id' })
  offerId: number;

  @Column({ name: 'voucher_id', type: 'int', nullable: true })
  voucherId: number | null;

  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId: number | null;

  /** Always normalized to 03XXXXXXXXX when present. */
  @Column({ name: 'customer_phone', type: 'varchar', nullable: true })
  customerPhone: string | null;

  @Column({ name: 'order_id' })
  orderId: number;

  @Column({ type: 'varchar', nullable: true })
  source: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ name: 'reversed_at', type: 'timestamp', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversal_reason', type: 'varchar', nullable: true })
  reversalReason: string | null;

  @ManyToOne(() => Discount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer: Discount;

  @ManyToOne(() => Voucher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'voucher_id' })
  voucher: Voucher | null;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;
}
