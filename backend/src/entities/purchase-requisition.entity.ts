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
import { Vendor } from './vendor.entity';
import { User } from './user.entity';
import { PurchaseRequisitionLine } from './purchase-requisition-line.entity';

@Entity('purchase_requisitions')
export class PurchaseRequisition {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    requestingBranchId: number;

    @Column()
    requestedFromVendorId: number;

    @Column({ type: 'varchar', nullable: true })
    prNumber: string | null;

    /** draft | submitted | approved | rejected | cancelled */
    @Column({ default: 'draft' })
    status: string;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'requesting_branch_id' })
    requestingBranch: Branch;

    @ManyToOne(() => Vendor, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'requested_from_vendor_id' })
    requestedFromVendor: Vendor;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @OneToMany(() => PurchaseRequisitionLine, (l) => l.purchaseRequisition)
    lines: PurchaseRequisitionLine[];
}
