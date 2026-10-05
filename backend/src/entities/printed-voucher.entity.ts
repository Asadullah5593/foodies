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
import { Brand } from './brand.entity';

export type PrintedVoucherType = 'fixed_price' | 'percentage';

/**
 * One kind of paper voucher from the printed coupon book ("Any large pizza for
 * Rs 999", "30% off"), which a cashier applies by hand at the till.
 *
 * Deliberately NOT a `discounts` row, and not the `vouchers` table (that one is
 * the customer app's coupon instances): a printed voucher replaces every other
 * discount on the order instead of stacking with them, belongs to exactly one
 * brand, and must never reach the app or the website, which read `discounts`.
 * Pricing still runs through the one engine — see printed-voucher-pricing.ts.
 *
 * There is no usage limit and no serial number: staff collect the paper. The
 * order records which voucher it used (orders.printed_voucher_id), which is
 * what a per-customer rule would be built on later.
 */
@Entity('printed_vouchers')
export class PrintedVoucher {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** A voucher is redeemed against one brand's order; orders are single-brand. */
    @Column({ name: 'brand_id' })
    brandId: number;

    /** Button label at the till and the name on the receipt and the report. */
    @Column()
    name: string;

    /**
     * `fixed_price` — ONE qualifying item is charged at `value` (extras on top).
     * `percentage` — `value`% off every qualifying line.
     */
    @Column({ name: 'voucher_type', type: 'varchar', length: 16 })
    voucherType: PrintedVoucherType;

    /** Rupees for a fixed price; percent (0 < v <= 100) for a percentage. */
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    value: number;

    /** Percentage vouchers only: rupee ceiling on what it can take off; null = none. */
    @Column({
        name: 'max_discount_amount',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true,
    })
    maxDiscountAmount: number | null;

    /**
     * What qualifies: a line whose category is in `categoryIds` OR whose item
     * is in `productIds`. Both empty = the brand's whole menu, which only a
     * percentage voucher may be.
     */
    @Column({ name: 'category_ids', type: 'jsonb', nullable: true })
    categoryIds: number[] | null;

    @Column({ name: 'product_ids', type: 'jsonb', nullable: true })
    productIds: number[] | null;

    /**
     * Fixed price only: modifier options the price also covers — the "chips +
     * drink" of a meal voucher is the item's "Add Fries & Drink" option. When
     * set, the item must be ordered with at least one of them; the options are
     * alternatives ("Fries + Drink" / "Spicy Fries + Drink"), not a checklist.
     */
    @Column({ name: 'included_modifier_ids', type: 'jsonb', nullable: true })
    includedModifierIds: number[] | null;

    /** Branches it can be used at; null/empty = every branch. */
    @Column({ name: 'eligibility_branch_ids', type: 'jsonb', nullable: true })
    eligibilityBranchIds: number[] | null;

    /** Subset of delivery | pickup | dine_in; null = every order type. */
    @Column({ name: 'order_types', type: 'jsonb', nullable: true })
    orderTypes: string[] | null;

    /**
     * 'YYYY-MM-DD', both inclusive, read in the branch's timezone — "valid until
     * 30/11" works all day on the 30th.
     */
    @Column({ name: 'valid_from', type: 'date', nullable: true })
    validFrom: string | null;

    @Column({ name: 'valid_until', type: 'date', nullable: true })
    validUntil: string | null;

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
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Brand, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand;
}
