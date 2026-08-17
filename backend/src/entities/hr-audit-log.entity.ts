import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';

/**
 * Scoped audit trail for HR.
 *
 * This system has no application-wide audit log — forensics today means nginx
 * access logs and Postgres `xmin`. Payroll is a financial record that must be
 * immutable after approval, and salary, PIN resets and attendance overrides are
 * exactly the changes someone will later need to attribute to a person. So HR
 * gets its own log rather than waiting for a platform-wide one.
 *
 * Append-only. `before`/`after` hold only the changed fields, not whole rows:
 * the point is to answer "who changed this and from what", not to duplicate the
 * table.
 */
@Entity('hr_audit_log')
export class HrAuditLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'int', nullable: true })
    tenantId: number | null;

    @Column({ type: 'int', nullable: true })
    actorUserId: number | null;

    @Column({ type: 'varchar', length: 64 })
    action: string;

    @Column({ type: 'varchar', length: 64 })
    entityTable: string;

    @Column({ type: 'int', nullable: true })
    entityId: number | null;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    before: Record<string, unknown>;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    after: Record<string, unknown>;

    @Column({ type: 'varchar', length: 64, nullable: true })
    ipAddress: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'actor_user_id' })
    actor: User | null;
}
