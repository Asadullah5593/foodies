import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Shift } from './shift.entity';
import { TenantUser } from './tenant-user.entity';
import { BranchUser } from './branch-user.entity';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: 'varchar', unique: true, nullable: true })
    email: string | null;

    @Column({ type: 'timestamp', nullable: true })
    emailVerifiedAt: Date | null;

    @Column()
    password: string;

    @Column({ type: 'varchar', nullable: true })
    phone: string | null;

    @Column({ default: 'active' })
    status: string;

    /**
     * Platform administrator: no tenant, no scoping, every permission.
     *
     * Explicit on purpose. This used to be inferred from having no tenant_users
     * row, which meant a half-finished delete promoted the leftover account to
     * unrestricted instead of removing it. Absence must never grant anything.
     */
    @Column({ default: false })
    isSuperAdmin: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToMany(() => TenantUser, (tu) => tu.user)
    tenantUsers: TenantUser[];

    @OneToMany(() => BranchUser, (bu) => bu.user)
    branchUsers: BranchUser[];

    @OneToMany(() => Order, (o) => o.creator)
    orders: Order[];

    @OneToMany(() => Shift, (s) => s.user)
    shifts: Shift[];
}
