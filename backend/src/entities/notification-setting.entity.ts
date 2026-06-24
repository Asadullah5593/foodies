import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

/**
 * Dynamic role-targeting config for a notification event type. One row per scope:
 * - `branchId` null + `brandId` null  → tenant-wide default for the event type
 * - `branchId` set,  `brandId` null    → per-branch override (all brands)
 * - `branchId` set,  `brandId` set     → per-branch + per-brand override
 *
 * Dispatch picks the MOST SPECIFIC existing row (brand → branch → tenant default).
 * When no row exists, the catalog defaults (defaultRoleSlugs) apply. A row with
 * `isEnabled = false` explicitly mutes the event for that scope.
 *
 * Uniqueness across the nullable scope columns is enforced by a COALESCE-sentinel
 * unique index in the migration (NULLs treated as 0).
 */
@Entity('notification_settings')
export class NotificationSetting {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    eventType: string;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    /** Role IDs that should receive this event in this scope. */
    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    targetRoleIds: number[];

    @Column({ default: true })
    soundEnabled: boolean;

    @Column({ default: true })
    isEnabled: boolean;

    /** Future-proofing for additional channels (in_app, push, …). */
    @Column({ type: 'jsonb', nullable: true })
    channels: string[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
