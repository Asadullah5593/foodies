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
import { Customer } from './customer.entity';
import { Discount } from './discount.entity';

export type VoucherStatus =
    | 'active'
    | 'exhausted'
    | 'expired'
    | 'revoked'
    | 'template';

/**
 * The customer-facing instance of a coupon (discounts row, offer_kind='coupon').
 * The customer never sees or types `code` — they tap the voucher (or its QR is
 * scanned). `qr_token` is an opaque, leak-safe token encoded in the QR; it
 * resolves to this voucher server-side, never exposing the coupon code.
 */
@Entity('vouchers')
@Unique('UQ_vouchers_offer_customer', ['offerId', 'customerId'])
@Index('IDX_vouchers_customer_status', ['customerId', 'status'])
export class Voucher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ name: 'offer_id' })
  offerId: number;

  /** Null = a "template" voucher (the master shown in admin, no customer yet). */
  @Column({ name: 'customer_id', type: 'int', nullable: true })
  customerId: number | null;

  /** Embedded coupon code, hidden from the customer. */
  @Column()
  code: string;

  /** Opaque token encoded in the voucher QR (NOT the coupon code). */
  @Column({ name: 'qr_token' })
  qrToken: string;

  @Column({ type: 'varchar', default: 'active' })
  status: VoucherStatus;

  @CreateDateColumn({ name: 'granted_at' })
  grantedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ default: 0 })
  uses: number;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @ManyToOne(() => Discount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer: Discount;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;
}
