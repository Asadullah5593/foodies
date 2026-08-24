import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Single-row runtime config the mobile apps read on launch (id is always 1).
 *
 * It is a kill switch, not a settings bag: when a build is too old to talk to
 * this API safely, `force_update_*` plus `min_required_version_*` let the app
 * block itself and send the user to the store without shipping a new binary.
 */
@Entity('app_config')
export class AppConfig {
    /** Always 1 — the table holds exactly one row. */
    @PrimaryColumn({ type: 'int', default: 1 })
    id: number;

    @Column({ type: 'boolean', default: false })
    forceUpdateAndroid: boolean;

    @Column({ type: 'boolean', default: false })
    forceUpdateIos: boolean;

    @Column({ type: 'varchar', length: 20, default: '1.0.0' })
    minRequiredVersionAndroid: string;

    @Column({ type: 'varchar', length: 20, default: '1.0.0' })
    minRequiredVersionIos: string;

    @Column({ type: 'text', nullable: true })
    updateMessage: string | null;

    @Column({ type: 'text', nullable: true })
    storeUrlAndroid: string | null;

    @Column({ type: 'text', nullable: true })
    storeUrlIos: string | null;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;
}
