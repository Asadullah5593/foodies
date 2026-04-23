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
import { Branch } from './branch.entity';
import { PurchaseOrder } from './purchase-order.entity';
import { User } from './user.entity';
import { GoodsReceiptNoteLine } from './goods-receipt-note-line.entity';

@Entity('goods_receipt_notes')
export class GoodsReceiptNote {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column()
    purchaseOrderId: number;

    /** draft | posted | reversed */
    @Column({ default: 'draft' })
    status: string;

    @Column({ type: 'int', nullable: true })
    receivedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    receivedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    postedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    postedBy: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => PurchaseOrder, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'purchase_order_id' })
    purchaseOrder: PurchaseOrder;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'received_by' })
    receiver: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'posted_by' })
    poster: User | null;

    @OneToMany(() => GoodsReceiptNoteLine, (l) => l.goodsReceiptNote)
    lines: GoodsReceiptNoteLine[];
}

