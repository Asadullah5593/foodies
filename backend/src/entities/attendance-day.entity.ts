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
import { Branch } from './branch.entity';

/**
 * The derived one-row-per-employee-per-day record that payroll reads.
 *
 * Recomputed idempotently from punches, leave and approved exceptions — never
 * hand-edited. `isLocked` is set when a payroll run is approved for the period;
 * a locked day refuses recompute, because approved payroll is a financial
 * record and must not silently change underneath it.
 */
@Entity('attendance_days')
@Unique(['employeeId', 'workDate'])
export class AttendanceDay {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    branchId: number;

    /** Branch-local date the shift STARTS (docs/HRM.md §5). */
    @Column({ type: 'date' })
    workDate: string;

    @Column({ type: 'int', nullable: true })
    scheduleTemplateId: number | null;

    @Column({ type: 'timestamp', nullable: true })
    plannedStartAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    plannedEndAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    firstInAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    lastOutAt: Date | null;

    @Column({ type: 'int', default: 0 })
    workedMinutes: number;

    @Column({ type: 'int', default: 0 })
    breakMinutes: number;

    @Column({ type: 'int', default: 0 })
    lateMinutes: number;

    @Column({ type: 'int', default: 0 })
    earlyLeaveMinutes: number;

    /** Accrues automatically; paid only once a manager approves it. */
    @Column({ type: 'int', default: 0 })
    overtimeMinutesPending: number;

    @Column({ type: 'int', default: 0 })
    overtimeMinutesApproved: number;

    /**
     * present | half_day | absent | leave_paid | leave_unpaid |
     * weekly_off | holiday
     */
    @Column({ type: 'varchar', length: 24, default: 'absent' })
    status: string;

    @Column({ type: 'int', nullable: true })
    leaveRequestId: number | null;

    /** missing_out, orphan_punch, no_schedule, manager_attested, no_photo… */
    @Column({ type: 'jsonb', default: () => "'{}'" })
    exceptionFlags: Record<string, unknown>;

    @Column({ default: false })
    isLocked: boolean;

    @Column({ type: 'timestamp', nullable: true })
    computedAt: Date | null;

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

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;
}
