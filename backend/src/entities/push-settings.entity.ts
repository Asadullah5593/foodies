import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * One tenant's guard rails for admin push notifications. Created with the
 * defaults on first read (PushSettingsService.get); every field is editable on
 * the Settings tab by holders of `push-notifications:settings`.
 */
@Entity('push_settings')
export class PushSettings {
    @PrimaryColumn({ name: 'tenant_id' })
    tenantId: number;

    /** IANA zone every schedule and the quiet hours are read in. */
    @Column()
    timezone: string;

    @Column({ name: 'quiet_hours_enabled', default: true })
    quietHoursEnabled: boolean;

    /** HH:mm; the window may cross midnight (01:00–10:00, 22:00–08:00). */
    @Column({ name: 'quiet_start', length: 5 })
    quietStart: string;

    @Column({ name: 'quiet_end', length: 5 })
    quietEnd: string;

    /** Most promos one customer gets in any 24 hours; null = no limit. */
    @Column({ name: 'cap_per_day', type: 'int', nullable: true })
    capPerDay: number | null;

    /** Most promos one customer gets in any 7 days; null = no limit. */
    @Column({ name: 'cap_per_week', type: 'int', nullable: true })
    capPerWeek: number | null;

    /** Pre-filled "expires after" on a new message. */
    @Column({ name: 'default_expiry_hours', type: 'int' })
    defaultExpiryHours: number;

    /** Pre-ticked "leave out customers with an order in progress". */
    @Column({ name: 'skip_order_in_progress', default: true })
    skipOrderInProgress: boolean;

    /** Customer phone numbers that "Send test" goes to. */
    @Column({ name: 'test_phones', type: 'jsonb', default: () => "'[]'" })
    testPhones: string[];

    @Column({ name: 'updated_by', type: 'int', nullable: true })
    updatedBy: number | null;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
