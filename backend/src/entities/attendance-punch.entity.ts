import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Employee } from './employee.entity';
import { Branch } from './branch.entity';
import { User } from './user.entity';

/**
 * A raw clock event. **Immutable** — never edited, never deleted.
 *
 * Corrections are `attendance_exceptions` rows that change the DERIVED day
 * (`attendance_days`), leaving the original punch intact. That separation is
 * the whole audit story: what the machine saw, and what a human decided about
 * it, stay independently readable.
 *
 * `punchedAt` is stamped by the SERVER. Client clocks are never trusted.
 */
@Entity('attendance_punches')
export class AttendancePunch {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    branchId: number;

    /** in | out | break_start | break_end */
    @Column({ type: 'varchar', length: 16 })
    punchType: string;

    @Column({ type: 'timestamp' })
    punchedAt: Date;

    /** pos | manager_attestation | admin_manual | rider_app */
    @Column({ type: 'varchar', length: 32, default: 'pos' })
    source: string;

    /** pin | qr_card | manager | admin */
    @Column({ type: 'varchar', length: 16, default: 'pin' })
    method: string;

    /**
     * Which till session was on screen. This is the abuse signal that survives
     * having no terminal registry: many punches under one pos_user_id in a
     * short window is one person punching for everybody.
     */
    @Column({ type: 'int', nullable: true })
    posUserId: number | null;

    /**
     * The registered device, when the punch came from an unauthenticated
     * station. Station punches have no `posUserId`, so this is what burst
     * detection groups by instead.
     */
    @Column({ type: 'int', nullable: true })
    stationId: number | null;

    @Column({ type: 'text', nullable: true })
    photoUrl: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    latitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    longitude: number | null;

    @Column({ default: false })
    isManual: boolean;

    /** Set when a punch was recorded on someone's behalf. */
    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    /** Attributed work date; null means the punch matched no shift (orphan). */
    @Column({ type: 'date', nullable: true })
    workDate: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'pos_user_id' })
    posUser: User | null;
}
