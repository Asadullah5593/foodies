import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Employee } from './employee.entity';
import { User } from './user.entity';
import { EmployeeSalaryComponent } from './employee-salary-component.entity';

/**
 * What an employee is paid, effective-dated.
 *
 * ⚠️ Never UPDATE a structure to give someone a raise. Close it and open a new
 * one — the same pattern as `employee_assignments`. Salary history is a
 * question payroll, reviews and exit settlements all ask, and an overwritten
 * row cannot answer it.
 *
 * `perDeliveredOrderAmount` is how rider pay converges into this engine: a
 * rider is basic + per-order, computed by the same code as everyone else
 * rather than a parallel payroll (docs/HRM.md §12).
 */
@Entity('employee_salary_structures')
export class EmployeeSalaryStructure {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column({ type: 'date' })
    effectiveFrom: string;

    /** null = this is the current structure. */
    @Column({ type: 'date', nullable: true })
    effectiveTo: string | null;

    /** monthly | daily | hourly */
    @Column({ type: 'varchar', length: 16, default: 'monthly' })
    payType: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    basicAmount: number;

    @Column({ type: 'varchar', length: 8, default: 'PKR' })
    currency: string;

    /** fixed_30 | days_in_month | working_days — see dailyRate(). */
    @Column({ type: 'varchar', length: 24, default: 'fixed_30' })
    dailyRateBasis: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    perDeliveredOrderAmount: number;

    @Column({ type: 'varchar', length: 48, nullable: true })
    changeReason: string | null;

    @Column({ type: 'int', nullable: true })
    sourceReviewId: number | null;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @OneToMany(() => EmployeeSalaryComponent, (c) => c.structure, {
        cascade: true,
    })
    components: EmployeeSalaryComponent[];
}
