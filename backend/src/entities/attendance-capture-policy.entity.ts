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

/**
 * How staff identify themselves at the attendance station.
 *
 * There is no biometric device, so this design **deters** substitution and
 * makes it auditable — it does not prove identity. Configurable per tenant with
 * a per-branch override; `requirePhoto` is independent of the method, so a
 * branch can run PIN+photo, QR+photo, or either alone.
 *
 * Deliberately no terminal binding (decision #22): punches record the branch,
 * and burst detection groups by `pos_user_id`.
 */
@Entity('attendance_capture_policies')
export class AttendanceCapturePolicy {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** null = tenant-wide default; a row with a branch overrides it. */
    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    /** pin | qr_card */
    @Column({ type: 'varchar', length: 16, default: 'pin' })
    primaryMethod: string;

    @Column({ default: false })
    requirePhoto: boolean;

    @Column({ default: true })
    allowManagerAttestation: boolean;

    /** Ignore a repeat punch inside this window; stops double taps. */
    @Column({ type: 'int', default: 60 })
    duplicateWindowSeconds: number;

    /** Punch photos are purged after this many days. */
    @Column({ type: 'int', default: 90 })
    photoRetentionDays: number;

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
}
