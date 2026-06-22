import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { Role } from './role.entity';
import { Brand } from './brand.entity';

@Entity('tenant_users')
export class TenantUser {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    userId: number;

    @Column({ nullable: true })
    roleId: number | null;

    /**
     * Home brand of the user, recorded when a brand-locked admin creates them.
     * Makes the user visible to that brand's admins even before any branch
     * assignment (null = unscoped / created by owner-GM/super admin).
     */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.tenantUsers, { onDelete: 'CASCADE' })
    tenant: Tenant;

    @ManyToOne(() => User, (u) => u.tenantUsers, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
    role: Role;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    brand: Brand | null;
}
