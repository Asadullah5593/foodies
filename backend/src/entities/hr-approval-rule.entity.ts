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

/**
 * Who has to sign a decision off (docs/HRM.md §3.5, decision #17).
 *
 * "A branch manager may waive up to PKR 2,000 per employee per month; above
 * that needs GM sign-off" is a row here, not a code change. A rule only ever
 * ADDS a requirement on top of the endpoint's own permission gate, so an empty
 * table means today's behaviour.
 */
@Entity('hr_approval_rules')
export class HrApprovalRule {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    /**
     * attendance_waiver | leave_request | overtime | payroll_run |
     * salary_change | promotion | payroll_adjustment
     */
    @Column({ type: 'varchar', length: 32 })
    subject: string;

    /**
     * Thresholds the decision is measured against: `amountGt`, `daysGt`,
     * `minutesGt`. All of them must hold for the rule to apply, so an empty
     * condition matches everything.
     */
    @Column({ type: 'jsonb', default: () => "'{}'" })
    condition: Record<string, unknown>;

    @Column({ type: 'varchar', length: 120 })
    requiredPermission: string;

    /** Named in the refusal, so the message says who CAN approve it. */
    @Column({ type: 'varchar', length: 120, nullable: true })
    escalateToPermission: string | null;

    @Column({ type: 'int', default: 0 })
    priority: number;

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
}
