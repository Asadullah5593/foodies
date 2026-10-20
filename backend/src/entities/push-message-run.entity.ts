import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * One actual send of a push message (a "send now" or one occurrence of a
 * schedule), with what happened. Unique on (message_id, scheduled_for), so two
 * job ticks — or two server processes — can never both claim the same send.
 */
@Entity('push_message_runs')
export class PushMessageRun {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'message_id' })
    messageId: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** The occurrence this send belongs to (the schedule's time, not the clock's). */
    @Column({ name: 'scheduled_for', type: 'timestamptz' })
    scheduledFor: Date;

    @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
    startedAt: Date | null;

    @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
    finishedAt: Date | null;

    /** Bumped after every batch; a stale one marks a send whose process died. */
    @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
    heartbeatAt: Date | null;

    @Column({ length: 12, default: 'sending' })
    status: 'sending' | 'sent' | 'failed' | 'skipped';

    /** Customers the rules matched. */
    @Column({ type: 'int', default: 0 })
    matched: number;

    /** …of whom have the app on at least one phone. */
    @Column({ name: 'with_app', type: 'int', default: 0 })
    withApp: number;

    /** Customers actually sent to (after every skip and the hold-back). */
    @Column({ type: 'int', default: 0 })
    recipients: number;

    @Column({ type: 'int', default: 0 })
    phones: number;

    @Column({ type: 'int', default: 0 })
    sent: number;

    @Column({ type: 'int', default: 0 })
    failed: number;

    @Column({ name: 'skipped_opt_out', type: 'int', default: 0 })
    skippedOptOut: number;

    @Column({ name: 'skipped_cap', type: 'int', default: 0 })
    skippedCap: number;

    @Column({ name: 'skipped_in_progress', type: 'int', default: 0 })
    skippedInProgress: number;

    /** Left out by the message's own "once ever / once every N days". */
    @Column({ name: 'skipped_repeat', type: 'int', default: 0 })
    skippedRepeat: number;

    /** Customer id equal to a rider's staff id (shared Firestore folder). */
    @Column({ name: 'skipped_rider', type: 'int', default: 0 })
    skippedRider: number;

    @Column({ type: 'int', default: 0 })
    holdout: number;

    @Column({ type: 'text', nullable: true })
    note: string | null;
}
