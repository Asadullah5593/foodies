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
import { Role } from './role.entity';

/**
 * HR job title / grade — NOT an RBAC role.
 *
 * `roles` is a permission set and only means anything for someone who can log
 * in. Most employees (cooks, cleaners, porters, security) have no `users` row
 * at all, yet still need a designation to be paid, reviewed and promoted.
 *
 * `level` is the promotion ladder: a review whose outcome is `promoted` moves
 * the employee to a designation with a higher level. `defaultRoleId` is the
 * optional bridge back to access control — promoting someone into a
 * designation that carries a role lets the system offer to update their login
 * too, without ever making the two concepts the same thing.
 */
@Entity('designations')
export class Designation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column({ type: 'varchar', length: 120 })
    slug: string;

    /** Promotion ladder position. Higher = more senior. */
    @Column({ type: 'int', default: 0 })
    level: number;

    @Column({ type: 'varchar', length: 32, default: 'support' })
    department: string;

    /** Optional RBAC role this designation implies for staff who do log in. */
    @Column({ type: 'int', nullable: true })
    defaultRoleId: number | null;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Role, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'default_role_id' })
    defaultRole: Role | null;
}
