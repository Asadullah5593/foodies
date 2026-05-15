import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { Order } from './order.entity';
import { User } from './user.entity';

@Entity('rider_assignment_ledger')
export class RiderAssignmentLedger {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column()
    orderId: number;

    @Column({ type: 'varchar', length: 32 })
    eventType: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    assignmentRequestId: string | null;

    @Column({ nullable: true })
    selectedRiderUserId: number | null;

    @Column({ type: 'jsonb', default: () => "'[]'" })
    eligibleRiderUserIds: number[];

    @Column({ type: 'jsonb', default: () => "'[]'" })
    skippedRiders: Array<Record<string, unknown>>;

    @Column({ type: 'varchar', length: 64, nullable: true })
    reasonCode: string | null;

    @Column({ type: 'text', nullable: true })
    reasonDetail: string | null;

    @Column({ nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'selected_rider_user_id' })
    selectedRider: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;
}
