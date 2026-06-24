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
import { Brand } from './brand.entity';
import { User } from './user.entity';
import { InventoryTransferRequest } from './inventory-transfer-request.entity';
import { InventoryTransferReceipt } from './inventory-transfer-receipt.entity';

@Entity('inventory_transfer_orders')
export class InventoryTransferOrder {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    transferRequestId: number;

    @Column()
    sourceBranchId: number;

    @Column({ type: 'int', nullable: true })
    sourceBrandId: number | null;

    @Column()
    destinationBranchId: number;

    @Column({ type: 'int', nullable: true })
    destinationBrandId: number | null;

    @Column({ type: 'varchar', default: 'approved' })
    status: string;

    @Column({ type: 'timestamp', nullable: true })
    dispatchedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    dispatchedBy: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => InventoryTransferRequest, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'transfer_request_id' })
    transferRequest: InventoryTransferRequest;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'source_branch_id' })
    sourceBranch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'source_brand_id' })
    sourceBrand: Brand | null;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'destination_branch_id' })
    destinationBranch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'destination_brand_id' })
    destinationBrand: Brand | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'dispatched_by' })
    dispatchedByUser: User | null;

    @OneToMany(
        () => InventoryTransferReceipt,
        (receipt) => receipt.transferOrder,
    )
    receipts: InventoryTransferReceipt[];
}
