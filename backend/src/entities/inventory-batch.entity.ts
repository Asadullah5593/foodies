import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { InventoryItem } from './inventory-item.entity';
import { Vendor } from './vendor.entity';

@Entity('inventory_batches')
export class InventoryBatch {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'int', nullable: true })
    vendorId: number | null;

    @Column({ type: 'int', nullable: true })
    purchaseOrderId: number | null;

    @Column({ type: 'int', nullable: true })
    goodsReceiptNoteId: number | null;

    @Column({ type: 'varchar', nullable: true })
    lotCode: string | null;

    @Column({ default: 'v1' })
    batchVersion: string;

    @Column({ type: 'date', nullable: true })
    expiryDate: string | null;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    receivedAt: Date;

    /** available | quarantined | blocked | expired */
    @Column({ default: 'available' })
    status: string;

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

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Vendor, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'vendor_id' })
    vendor: Vendor | null;
}

