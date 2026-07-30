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
 * A preset give-away a cashier can grant at the till ("10% – Long wait",
 * "Flat Rs. 200"). Its own module, deliberately NOT a `discounts` row: an offer
 * is earned by the cart, a staff discount is discretion exercised by a person.
 * The controls that matter here are who granted it and how much — not
 * eligibility — so this table stays small: no codes, audiences, per-customer
 * limits, vouchers, day-parts or channels.
 *
 * Pricing still runs through the one engine. `staffDiscountToOffer()` adapts a
 * preset into the shape the `staff_discount` stage evaluates, exactly as bank
 * cards are adapted into `card_offer`, so the tenant cap, the cost floor and
 * deal/override exclusion all apply without a second pricing path.
 */
@Entity('staff_discounts')
export class StaffDiscount {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /**
     * Button label at the till, and the grouping key in reports. Name presets
     * for the occasion ("10% – Long wait", "Staff meal") and the discount report
     * gains a reason dimension for free.
     */
    @Column()
    name: string;

    @Column({ name: 'discount_type', type: 'varchar', default: 'percentage' })
    discountType: 'percentage' | 'flat';

    /**
     * Percent (0 < v <= 100; 100 is a full comp) or a flat currency amount, per
     * `discountType`. Who may actually grant a given size is the role ceiling's
     * job — `roles.max_staff_discount_percent` — not this column's.
     */
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    value: number;

    /** Rupee ceiling on a percentage preset so a large ticket can't run away; null = uncapped. */
    @Column({
        name: 'max_discount_amount',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true,
    })
    maxDiscountAmount: number | null;

    /** Order must be from one of these brands; null/empty = any. */
    @Column({
        name: 'eligibility_brand_ids',
        type: 'simple-json',
        nullable: true,
    })
    eligibilityBrandIds: number[] | null;

    /** Order must be from one of these branches; null/empty = any. */
    @Column({
        name: 'eligibility_branch_ids',
        type: 'simple-json',
        nullable: true,
    })
    eligibilityBranchIds: number[] | null;

    /** Button order at the till, ascending. */
    @Column({ name: 'sort_order', type: 'int', default: 0 })
    sortOrder: number;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    tenant: Tenant;
}
