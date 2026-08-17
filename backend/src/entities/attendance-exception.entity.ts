import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { AttendanceDay } from './attendance-day.entity';
import { User } from './user.entity';

/**
 * Corrections AND leniency, in one audit trail.
 *
 * `adjustment` changes what the derived day says (a missed punch, a wrong
 * time). `waiver` does NOT — the deduction is still calculated, then forgiven,
 * so the payslip can show both lines: what the machine decided, and who
 * overrode it and why. `overtime_approval` moves pending OT minutes into
 * approved.
 *
 * Append-only: rejected and superseded rows stay. `reason` is required by the
 * DTO on every kind — an unexplained waiver is the thing this table exists to
 * make impossible.
 */
@Entity('attendance_exceptions')
export class AttendanceException {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    attendanceDayId: number;

    /** adjustment | waiver | overtime_approval */
    @Column({ type: 'varchar', length: 24 })
    kind: string;

    /**
     * missed_punch | wrong_time | status_override | late | half_day |
     * absent | early_leave | overtime
     */
    @Column({ type: 'varchar', length: 24 })
    subject: string;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    oldValue: Record<string, unknown>;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    newValue: Record<string, unknown>;

    @Column({ type: 'int', nullable: true })
    minutesWaived: number | null;

    @Column({
        type: 'decimal',
        precision: 12,
        scale: 2,
        nullable: true,
    })
    amountWaived: number | null;

    @Column({ type: 'text' })
    reason: string;

    @Column({ type: 'int', nullable: true })
    requestedBy: number | null;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    /** pending | approved | rejected */
    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: string;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => AttendanceDay, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'attendance_day_id' })
    attendanceDay: AttendanceDay;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'requested_by' })
    requester: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;
}
