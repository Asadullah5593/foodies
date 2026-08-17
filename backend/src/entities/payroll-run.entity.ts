import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { PayrollLine } from './payroll-line.entity';

/**
 * One payroll period, for a tenant or a single branch.
 *
 * State machine (docs/HRM.md §10.1):
 *
 *   draft → computed → pending_approval → approved → paid
 *                                            ↓
 *                                        reversed
 *
 * `approve` LOCKS every attendance_day in the period. After that there is no
 * edit path: corrections are either a reversal (with a reason, which unlocks)
 * or a payroll_adjustment carried into the next period. Approved payroll is a
 * financial record, and an editable financial record is not one.
 */
@Entity('payroll_runs')
export class PayrollRun {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** null = every branch in scope. */
    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'date' })
    periodFrom: string;

    @Column({ type: 'date' })
    periodTo: string;

    /** calendar_month | cutoff */
    @Column({ type: 'varchar', length: 24, default: 'calendar_month' })
    cycleType: string;

    /** draft | computed | pending_approval | approved | paid | reversed */
    @Column({ type: 'varchar', length: 24, default: 'draft' })
    status: string;

    /**
     * The policy figures this run was computed under. Snapshotted so a payslip
     * stays explicable after the rules change.
     */
    @Column({ type: 'jsonb', default: () => "'{}'" })
    ruleSnapshot: Record<string, unknown>;

    @Column({ type: 'int', nullable: true })
    requestedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    computedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    paidAt: Date | null;

    @Column({ type: 'int', nullable: true })
    reversedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    reversedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    reversalReason: string | null;

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

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;

    @OneToMany(() => PayrollLine, (l) => l.run, { cascade: true })
    lines: PayrollLine[];
}
