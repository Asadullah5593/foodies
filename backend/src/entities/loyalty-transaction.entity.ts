import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Order } from './order.entity';
import { LoyaltyWallet } from './loyalty-wallet.entity';

/**
 * Loyalty ledger row. `earn` rows act as FIFO "lots":
 *   - points > 0, pointsRemaining tracks the still-spendable amount, expiryDate is when the remainder dies.
 * `redeem`/`expire`/`adjust` rows are negative and record value leaving a wallet; the consumption itself is
 * applied by decrementing pointsRemaining on the affected earn lots within the same DB transaction.
 *
 * NOTE: rows created before the dual-wallet migration have walletId/walletType/brandId/pointsRemaining NULL.
 * They are kept for audit only and excluded from all wallet logic.
 */
@Entity('loyalty_transactions')
export class LoyaltyTransaction {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    customerId: number;

    @Column({ nullable: true })
    orderId: number | null;

    /** Wallet this row belongs to (null on legacy pre-wallet rows). */
    @Column({ type: 'int', nullable: true })
    walletId: number | null;

    /** Denormalized copies of the wallet's type/brand for cheap reporting. */
    @Column({ type: 'varchar', length: 8, nullable: true })
    walletType: 'pos' | 'app' | null;

    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    points: number;

    @Column()
    type: string; // earn, redeem, adjust, expire

    /** Set only on `earn` rows: when this lot's unconsumed remainder expires (null = never). */
    @Column({ type: 'timestamp', nullable: true })
    expiryDate: Date | null;

    /** Set only on `earn` rows: still-spendable points from this lot (decremented by FIFO redeem + expiry). */
    @Column({ type: 'int', nullable: true })
    pointsRemaining: number | null;

    /** Set on an `earn` lot once its unconsumed remainder has been expired by the cron. */
    @Column({ default: false })
    expired: boolean;

    @Column({ type: 'timestamp', nullable: true })
    expiredAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    customer: Customer;

    @ManyToOne(() => Order, { onDelete: 'SET NULL' })
    order: Order;

    @ManyToOne(() => LoyaltyWallet, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'wallet_id' })
    wallet: LoyaltyWallet | null;
}
