import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    ManyToMany,
    JoinTable,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Permission } from './permission.entity';

@Entity('roles')
export class Role {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    tenantId: number | null;

    @Column()
    name: string;

    @Column()
    slug: string;

    /**
     * How many days of order history this role may see (admin Orders module).
     * null = unlimited. A user holding several roles gets the most permissive
     * window (any unlimited role wins; otherwise the largest value).
     */
    @Column({ type: 'int', nullable: true })
    orderHistoryDays: number | null;

    /**
     * Ceiling on a staff discount this role may grant at the till. `percent`
     * gates percentage presets by their configured value; `amount` gates the
     * resulting rupees for ANY preset, which is what keeps flat presets in
     * check. null = no ceiling of that kind — the tenant offer cap still binds.
     * A user holding several roles gets the most permissive (null wins,
     * otherwise the largest).
     */
    @Column({
        name: 'max_staff_discount_percent',
        type: 'decimal',
        precision: 5,
        scale: 2,
        nullable: true,
    })
    maxStaffDiscountPercent: number | null;

    @Column({
        name: 'max_staff_discount_amount',
        type: 'decimal',
        precision: 10,
        scale: 2,
        nullable: true,
    })
    maxStaffDiscountAmount: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    tenant: Tenant;

    @ManyToMany(() => Permission)
    @JoinTable({
        name: 'role_permissions',
        joinColumn: { name: 'role_id', referencedColumnName: 'id' },
        inverseJoinColumn: {
            name: 'permission_id',
            referencedColumnName: 'id',
        },
    })
    permissions: Permission[];
}
