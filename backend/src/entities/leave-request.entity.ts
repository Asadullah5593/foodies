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
import { LeaveType } from './leave-type.entity';
import { User } from './user.entity';

/**
 * A leave application and its outcome.
 *
 * On approval this WRITES INTO `attendance_days` for the covered range — leave
 * is not a parallel universe from attendance. Payroll therefore reads one
 * source (the attendance day) rather than reconciling two.
 *
 * `paidDays`/`unpaidDays` are snapshotted at approval: a request that overruns
 * the balance is part paid and part unpaid, and re-deriving the split later
 * from a balance that has since moved would silently change history.
 */
@Entity('leave_requests')
export class LeaveRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    leaveTypeId: number;

    @Column({ type: 'date' })
    fromDate: string;

    @Column({ type: 'date' })
    toDate: string;

    /** full | first_half | second_half */
    @Column({ type: 'varchar', length: 16, default: 'full' })
    firstDayPart: string;

    @Column({ type: 'varchar', length: 16, default: 'full' })
    lastDayPart: string;

    /** Chargeable days after weekly offs and public holidays are removed. */
    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    totalDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    paidDays: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    unpaidDays: number;

    @Column({ type: 'text', nullable: true })
    reason: string | null;

    @Column({ type: 'text', nullable: true })
    attachmentUrl: string | null;

    /** pending | approved | rejected | cancelled */
    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: string;

    @Column({ type: 'int', nullable: true })
    requestedBy: number | null;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    decisionNote: string | null;

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

    @ManyToOne(() => LeaveType, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'leave_type_id' })
    leaveType: LeaveType;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'requested_by' })
    requester: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;
}
