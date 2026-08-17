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
import { Employee } from './employee.entity';
import { User } from './user.entity';

/**
 * A salary advance, recovered in instalments.
 *
 * Near-universal in this market and the reason an exit settlement is not simply
 * "last month's salary" — an outstanding advance is one of the exit clearance
 * items, and payroll must be able to net it off.
 */
@Entity('employee_loans_advances')
export class EmployeeLoanAdvance {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column({ type: 'decimal', precision: 12, scale: 2 })
    principalAmount: number;

    @Column({ type: 'decimal', precision: 12, scale: 2 })
    installmentAmount: number;

    @Column({ type: 'int', default: 1 })
    installmentsTotal: number;

    @Column({ type: 'int', default: 0 })
    installmentsPaid: number;

    @Column({ type: 'decimal', precision: 12, scale: 2 })
    outstandingAmount: number;

    /** active | settled | written_off */
    @Column({ type: 'varchar', length: 16, default: 'active' })
    status: string;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'date', nullable: true })
    disbursedOn: string | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

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
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;
}
