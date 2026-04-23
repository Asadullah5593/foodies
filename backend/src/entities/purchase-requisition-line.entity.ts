import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { PurchaseRequisition } from './purchase-requisition.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';

@Entity('purchase_requisition_lines')
export class PurchaseRequisitionLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    purchaseRequisitionId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    requestedQty: number;

    @Column()
    requestedUomId: number;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => PurchaseRequisition, (pr) => pr.lines, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'purchase_requisition_id' })
    purchaseRequisition: PurchaseRequisition;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'requested_uom_id' })
    requestedUom: Uom;
}

