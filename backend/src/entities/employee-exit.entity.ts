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
import { Employee } from './employee.entity';
import { User } from './user.entity';
import { EmployeeClearanceItem } from './employee-clearance-item.entity';

/**
 * Leaving the business: resignation, termination, contract end, abandonment.
 *
 * Phase 1 records the exit and drives clearance. The final SETTLEMENT amount
 * needs salary structures and off-encashment, which arrive with payroll in
 * Phase 4 — `settlementPayrollLineId` is the hook for it and stays null until
 * then (docs/HRM.md §16). Recording an exit already does the important part:
 * it closes the current assignment, flips the employee's status and stops any
 * further attendance or payroll from accruing.
 */
@Entity('employee_exits')
export class EmployeeExit {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    /** resignation | termination | end_of_contract | abandonment */
    @Column({ type: 'varchar', length: 32 })
    exitType: string;

    @Column({ type: 'int', nullable: true })
    initiatedBy: number | null;

    @Column({ type: 'date' })
    initiatedOn: string;

    @Column({ type: 'int', default: 0 })
    noticePeriodDays: number;

    @Column({ type: 'date' })
    lastWorkingDate: string;

    @Column({ type: 'text', nullable: true })
    reason: string | null;

    @Column({ type: 'text', nullable: true })
    exitInterviewNotes: string | null;

    @Column({ type: 'boolean', default: true })
    rehireEligible: boolean;

    /** pending | in_progress | cleared | withheld */
    @Column({ type: 'varchar', length: 32, default: 'pending' })
    clearanceStatus: string;

    /** Set in Phase 4 when the final settlement is paid through payroll. */
    @Column({ type: 'int', nullable: true })
    settlementPayrollLineId: number | null;

    @Column({ type: 'timestamp', nullable: true })
    settledAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'initiated_by' })
    initiator: User | null;

    @OneToMany(() => EmployeeClearanceItem, (i) => i.exit, { cascade: true })
    clearanceItems: EmployeeClearanceItem[];
}
