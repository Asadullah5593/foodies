import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';
import { PayrollRun } from './payroll-run.entity';
import { Employee } from './employee.entity';
import { PayrollLineItem } from './payroll-line-item.entity';

/** One employee's pay for one run. Day counts are snapshotted from attendance. */
@Entity('payroll_lines')
@Unique(['runId', 'employeeId'])
export class PayrollLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    runId: number;

    @Column()
    employeeId: number;

    /** Snapshots, so a later promotion cannot rewrite what this run paid. */
    @Column({ type: 'int', nullable: true })
    designationId: number | null;

    @Column({ type: 'int', nullable: true })
    salaryStructureId: number | null;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    presentDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    halfDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    paidLeaveDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    unpaidLeaveDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    absentDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    weeklyOffDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    holidayDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    encashedOffDays: number;

    @Column({ type: 'int', default: 0 })
    workedMinutes: number;

    @Column({ type: 'int', default: 0 })
    overtimeMinutes: number;

    @Column({ type: 'int', default: 0 })
    lateCount: number;

    @Column({ type: 'int', default: 0 })
    deliveredOrders: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    grossEarnings: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    totalDeductions: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    netPayable: number;

    @Column({ type: 'varchar', length: 8, default: 'PKR' })
    currency: string;

    /** unpaid | paid */
    @Column({ type: 'varchar', length: 16, default: 'unpaid' })
    paymentStatus: string;

    @Column({ type: 'varchar', length: 120, nullable: true })
    paymentReference: string | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => PayrollRun, (r) => r.lines, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'run_id' })
    run: PayrollRun;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @OneToMany(() => PayrollLineItem, (i) => i.payrollLine, { cascade: true })
    items: PayrollLineItem[];
}
