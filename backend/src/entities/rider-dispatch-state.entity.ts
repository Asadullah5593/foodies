import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { Brand } from './brand.entity';
import { User } from './user.entity';

@Entity('rider_dispatch_states')
export class RiderDispatchState {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    /**
     * Round-robin is per (tenant, branch, brand): two brands sharing riders at
     * one branch must each keep their own rotation cursor. Nullable for legacy
     * / food-court (null-brand) rows.
     */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column({ nullable: true })
    lastAssignedRiderUserId: number | null;

    @Column({ type: 'timestamp', nullable: true })
    lastAssignedAt: Date | null;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'last_assigned_rider_user_id' })
    lastAssignedRider: User | null;
}
