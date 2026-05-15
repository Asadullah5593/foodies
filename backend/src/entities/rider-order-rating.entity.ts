import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';
import { Order } from './order.entity';
import { Customer } from './customer.entity';
import { User } from './user.entity';

@Entity('rider_order_ratings')
@Index(['riderUserId'])
export class RiderOrderRating {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'int', unique: true })
    orderId: number;

    @Column()
    customerId: number;

    @Column()
    riderUserId: number;

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

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customer_id' })
    customer: Customer;

    @ManyToOne(() => User, { onDelete: 'NO ACTION' })
    @JoinColumn({ name: 'rider_user_id' })
    riderUser: User;
}
