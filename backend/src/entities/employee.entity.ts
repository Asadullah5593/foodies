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
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { EmployeeAssignment } from './employee-assignment.entity';

/**
 * An HR record for a person the business employs.
 *
 * Deliberately NOT the same thing as a `users` row. Most employees never log
 * in, so `userId` is nullable; when it is set the two are 1:1 (unique index).
 * Everything HR needs — attendance, salary, reviews, training, exit — hangs off
 * this table, never off `users`.
 *
 * Current branch/brand/designation live on `employee_assignments`, not here:
 * `primaryBranchId` is only a convenience for listing and for the attendance
 * station's default branch. The assignment row is the source of truth, because
 * a transfer must leave a dated trail rather than overwrite a column.
 *
 * See docs/HRM.md §3.1.
 */
@Entity('employees')
export class Employee {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** Unique per tenant. Typed by the employee at the attendance station. */
    @Column({ type: 'varchar', length: 32 })
    employeeCode: string;

    @Column({ type: 'varchar', length: 160 })
    fullName: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    fatherName: string | null;

    /** National ID. Unique per tenant when present. */
    @Column({ type: 'varchar', length: 32, nullable: true })
    cnic: string | null;

    @Column({ type: 'date', nullable: true })
    dateOfBirth: string | null;

    @Column({ type: 'varchar', length: 16, nullable: true })
    gender: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    phone: string | null;

    @Column({ type: 'text', nullable: true })
    address: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    emergencyContactName: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    emergencyContactPhone: string | null;

    @Column({ type: 'text', nullable: true })
    photoUrl: string | null;

    /** Set only for employees who also log into the system. Unique. */
    @Column({ type: 'int', nullable: true })
    userId: number | null;

    @Column({ type: 'int', nullable: true })
    primaryBranchId: number | null;

    @Column({ type: 'varchar', length: 32, default: 'full_time' })
    employmentType: string;

    @Column({ type: 'date' })
    dateOfJoining: string;

    @Column({ type: 'date', nullable: true })
    probationEndDate: string | null;

    @Column({ type: 'date', nullable: true })
    confirmationDate: string | null;

    /** active | on_leave | suspended | notice_period | resigned | terminated */
    @Column({ type: 'varchar', length: 32, default: 'active' })
    status: string;

    @Column({ type: 'date', nullable: true })
    dateOfLeaving: string | null;

    @Column({ type: 'text', nullable: true })
    leavingReason: string | null;

    @Column({ type: 'boolean', nullable: true })
    rehireEligible: boolean | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    bankName: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    accountTitle: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    accountNumberIban: string | null;

    @Column({ type: 'varchar', length: 32, default: 'cash' })
    paymentMethod: string;

    // --- Attendance credentials (issued here, used from Phase 2) ------------
    // Hashed exactly like a password. Present on this table from the start so
    // the attendance phase needs no ALTER on a table that will already be live.

    @Column({ type: 'varchar', length: 255, nullable: true })
    pinHash: string | null;

    @Column({ type: 'timestamp', nullable: true })
    pinSetAt: Date | null;

    @Column({ type: 'int', default: 0 })
    pinFailedAttempts: number;

    @Column({ type: 'timestamp', nullable: true })
    pinLockedUntil: Date | null;

    /**
     * Duty pattern when no roster row exists for the date. This is the live
     * path at launch — everyone works fixed timings (docs/HRM.md §5.1).
     */
    @Column({ type: 'int', nullable: true })
    defaultScheduleTemplateId: number | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    qrToken: string | null;

    @Column({ type: 'timestamp', nullable: true })
    qrTokenIssuedAt: Date | null;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    metadata: Record<string, unknown>;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'primary_branch_id' })
    primaryBranch: Branch | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'user_id' })
    user: User | null;

    @OneToMany(() => EmployeeAssignment, (a) => a.employee)
    assignments: EmployeeAssignment[];
}
