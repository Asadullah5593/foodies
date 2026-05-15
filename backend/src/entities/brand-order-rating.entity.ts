import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    Unique,
} from 'typeorm';
import { Order } from './order.entity';
import { Brand } from './brand.entity';
import { Customer } from './customer.entity';

@Entity('brand_order_ratings')
@Unique(['orderId', 'brandId'])
@Index(['brandId'])
export class BrandOrderRating {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderId: number;

    @Column()
    brandId: number;

    @Column()
    customerId: number;

    @Column({ type: 'smallint' })
    stars: number;

    @Column({ type: 'jsonb' })
    orderItemIds: number[];

    @Column({ type: 'text', nullable: true })
    comment: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;

    @ManyToOne(() => Brand, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customer_id' })
    customer: Customer;
}
