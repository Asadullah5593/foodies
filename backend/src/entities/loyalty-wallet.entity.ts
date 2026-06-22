import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Customer } from './customer.entity';
import { Brand } from './brand.entity';

/**
 * A customer's loyalty points balance, split by wallet type:
 *  - 'pos' wallet: brand-scoped (brandId set). Earned/redeemed only on POS orders of that brand.
 *  - 'app' wallet: shared across brands (brandId null). Earned/redeemed only on consumer-app orders.
 * Uniqueness is enforced by partial indexes (one POS wallet per customer+brand, one APP wallet per customer).
 * `balance` is a cache; the source of truth is SUM(points_remaining) over the wallet's non-expired earn lots.
 */
@Entity('loyalty_wallets')
export class LoyaltyWallet {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    customerId: number;

    @Column({ type: 'varchar', length: 8 })
    walletType: 'pos' | 'app';

    /** Non-null for POS wallets (the brand the points belong to); null for the shared APP wallet. */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column({ default: 0 })
    balance: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customer_id' })
    customer: Customer;

    @ManyToOne(() => Brand, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;
}
