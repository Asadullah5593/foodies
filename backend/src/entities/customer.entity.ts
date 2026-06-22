import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('customers')
export class Customer {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    tenantId: number | null;

    @Column()
    phone: string;

    @Column({ type: 'varchar', nullable: true, unique: true })
    email: string | null;

    @Column({ type: 'varchar', nullable: true })
    password: string | null;

    @Column({ type: 'varchar', nullable: true })
    name: string | null;

    /**
     * Brands this customer is explicitly associated with (manual add / link at POS).
     * Visibility for brand-locked admins unions this with order history. null = no
     * explicit association. Kept as simple-json (physical jsonb) like discount.eligibilityBrandIds.
     */
    @Column('simple-json', { nullable: true, name: 'brand_ids' })
    brandIds: number[] | null;

    /**
     * @deprecated Replaced by per-wallet balances in `loyalty_wallets` (POS brand-scoped + shared APP).
     * Zeroed by the dual-wallet migration; no longer read or written by loyalty logic.
     */
    @Column({ default: 0 })
    loyaltyPointsBalance: number;

    @Column({ type: 'varchar', nullable: true })
    profileImageUrl: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    latitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    longitude: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true })
    tenant: Tenant | null;
}
