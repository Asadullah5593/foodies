import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

/**
 * A specific bank card / product a tenant runs offers on (e.g. "HBL Premium Debit").
 * Tenant-scoped catalog. Card-linked discounts reference these by id. `binPrefixes` optionally
 * enables BIN auto-detect (first 6–8 digits of the card number) but manual selection is primary.
 */
@Entity('bank_cards')
export class BankCard {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** Display name, e.g. "HBL Premium Debit". */
    @Column()
    name: string;

    /** Issuing bank, e.g. "HBL". */
    @Column({ type: 'varchar', nullable: true })
    bank: string | null;

    /** Network / product tag, e.g. "visa" | "mastercard" | "debit" | "credit" (display only). */
    @Column({ type: 'varchar', nullable: true })
    network: string | null;

    /** Optional BIN prefixes (6–8 digit) for auto-detect from the card number. */
    @Column({ name: 'bin_prefixes', type: 'simple-json', nullable: true })
    binPrefixes: string[] | null;

    /** Brand-locked admin scoping; null = all brands. */
    @Column({
        name: 'eligibility_brand_ids',
        type: 'simple-json',
        nullable: true,
    })
    eligibilityBrandIds: number[] | null;

    /** Order must be from one of these branches; null = any. */
    @Column({
        name: 'eligibility_branch_ids',
        type: 'simple-json',
        nullable: true,
    })
    eligibilityBranchIds: number[] | null;

    // ---- The card's own discount ------------------------------------------
    // Always whole-order, and only ever applied when the WHOLE bill is paid with
    // this card. A null discountValue means the card carries no offer: still
    // selectable at the till for tender/BIN, it just discounts nothing.

    @Column({ name: 'discount_type', type: 'varchar', nullable: true })
    discountType: 'flat' | 'percentage' | null;

    @Column({
        name: 'discount_value',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true,
    })
    discountValue: number | null;

    /** Minimum spend before the card offer applies; null = no minimum. */
    @Column({
        name: 'min_order_amount',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true,
    })
    minOrderAmount: number | null;

    /** Cap on a percentage offer; null = uncapped. */
    @Column({
        name: 'max_discount_amount',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true,
    })
    maxDiscountAmount: number | null;

    @Column({ name: 'valid_from', type: 'timestamp', nullable: true })
    validFrom: Date | null;

    @Column({ name: 'valid_until', type: 'timestamp', nullable: true })
    validUntil: Date | null;

    /** Recurring time-of-day window (branch timezone), HH:mm. */
    @Column({ name: 'valid_time_start', type: 'time', nullable: true })
    validTimeStart: string | null;

    @Column({ name: 'valid_time_end', type: 'time', nullable: true })
    validTimeEnd: string | null;

    /** Recurring days: 0=Sun … 6=Sat; null = every day. */
    @Column({
        name: 'valid_days_of_week',
        type: 'simple-json',
        nullable: true,
    })
    validDaysOfWeek: number[] | null;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    tenant: Tenant;
}
