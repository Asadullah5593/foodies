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
import { Brand } from './brand.entity';
import { InventoryItem } from './inventory-item.entity';
import { InventoryBatch } from './inventory-batch.entity';
import { InventoryLocation } from './inventory-location.entity';
import { User } from './user.entity';

@Entity('inventory_ledger_entries')
export class InventoryLedgerEntry {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    // null = branch pool movement; a brand id = movement within that brand's bucket.
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'int', nullable: true })
    inventoryBatchId: number | null;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    qtyDelta: number;

    @Column()
    eventType: string;

    @Column({ type: 'varchar', nullable: true })
    eventRefType: string | null;

    @Column({ type: 'int', nullable: true })
    eventRefId: number | null;

    @Column({ type: 'varchar', nullable: true })
    idempotencyKey: string | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => InventoryBatch, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'inventory_batch_id' })
    inventoryBatch: InventoryBatch | null;

    @ManyToOne(() => InventoryLocation, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'location_id' })
    location: InventoryLocation | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;
}
