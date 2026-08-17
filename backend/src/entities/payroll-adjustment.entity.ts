import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { PayrollLine } from './payroll-line.entity';
import { User } from './user.entity';

/**
 * A human overriding the machine, per decision #9: Admin and HR Manager may
 * waive any deduction or add one, with a mandatory reason.
 *
 * Immutable, and it NEVER edits a computed figure. The payslip prints the
 * calculated line and this one beside it, so three months later the question
 * "who decided this and why" has an answer that does not depend on anyone's
 * memory. Gated by `payroll:adjust`.
 */
@Entity('payroll_adjustments')
export class PayrollAdjustment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    payrollLineId: number;

    /** waive | add_deduction | add_earning */
    @Column({ type: 'varchar', length: 24 })
    direction: string;

    /** Which computed line this offsets, when it offsets one. */
    @Column({ type: 'varchar', length: 80, nullable: true })
    targetComponentKey: string | null;

    @Column({ type: 'decimal', precision: 12, scale: 2 })
    amount: number;

    @Column({ type: 'text' })
    reason: string;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => PayrollLine, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'payroll_line_id' })
    payrollLine: PayrollLine;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;
}
