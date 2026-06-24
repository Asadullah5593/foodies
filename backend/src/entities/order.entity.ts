import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Brand } from './brand.entity';
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import { Payment } from './payment.entity';
import { Discount } from './discount.entity';
import { Customer } from './customer.entity';

@Entity('orders')
export class Order {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** Single brand when all items are same brand; null when order has items from multiple brands (e.g. food court). */
    @Column({ nullable: true })
    brandId: number | null;

    /** Groups multiple orders from one customer placement (e.g. multi-brand cart). Same ID across all orders in the group. */
    @Column({ type: 'varchar', length: 36, nullable: true })
    orderGroupId: string | null;

    @Column()
    branchId: number;

    /**
     * Permanent, globally-unique tracking reference shared with the customer.
     * Format: `BR-{brandId}-{branchId}-{YYYYMMDD}-{seq}` (e.g. `BR-23-10-20260617-001`).
     * Null on orders created before migration ShortOrderNumber (legacy rows).
     * Unique index: `UQ_orders_order_id`.
     */
    @Column({ type: 'varchar', nullable: true })
    orderId: string | null;

    /**
     * Short daily call-out number shown to staff and printed on receipts/KDS.
     * Format: `001`, `002` … resets to `001` every day per branch+brand.
     * NOT globally unique — the permanent tracking key is `orderId`.
     * Uniqueness within a day is enforced by `UQ_orders_branch_brand_day_number`.
     */
    @Column()
    orderNumber: string;

    @Column({ type: 'varchar' })
    orderType: string;

    @Column({ type: 'varchar', nullable: true })
    tableNumber: string | null;

    @Column({ type: 'varchar', nullable: true })
    customerName: string | null;

    @Column({ type: 'varchar', nullable: true })
    customerPhone: string | null;

    @Column({ nullable: true })
    customerId: number | null;

    @Column({ default: 'placed' })
    status: string;

    @Column({ default: 'pos' })
    source: string;

    @Column({ type: 'text', nullable: true })
    deliveryAddress: string | null;

    /** Drop-off / customer location for delivery or pickup (consumer app). */
    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    deliveryLatitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    deliveryLongitude: number | null;

    /** Optional branch coordinates snapshot captured at order placement time. */
    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    branchLatitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    branchLongitude: number | null;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    subtotal: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    discountAmount: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    taxAmount: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    serviceCharge: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    deliveryFee: number;

    /** Selected delivery service tier for delivery orders: 'saver' | 'standard' | 'priority'. Null otherwise. */
    @Column({ type: 'varchar', length: 16, nullable: true })
    deliveryTier: string | null;

    /** Static ETA snapshot (minutes) for the chosen tier, captured at order time. */
    @Column({ type: 'int', nullable: true })
    deliveryEtaMinMinutes: number | null;

    @Column({ type: 'int', nullable: true })
    deliveryEtaMaxMinutes: number | null;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    totalAmount: number;

    @Column({ nullable: true })
    discountId: number | null;

    @Column({ type: 'varchar', nullable: true })
    discountCode: string | null;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    placedAt: Date;

    @Column({ default: 0 })
    loyaltyPointsEarned: number;

    @Column({ default: 0 })
    loyaltyPointsRedeemed: number;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'timestamp', nullable: true })
    completedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    cancelledAt: Date | null;

    /** Assigned delivery rider (user with Rider role). */
    @Column({ nullable: true })
    riderId: number | null;

    /** Delivery lifecycle: accepted (mandatory once assigned) → picked_up → delivered | delivery_failed */
    @Column({ type: 'varchar', length: 32, nullable: true })
    deliveryStatus: string | null;

    @Column({ type: 'text', nullable: true })
    deliveryFailedReason: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.orders, { onDelete: 'CASCADE' })
    tenant: Tenant;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    brand: Brand | null;

    @ManyToOne(() => Branch, (b) => b.orders, { onDelete: 'CASCADE' })
    branch: Branch;

    @ManyToOne(() => Customer, { onDelete: 'SET NULL' })
    customer: Customer;

    @ManyToOne(() => Discount, { onDelete: 'SET NULL' })
    discount: Discount;

    @ManyToOne(() => User, (u) => u.orders, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    creator: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'rider_id' })
    rider: User | null;

    @OneToMany(() => OrderItem, (oi) => oi.order)
    orderItems: OrderItem[];

    @OneToMany(() => Payment, (p) => p.order)
    payments: Payment[];
}
