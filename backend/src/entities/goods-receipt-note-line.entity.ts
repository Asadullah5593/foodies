import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { GoodsReceiptNote } from './goods-receipt-note.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';
import { InventoryLocation } from './inventory-location.entity';

@Entity('goods_receipt_note_lines')
export class GoodsReceiptNoteLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    goodsReceiptNoteId: number;

    @Column({ type: 'int', nullable: true })
    purchaseOrderLineId: number | null;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    receivedQty: number;

    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    acceptedQty: number | null;

    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    rejectedQty: number | null;

    @Column({ type: 'text', nullable: true })
    rejectionReason: string | null;

    @Column({ type: 'boolean', default: false })
    isOverReceived: boolean;

    @Column({ type: 'boolean', default: false })
    isMismatchedItem: boolean;

    @Column()
    receivedUomId: number;

    @Column({ type: 'varchar', nullable: true })
    lotCode: string | null;

    @Column({ type: 'date', nullable: true })
    expiryDate: string | null;

    @Column({ type: 'int', nullable: true })
    locationId: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => GoodsReceiptNote, (grn) => grn.lines, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'goods_receipt_note_id' })
    goodsReceiptNote: GoodsReceiptNote;

    @ManyToOne(() => PurchaseOrderLine, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'purchase_order_line_id' })
    purchaseOrderLine: PurchaseOrderLine | null;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'received_uom_id' })
    receivedUom: Uom;

    @ManyToOne(() => InventoryLocation, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'location_id' })
    location: InventoryLocation | null;
}
