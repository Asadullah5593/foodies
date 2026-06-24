import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToMany,
    Index,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { NotificationRecipient } from './notification-recipient.entity';
import type { NotificationActionDef } from '../notifications/notification-events';

/**
 * One notification instance (an event that occurred), fanned out to one or more
 * recipients via `notification_recipients`. The lifecycle is `open` → `resolved`;
 * see `resolutionMode` for who/what resolves it. `dedupeKey` (unique among open
 * rows) collapses recurring conditions such as repeated low-stock sweeps.
 */
@Entity('notifications')
@Index('IDX_notifications_tenant_status', ['tenantId', 'status'])
@Index('IDX_notifications_type_branch_status', ['type', 'branchId', 'status'])
export class Notification {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** Operations are branch-scoped; null reserved for future tenant-wide events. */
    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    /** Single-brand context (null = applies to all brands at the branch). */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    /** Event-type key from the notification catalog (notification-events.ts). */
    @Column()
    type: string;

    /** Cached from the catalog for cheap client-side routing/filtering. */
    @Column()
    category: string;

    @Column()
    surface: string;

    @Column({ default: 'info' })
    severity: string;

    @Column({ default: 'shared' })
    resolutionMode: string;

    @Column()
    title: string;

    @Column({ type: 'text', nullable: true })
    body: string | null;

    /** Arbitrary structured payload (orderId, orderNumber, itemId, batchId, …). */
    @Column({ type: 'jsonb', nullable: true })
    data: Record<string, unknown> | null;

    /** Action descriptors snapshotted from the catalog at dispatch time. */
    @Column({ type: 'jsonb', nullable: true })
    actions: NotificationActionDef[] | null;

    /** Whether a sound should play for this notification (resolved from settings). */
    @Column({ default: false })
    soundEnabled: boolean;

    /** Collapses recurring conditions; unique among `open` rows (partial index). */
    @Column({ type: 'varchar', nullable: true })
    dedupeKey: string | null;

    @Column({ default: 'open' })
    status: string;

    @Column({ type: 'timestamp', nullable: true })
    resolvedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    resolvedByUserId: number | null;

    @Column({ type: 'varchar', nullable: true })
    resolvedAction: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToMany(() => NotificationRecipient, (r) => r.notification)
    recipients: NotificationRecipient[];
}
