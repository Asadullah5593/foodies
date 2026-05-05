import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Stocktake } from './stocktake.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';
import { InventoryLocation } from './inventory-location.entity';

@Entity('stocktake_lines')
export class StocktakeLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    stocktakeId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    countedQty: number;

    @Column()
    countedUomId: number;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Stocktake, (st) => st.lines, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'stocktake_id' })
    stocktake: Stocktake;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'counted_uom_id' })
    countedUom: Uom;

    @ManyToOne(() => InventoryLocation, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'location_id' })
    location: InventoryLocation | null;
}
