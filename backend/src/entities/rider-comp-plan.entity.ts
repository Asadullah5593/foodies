import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { RiderCompPlanComponent } from './rider-comp-plan-component.entity';

@Entity('rider_comp_plans')
export class RiderCompPlan {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ nullable: true })
    branchId: number | null;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column({ type: 'varchar', length: 32, default: 'hybrid' })
    payMethod: string;

    @Column({ type: 'varchar', length: 32, default: 'draft' })
    status: string;

    @Column({ type: 'int', default: 1 })
    version: number;

    @Column({ type: 'date', nullable: true })
    effectiveFrom: string | null;

    @Column({ type: 'date', nullable: true })
    effectiveTo: string | null;

    @Column({ nullable: true })
    createdBy: number | null;

    @Column({ nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

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

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;

    @OneToMany(() => RiderCompPlanComponent, (c) => c.plan, { cascade: true })
    components: RiderCompPlanComponent[];
}
