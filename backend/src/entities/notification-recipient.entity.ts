import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    Index,
    CreateDateColumn,
} from 'typeorm';
import { Notification } from './notification.entity';

/**
 * Per-user delivery row for a notification. Recipients are resolved at dispatch
 * time (a snapshot of the targeted roles), so a later role change does not alter an
 * already-open notification. `readAt` drives the per-user unread badge (bell);
 * shared/system notifications still resolve at the `notifications` row level.
 */
@Entity('notification_recipients')
@Index('UQ_notification_recipient', ['notificationId', 'userId'], {
    unique: true,
})
@Index('IDX_notification_recipient_user', ['userId', 'readAt'])
export class NotificationRecipient {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    notificationId: number;

    @Column()
    userId: number;

    @Column({ type: 'timestamp', nullable: true })
    readAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    dismissedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Notification, (n) => n.recipients, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'notification_id' })
    notification: Notification;
}
