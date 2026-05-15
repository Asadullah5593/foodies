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
import { RiderAttendanceSession } from './rider-attendance-session.entity';

@Entity('rider_break_sessions')
export class RiderBreakSession {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    riderUserId: number;

    /** Open attendance session when the break started (if any). */
    @Column({ type: 'int', nullable: true })
    attendanceSessionId: number | null;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'timestamp' })
    startedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    endedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    reason: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'rider_user_id' })
    riderUser: User;

    @ManyToOne(() => Branch, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch | null;

    @ManyToOne(() => RiderAttendanceSession, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'attendance_session_id' })
    attendanceSession: RiderAttendanceSession | null;
}
