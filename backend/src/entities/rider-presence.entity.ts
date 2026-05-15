import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Branch } from './branch.entity';

@Entity('rider_presences')
export class RiderPresence {
    @PrimaryColumn()
    riderUserId: number;

    @Column({ nullable: true })
    branchId: number | null;

    @Column({ default: false })
    isCheckedIn: boolean;

    @Column({ default: false })
    isPaused: boolean;

    @Column({ type: 'text', nullable: true })
    pauseReason: string | null;

    @Column({ type: 'timestamp', nullable: true })
    lastHeartbeatAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    lastLocationAt: Date | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    lastLatitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    lastLongitude: number | null;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'rider_user_id' })
    riderUser: User;

    @ManyToOne(() => Branch, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch | null;
}
