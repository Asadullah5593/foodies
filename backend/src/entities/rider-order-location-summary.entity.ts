import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToOne,
    JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';

type SummaryPoint = {
    latitude: number;
    longitude: number;
    recorded_at: string;
};

@Entity('rider_order_location_summaries')
export class RiderOrderLocationSummary {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    orderId: number;

    @Column({ type: 'int', default: 0 })
    pointsCount: number;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    startLatitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    startLongitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    endLatitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    endLongitude: number | null;

    @Column({ type: 'timestamp', nullable: true })
    startRecordedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    endRecordedAt: Date | null;

    @Column({ type: 'jsonb', nullable: true })
    sampledPath: SummaryPoint[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;
}
