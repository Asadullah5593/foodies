import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('discounts')
export class Discount {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    name: string;

    @Column({ type: 'varchar', nullable: true, unique: true })
    code: string | null;

    /** When false: auto-applied when scope/eligibility match. When true: coupon/promo only (user must enter code). */
    @Column({ default: true })
    requiresCode: boolean;

    @Column({ type: 'varchar' })
    type: string; // flat, percentage, buy_x_get_y

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    value: number;

    /**
     * Buy-X-get-Y (BOGO) configuration — only used when type = 'buy_x_get_y'.
     * For every `buyQuantity` eligible units purchased, the next `getQuantity`
     * (cheapest) eligible units are discounted by `getDiscountPercent` (e.g. 50 = half price,
     * 100 = free). Eligibility uses applicationScope/applicationScopeIds (category or products).
     * When `bogoMatchSameGroup` is true, pairing is restricted to units of the same
     * category + variant size (e.g. "buy a Large pizza, 2nd Large of same category half price").
     */
    @Column({ name: 'buy_quantity', type: 'int', nullable: true })
    buyQuantity: number | null;

    @Column({ name: 'get_quantity', type: 'int', nullable: true })
    getQuantity: number | null;

    @Column({
        name: 'get_discount_percent',
        type: 'decimal',
        precision: 5,
        scale: 2,
        nullable: true,
    })
    getDiscountPercent: number | null;

    @Column({ name: 'bogo_match_same_group', type: 'boolean', default: false })
    bogoMatchSameGroup: boolean;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    minOrderAmount: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    maxDiscountAmount: number | null;

    /** What gets discounted: whole_order | category | products */
    @Column({ type: 'varchar', default: 'whole_order' })
    applicationScope: string;

    /** IDs for application: category IDs when scope=category, menu_item IDs when scope=products */
    @Column('simple-json', { nullable: true })
    applicationScopeIds: number[] | null;

    /** Where discount is valid: null = any branch; otherwise order.branchId must be in this list */
    @Column('simple-json', { nullable: true })
    eligibilityBranchIds: number[] | null;

    /** Where discount is valid: null = any brand; otherwise order.brandId must be in this list */
    @Column('simple-json', { nullable: true, name: 'eligibility_brand_ids' })
    eligibilityBrandIds: number[] | null;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: false })
    posOnly: boolean;

    @Column('simple-json', { nullable: true })
    allowedRoles: string[] | null;

    @Column({ type: 'timestamp', nullable: true })
    validFrom: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    validUntil: Date | null;

    /** Recurring time window: start time (HH:mm) in branch timezone. */
    @Column({ type: 'time', nullable: true })
    validTimeStart: string | null;

    /** Recurring time window: end time (HH:mm) in branch timezone. */
    @Column({ type: 'time', nullable: true })
    validTimeEnd: string | null;

    /** Recurring days: 0=Sun, 1=Mon, …, 6=Sat. When set, discount only valid on these days. */
    @Column('simple-json', { nullable: true })
    validDaysOfWeek: number[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.discounts, { onDelete: 'CASCADE' })
    tenant: Tenant;
}
