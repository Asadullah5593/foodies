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

    // null = the branch's shared pool (where GRN receipts land); a brand id = that
    // brand's allocated bucket within the branch.
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

    @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 })
    qty: number;

    // Set when a sale drives this bucket negative (allow-negative POS policy); a UI flag.
    @Column({ type: 'timestamp', nullable: true })
    negativeFlaggedAt: Date | null;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;

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
