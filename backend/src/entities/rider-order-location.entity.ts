import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';

@Entity('rider_order_locations')
export class RiderOrderLocation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderId: number;

    @Column({ type: 'decimal', precision: 10, scale: 7 })
    latitude: number;

    @Column({ type: 'decimal', precision: 10, scale: 7 })
    longitude: number;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    order: Order;
}
