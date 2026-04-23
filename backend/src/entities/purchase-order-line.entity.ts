import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { PurchaseOrder } from './purchase-order.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';

@Entity('purchase_order_lines')
export class PurchaseOrderLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    purchaseOrderId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    orderedQty: number;

    @Column()
    orderedUomId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    unitCost: number | null;

    @Column({ type: 'decimal', precision: 9, scale: 6, nullable: true })
    taxRate: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => PurchaseOrder, (po) => po.lines, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'purchase_order_id' })
    purchaseOrder: PurchaseOrder;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'ordered_uom_id' })
    orderedUom: Uom;
}

