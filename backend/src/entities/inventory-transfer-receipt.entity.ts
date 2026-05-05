import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { InventoryTransferOrder } from './inventory-transfer-order.entity';
import { InventoryTransferReceiptLine } from './inventory-transfer-receipt-line.entity';

@Entity('inventory_transfer_receipts')
export class InventoryTransferReceipt {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    transferOrderId: number;

    @Column({ type: 'varchar', default: 'posted' })
    status: string;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'timestamp', nullable: true })
    postedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    postedBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => InventoryTransferOrder, (order) => order.receipts, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'transfer_order_id' })
    transferOrder: InventoryTransferOrder;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'posted_by' })
    postedByUser: User | null;

    @OneToMany(() => InventoryTransferReceiptLine, (line) => line.receipt)
    lines: InventoryTransferReceiptLine[];
}
