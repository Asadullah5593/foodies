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

@Entity('tenant_users')
export class TenantUser {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    userId: number;

    @Column()
    roleId: number;

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
}
