import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Tenant } from './tenant.entity';

/**
 * Somewhere a customer has had food delivered, kept so an order taker can pick
 * it again instead of asking for it a second time.
 *
 * Distinct from `orders.delivery_address` on purpose: the order records where
 * THAT order went and must never change, while this is current state — a
 * customer can move away from an address, correct a typo in one, or ask for one
 * to be forgotten, none of which may rewrite an order.
 *
 * Keyed on the phone number, because that is what the till holds before any
 * customer record exists; guest orders never create one.
 */
@Entity('customer_addresses')
@Index('IDX_customer_addresses_lookup', ['tenantId', 'customerPhone'])
export class CustomerAddress {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** Normalised (03xxxxxxxxx), matching how orders store it. */
    @Column({ type: 'varchar', length: 32 })
    customerPhone: string;

    /** Set when the phone belongs to a known customer; guest orders leave it null. */
    @Column({ type: 'int', nullable: true })
    customerId: number | null;

    /** "Home", "Office" — free text, shown to the order taker. */
    @Column({ type: 'varchar', length: 40, nullable: true })
    label: string | null;

    /** As typed/selected, and what prints on the invoice. */
    @Column({ type: 'text' })
    address: string;

    /**
     * `address` lower-cased with punctuation collapsed to single spaces — see
     * `normalizeAddressKey()`, which MUST stay in step with the SQL in
     * migration 1760000000127 or the backfilled rows and later writes will
     * stop matching and the same doorstep will appear twice.
     */
    @Column({ type: 'varchar', length: 255 })
    addressKey: string;

    /**
     * The resolved point. The POS refuses a delivery order without one — the
     * fee is priced by distance and the rider needs a pin — so an address
     * missing these is not offered.
     */
    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    latitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    longitude: number | null;

    /** Standing delivery instructions: gate code, floor, "ring twice". */
    @Column({ type: 'text', nullable: true })
    notes: string | null;

    /**
     * Brands that have delivered here. A brand-locked user is shown only the
     * addresses their own brand has served, and this answers that without
     * joining back to orders on every lookup. Mirrors customers.brand_ids.
     */
    @Column({ type: 'int', array: true, nullable: true })
    brandIds: number[] | null;

    @Column({ default: 0 })
    timesUsed: number;

    @Column({ type: 'timestamp', nullable: true })
    lastUsedAt: Date | null;

    /** Soft: hiding an address must not erase the orders that went there. */
    @Column({ type: 'timestamp', nullable: true })
    deletedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Customer, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'customer_id' })
    customer: Customer | null;
}
