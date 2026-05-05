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
import { PurchaseRequisition } from './purchase-requisition.entity';
import { User } from './user.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';

@Entity('purchase_orders')
export class PurchaseOrder {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    poNumber: string;

    @Column()
    buyerBranchId: number;

    @Column()
    vendorId: number;

    @Column({ type: 'int', nullable: true })
    purchaseRequisitionId: number | null;

    /** created | sent | partially_received | closed | cancelled */
    @Column({ default: 'created' })
    status: string;

    @Column({ type: 'date', nullable: true })
    expectedDeliveryDate: string | null;

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
    @JoinColumn({ name: 'buyer_branch_id' })
    buyerBranch: Branch;

    @ManyToOne(() => Vendor, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'vendor_id' })
    vendor: Vendor;

    @ManyToOne(() => PurchaseRequisition, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'purchase_requisition_id' })
    purchaseRequisition: PurchaseRequisition | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @OneToMany(() => PurchaseOrderLine, (l) => l.purchaseOrder)
    lines: PurchaseOrderLine[];
}
