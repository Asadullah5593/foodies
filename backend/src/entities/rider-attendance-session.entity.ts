import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Branch } from './branch.entity';

@Entity('rider_attendance_sessions')
export class RiderAttendanceSession {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    riderUserId: number;

    @Column()
    branchId: number;

    @Column({ type: 'varchar', length: 32, default: 'checked_in' })
    status: string;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    checkedInAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    checkedOutAt: Date | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'rider_user_id' })
    riderUser: User;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;
}
