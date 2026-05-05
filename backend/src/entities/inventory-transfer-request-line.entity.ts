import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { InventoryTransferRequest } from './inventory-transfer-request.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';

@Entity('inventory_transfer_request_lines')
export class InventoryTransferRequestLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    transferRequestId: number;

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

    @ManyToOne(() => InventoryTransferRequest, (tr) => tr.lines, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'transfer_request_id' })
    transferRequest: InventoryTransferRequest;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'requested_uom_id' })
    requestedUom: Uom;
}
