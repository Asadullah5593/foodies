import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { InventoryTransferReceipt } from './inventory-transfer-receipt.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';
import { InventoryLocation } from './inventory-location.entity';

@Entity('inventory_transfer_receipt_lines')
export class InventoryTransferReceiptLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    transferReceiptId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    receivedQty: number;

    @Column()
    receivedUomId: number;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

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

    @ManyToOne(() => InventoryTransferReceipt, (receipt) => receipt.lines, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'transfer_receipt_id' })
    receipt: InventoryTransferReceipt;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'received_uom_id' })
    receivedUom: Uom;

    @ManyToOne(() => InventoryLocation, {
        nullable: true,
        onDelete: 'SET NULL',
    })
    @JoinColumn({ name: 'location_id' })
    location: InventoryLocation | null;
}
