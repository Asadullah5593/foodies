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
import { User } from './user.entity';

/**
 * A registered attendance device — a tablet at the staff entrance, or a POS
 * terminal running the station screen.
 *
 * Exists so the station can work with NOBODY logged in. Staff have no user
 * accounts, and requiring a manager to stay signed in all day means the first
 * person to walk away leaves an authenticated admin session on a shared screen.
 *
 * The token is a device credential, the same class as KIOSK_API_KEY: stored as
 * issued so it can be reprinted, scoped to one branch, and revocable. It grants
 * exactly one thing — recording a punch at this branch — and it is NOT a login:
 * it cannot read the roster, salaries or anything else.
 *
 * ⚠️ Because no user is signed in, a station punch has no `pos_user_id`. The
 * burst-detection signal therefore groups by STATION rather than by till user,
 * which is why every punch records which device it came from.
 */
@Entity('attendance_stations')
export class AttendanceStation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column({ type: 'varchar', length: 120 })
    label: string;

    /** Opaque random string. Unique across tenants. */
    @Column({ type: 'varchar', length: 64 })
    token: string;

    @Column({ default: true })
    isActive: boolean;

    /** Updated on each successful punch, so a dead device is visible. */
    @Column({ type: 'timestamp', nullable: true })
    lastSeenAt: Date | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;
}
