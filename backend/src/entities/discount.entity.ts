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
    type: string; // flat, percentage

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    value: number;

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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.discounts, { onDelete: 'CASCADE' })
    tenant: Tenant;
}
