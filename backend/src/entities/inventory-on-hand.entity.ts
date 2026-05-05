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
import { InventoryItem } from './inventory-item.entity';
import { InventoryLocation } from './inventory-location.entity';

@Entity('inventory_on_hand')
export class InventoryOnHand {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

    @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 })
    qty: number;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => InventoryItem, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => InventoryLocation, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'location_id' })
    location: InventoryLocation | null;
}
