import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { Designation } from './designation.entity';

/**
 * A configurable deduction (docs/HRM.md §3.5).
 *
 * Seeded per tenant with rows that reproduce the hard-coded behaviour exactly,
 * so the arithmetic is visible and editable rather than buried in code. The
 * engine falls back to the same constants when a tenant has no rows, which
 * makes a missing row harmless rather than a silent zero.
 */
@Entity('deduction_rules')
export class DeductionRule {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'int', nullable: true })
    designationId: number | null;

    /** late | absent | half_day | early_leave | missed_punch | unapproved_leave */
    @Column({ type: 'varchar', length: 32 })
    trigger: string;

    /**
     * Trigger-specific parameters. `late` carries `{ ladder: number[] }` — days
     * deducted at each position of the repeating ladder. `early_leave` and
     * `missed_punch` carry `{ minMinutes }` where relevant.
     */
    @Column({ type: 'jsonb', default: () => "'{}'" })
    condition: Record<string, unknown>;

    /** deduct_days | deduct_amount | deduct_percent_of_daily */
    @Column({ type: 'varchar', length: 32 })
    effectType: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    effectValue: number;

    @Column({ type: 'int', default: 0 })
    priority: number;

    @Column({ type: 'date', nullable: true })
    effectiveFrom: string | null;

    @Column({ type: 'date', nullable: true })
    effectiveTo: string | null;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch | null;

    @ManyToOne(() => Designation, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'designation_id' })
    designation: Designation | null;
}
