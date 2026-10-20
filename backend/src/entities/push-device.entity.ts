import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Our copy of one Firestore token doc written by the mobile app at
 * `users/{owner_ref}/tokens/{token}` (fields token, platform, lastUpdated).
 *
 * The app writes Firestore directly and never tells the backend, so a job
 * (PushDeviceSyncService) re-reads the collection and mirrors it here. Not
 * tenant-scoped: Firestore is not; a row reaches a tenant through
 * `owner_id = customers.id`. Riders write the same path with their staff user
 * id, which is why audiences always skip customer ids equal to a rider's.
 */
@Entity('push_devices')
export class PushDevice {
    /** Firestore document path — unique per (owner, token). */
    @PrimaryColumn({ name: 'doc_path' })
    docPath: string;

    /** The `{userId}` folder, as Firestore holds it. */
    @Column({ name: 'owner_ref' })
    ownerRef: string;

    /** `owner_ref` when it is a whole number, else null. */
    @Column({ name: 'owner_id', type: 'int', nullable: true })
    ownerId: number | null;

    @Column({ type: 'text' })
    token: string;

    @Column({ type: 'varchar', length: 16, nullable: true })
    platform: string | null;

    /** The app's `lastUpdated` (server time of its last save). */
    @Column({ name: 'last_updated', type: 'timestamptz', nullable: true })
    lastUpdated: Date | null;

    @Column({ name: 'synced_at', type: 'timestamptz' })
    syncedAt: Date;
}
