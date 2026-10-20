import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import type {
    AudienceSpec,
    PushAudienceScope,
    PerCustomer,
    PushMessageStatus,
    RepeatRule,
    ScheduleType,
    VariantB,
} from '../push-messages/push-message.types';

/**
 * A push notification composed in the admin panel: the message, who gets it,
 * and when (now, once, or a repeat rule). The minute job sends it when
 * `next_run_at` comes due; each send is a `push_message_runs` row.
 *
 * Promos only: the automatic order-status notifications are sent by
 * PushNotificationService and never pass through here.
 */
@Entity('push_messages')
export class PushMessage {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** The brand it is sent for; brand-locked staff only see their brand's. */
    @Column({ name: 'brand_id', type: 'int', nullable: true })
    brandId: number | null;

    /** Internal label for the list; customers never see it. */
    @Column({ type: 'varchar', nullable: true })
    name: string | null;

    @Column({ length: 120 })
    title: string;

    @Column({ type: 'text' })
    body: string;

    /** Shown on Android only (the iOS app has no notification extension). */
    @Column({ name: 'image_url', type: 'text', nullable: true })
    imageUrl: string | null;

    /** A phone that was off longer than this never shows it. */
    @Column({ name: 'expiry_hours', type: 'int', default: 12 })
    expiryHours: number;

    /** A newer promo replaces this one in the phone's list instead of stacking. */
    @Column({ name: 'replace_previous', default: false })
    replacePrevious: boolean;

    @Column({ type: 'jsonb' })
    audience: AudienceSpec;

    /** When set, each send reads this saved audience's current rules. */
    @Column({ name: 'audience_id', type: 'int', nullable: true })
    audienceId: number | null;

    /**
     * The author's reach when it was saved — `brand_ids` for brand-locked
     * staff, `branch_ids` for branch-limited staff (absent = unrestricted).
     * Every send applies it, since the job has no request user.
     */
    @Column({ type: 'jsonb', default: () => "'{}'" })
    scope: PushAudienceScope;

    @Column({ name: 'skip_order_in_progress', default: true })
    skipOrderInProgress: boolean;

    @Column({ name: 'respect_cap', default: true })
    respectCap: boolean;

    /** How often one customer may get a repeating message. */
    @Column({ name: 'per_customer', length: 8, default: 'every' })
    perCustomer: PerCustomer;

    @Column({ name: 'per_customer_days', type: 'int', nullable: true })
    perCustomerDays: number | null;

    @Column({ name: 'schedule_type', length: 8 })
    scheduleType: ScheduleType;

    @Column({ name: 'send_at', type: 'timestamptz', nullable: true })
    sendAt: Date | null;

    @Column({ type: 'jsonb', nullable: true })
    repeat: RepeatRule | null;

    @Column()
    timezone: string;

    @Column({ length: 12, default: 'draft' })
    status: PushMessageStatus;

    @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
    nextRunAt: Date | null;

    @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
    lastRunAt: Date | null;

    @Column({ name: 'runs_count', type: 'int', default: 0 })
    runsCount: number;

    /** Local dates (YYYY-MM-DD) a repeating message skips. */
    @Column({ name: 'skip_dates', type: 'jsonb', default: () => "'[]'" })
    skipDates: string[];

    /** A/B test: the second version, and the % of the audience that gets it. */
    @Column({ name: 'variant_b', type: 'jsonb', nullable: true })
    variantB: VariantB | null;

    @Column({ name: 'ab_split', type: 'int', nullable: true })
    abSplit: number | null;

    /** % of each send's audience held back (not sent) to measure the lift. */
    @Column({ name: 'holdout_percent', type: 'int', default: 0 })
    holdoutPercent: number;

    @Column({ name: 'created_by', type: 'int', nullable: true })
    createdBy: number | null;

    @Column({ name: 'updated_by', type: 'int', nullable: true })
    updatedBy: number | null;

    @Column({ name: 'cancelled_by', type: 'int', nullable: true })
    cancelledBy: number | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;

    @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
    cancelledAt: Date | null;
}
