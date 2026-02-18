import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Order } from './order.entity';

@Entity('loyalty_transactions')
export class LoyaltyTransaction {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    customerId: number;

    @Column({ nullable: true })
    orderId: number | null;

    @Column()
    points: number;

    @Column()
    type: string; // earn, redeem, adjust

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    customer: Customer;

    @ManyToOne(() => Order, { onDelete: 'SET NULL' })
    order: Order;
}
