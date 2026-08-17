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
import { Branch } from './branch.entity';
import { Designation } from './designation.entity';

/**
 * A duty pattern: when someone is expected to work, and the thresholds that
 * turn a punch into a status.
 *
 * NOT `shifts` — that table is a POS till session with cash reconciliation.
 * Resolution order for an employee on a date is roster row → employee default
 * → branch default (docs/HRM.md §5.1).
 */
@Entity('work_schedule_templates')
export class WorkScheduleTemplate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'int', nullable: true })
    designationId: number | null;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    /** Branch-local 'HH:mm'. */
    @Column({ type: 'time' })
    startTime: string;

    @Column({ type: 'time' })
    endTime: string;

    @Column({ default: false })
    crossesMidnight: boolean;

    @Column({ type: 'int', default: 0 })
    breakMinutes: number;

    @Column({ type: 'int', default: 15 })
    graceMinutes: number;

    /**
     * Beyond this many minutes late the day is a half day regardless of hours
     * worked — arriving 3 hours late and staying 3 hours later does not undo
     * nobody covering the counter at opening. null disables the rule.
     */
    @Column({ type: 'int', nullable: true, default: 120 })
    halfDayAfterLateMinutes: number | null;

    @Column({ type: 'int', default: 480 })
    minMinutesFullDay: number;

    @Column({ type: 'int', default: 270 })
    minMinutesHalfDay: number;

    @Column({ type: 'int', default: 30 })
    overtimeAfterMinutes: number;

    /** Weekday numbers (0=Sunday) that are weekly offs. */
    @Column({ type: 'jsonb', default: () => "'[]'" })
    weeklyOffDays: number[];

    @Column({ type: 'int', default: 6 })
    attributionLeadHours: number;

    @Column({ type: 'int', default: 6 })
    attributionTrailHours: number;

    @Column({ default: true })
    isDefault: boolean;

    @Column({ default: true })
    isActive: boolean;

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

    @ManyToOne(() => Designation, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'designation_id' })
    designation: Designation | null;
}
