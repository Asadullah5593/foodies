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
import { InventoryAdjustmentLine } from './inventory-adjustment-line.entity';

@Entity('inventory_adjustments')
export class InventoryAdjustment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column({ type: 'varchar' })
    adjustmentType: string;

    @Column({ type: 'varchar', default: 'draft' })
    status: string;

    @Column({ type: 'varchar' })
    reasonCode: string;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @Column({ type: 'int', nullable: true })
    postedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    postedAt: Date | null;

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

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    createdByUser: User | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'posted_by' })
    postedByUser: User | null;

    @OneToMany(() => InventoryAdjustmentLine, (line) => line.adjustment)
    lines: InventoryAdjustmentLine[];
}
