import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Employee } from './employee.entity';
import { LeaveType } from './leave-type.entity';

/**
 * Entitlement ledger for one employee, leave type and period.
 *
 * `periodMonth` is null for annually-accrued types. Balances are derived from
 * approved requests rather than being the source of truth for them — a request
 * is always the record of what happened, and this table is the running total
 * that makes "how many are left" a single read instead of a scan.
 */
@Entity('leave_balances')
@Unique(['employeeId', 'leaveTypeId', 'periodYear', 'periodMonth'])
export class LeaveBalance {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    leaveTypeId: number;

    @Column({ type: 'int' })
    periodYear: number;

    /** null for annual accrual. */
    @Column({ type: 'int', nullable: true })
    periodMonth: number | null;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    entitled: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    used: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    carriedForward: number;

    /** Manual correction, positive or negative, with a reason on the event. */
    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    adjusted: number;

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

    @ManyToOne(() => LeaveType, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'leave_type_id' })
    leaveType: LeaveType;
}
