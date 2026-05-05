import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { InventoryAdjustment } from './inventory-adjustment.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';
import { InventoryLocation } from './inventory-location.entity';
import { InventoryBatch } from './inventory-batch.entity';

@Entity('inventory_adjustment_lines')
export class InventoryAdjustmentLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    inventoryAdjustmentId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    qty: number;

    @Column()
    qtyUomId: number;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

    @Column({ type: 'int', nullable: true })
    inventoryBatchId: number | null;

    @Column({ type: 'varchar', nullable: true })
    lotCode: string | null;

    @Column({ type: 'date', nullable: true })
    expiryDate: string | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => InventoryAdjustment, (adj) => adj.lines, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'inventory_adjustment_id' })
    adjustment: InventoryAdjustment;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'qty_uom_id' })
    qtyUom: Uom;

    @ManyToOne(() => InventoryLocation, {
        nullable: true,
        onDelete: 'SET NULL',
    })
    @JoinColumn({ name: 'location_id' })
    location: InventoryLocation | null;

    @ManyToOne(() => InventoryBatch, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'inventory_batch_id' })
    inventoryBatch: InventoryBatch | null;
}
