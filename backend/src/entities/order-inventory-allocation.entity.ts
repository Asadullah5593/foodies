import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { Brand } from './brand.entity';
import { Order } from './order.entity';
import { InventoryItem } from './inventory-item.entity';
import { InventoryBatch } from './inventory-batch.entity';

@Entity('order_inventory_allocations')
export class OrderInventoryAllocation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    // The brand bucket the stock was consumed from (orders are single-brand).
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    orderId: number;

    @Column()
    inventoryItemId: number;

    // null for an allow-negative shortfall allocation (no batch to attribute to).
    @Column({ type: 'int', nullable: true })
    inventoryBatchId: number | null;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    qty: number;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => InventoryBatch, { onDelete: 'RESTRICT', nullable: true })
    @JoinColumn({ name: 'inventory_batch_id' })
    inventoryBatch: InventoryBatch | null;
}
