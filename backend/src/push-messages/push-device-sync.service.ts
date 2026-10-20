import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import type * as admin from 'firebase-admin';
import { FirebaseService } from '../firebase/firebase.service';
import { returningRows } from './push-sql';

/** One Firestore token doc as read from `users/{owner}/tokens/{token}`. */
export interface FirestoreTokenDoc {
    docPath: string;
    ownerRef: string;
    token: string;
    platform: string | null;
    lastUpdated: Date | null;
}

export interface DeviceRow {
    doc_path: string;
    owner_ref: string;
    owner_id: number | null;
    token: string;
    platform: string | null;
}

const PAGE_SIZE = 1000;
/** How stale our copy may be before a send refreshes it first. */
const FRESH_ENOUGH_MS = 15 * 60_000;

/**
 * Keeps `push_devices` — our copy of the phones the app registered in
 * Firestore — in step with Firestore.
 *
 * The app writes `users/{id}/tokens/{token}` straight to Firestore and never
 * tells the backend, so the only way to know who has the app is to read the
 * collection: every 3 hours, and before any send when the copy is older than
 * 15 minutes. A few thousand docs, well inside Firestore's free daily reads.
 *
 * Nightly it also tidies Firestore itself: the app never deletes a token on
 * logout, so a phone handed to someone else sits under both accounts. The
 * newest save (`lastUpdated`, rewritten at every logged-in app start) owns the
 * phone; the older copies are deleted, which also stops the automatic order
 * updates of the previous owner reaching that phone.
 */
@Injectable()
export class PushDeviceSyncService {
    private readonly logger = new Logger(PushDeviceSyncService.name);
    private running: Promise<{ synced: number; removed: number }> | null = null;
    private lastSyncAt: Date | null = null;

    constructor(
        private readonly firebase: FirebaseService,
        private readonly dataSource: DataSource,
    ) {}

    get isConfigured(): boolean {
        return this.firebase.isConfigured;
    }

    @Cron(CronExpression.EVERY_3_HOURS)
    async scheduledSync(): Promise<void> {
        try {
            await this.syncAll();
        } catch (error) {
            this.logger.error(
                'Push device sync failed',
                error instanceof Error ? error.stack : error,
            );
        }
    }

    @Cron('30 3 * * *', { timeZone: 'Asia/Karachi' })
    async nightlyTidy(): Promise<void> {
        try {
            await this.syncAll();
            await this.removeOlderOwners();
        } catch (error) {
            this.logger.error(
                'Nightly push device tidy failed',
                error instanceof Error ? error.stack : error,
            );
        }
    }

    /** When our copy was last refreshed (from the table, so it survives restarts). */
    async lastSyncedAt(): Promise<Date | null> {
        if (this.lastSyncAt) return this.lastSyncAt;
        const rows: Array<{ at: Date | null }> = await this.dataSource.query(
            `SELECT max(synced_at) AS at FROM push_devices`,
        );
        return rows[0]?.at ? new Date(rows[0].at) : null;
    }

    /** Refresh first if the copy is older than 15 minutes. */
    async ensureFresh(): Promise<void> {
        const at = await this.lastSyncedAt();
        if (at && Date.now() - at.getTime() < FRESH_ENOUGH_MS) return;
        await this.syncAll();
    }

    /** Re-read every token doc; one at a time even if called concurrently. */
    syncAll(): Promise<{ synced: number; removed: number }> {
        if (!this.running) {
            this.running = this.doSync().finally(() => {
                this.running = null;
            });
        }
        return this.running;
    }

    private async doSync(): Promise<{ synced: number; removed: number }> {
        const firestore = this.firebase.firestore;
        if (!firestore) return { synced: 0, removed: 0 };
        const startedAt = new Date();
        let synced = 0;
        let last: admin.firestore.QueryDocumentSnapshot | null = null;
        for (;;) {
            let q = firestore.collectionGroup('tokens').limit(PAGE_SIZE);
            if (last) q = q.startAfter(last);
            const snap = await q.get();
            if (snap.empty) break;
            const docs: FirestoreTokenDoc[] = [];
            for (const doc of snap.docs) {
                const parsed = parseTokenDoc(doc.ref.path, doc.data());
                if (parsed) docs.push(parsed);
            }
            await this.upsert(docs, startedAt);
            synced += docs.length;
            last = snap.docs[snap.docs.length - 1];
            if (snap.size < PAGE_SIZE) break;
        }
        // Whatever this pass did not see no longer exists in Firestore.
        const removed = returningRows<{ doc_path: string }>(
            await this.dataSource.query(
                `DELETE FROM push_devices WHERE synced_at < $1 RETURNING doc_path`,
                [startedAt],
            ),
        );
        this.lastSyncAt = startedAt;
        this.logger.log(
            `Push devices synced: ${synced} phone registrations, ${removed.length} gone`,
        );
        return { synced, removed: removed.length };
    }

    private async upsert(docs: FirestoreTokenDoc[], at: Date): Promise<void> {
        if (docs.length === 0) return;
        await this.dataSource.query(
            `INSERT INTO push_devices (doc_path, owner_ref, owner_id, token, platform, last_updated, synced_at)
             SELECT d.doc_path, d.owner_ref,
                    CASE WHEN d.owner_ref ~ '^[0-9]{1,9}$' THEN d.owner_ref::int END,
                    d.token, d.platform, d.last_updated, $6
             FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[])
                  AS d(doc_path, owner_ref, token, platform, last_updated)
             ON CONFLICT (doc_path) DO UPDATE SET
                 token = EXCLUDED.token,
                 platform = EXCLUDED.platform,
                 last_updated = EXCLUDED.last_updated,
                 synced_at = EXCLUDED.synced_at`,
            [
                docs.map((d) => d.docPath),
                docs.map((d) => d.ownerRef),
                docs.map((d) => d.token),
                docs.map((d) => d.platform),
                docs.map((d) => d.lastUpdated),
                at,
            ],
        );
    }

    /**
     * Where one token sits under several owners, keep the newest save and
     * delete the rest — in Firestore and in our copy.
     */
    async removeOlderOwners(): Promise<number> {
        const older: DeviceRow[] = await this.dataSource.query(
            `SELECT d.doc_path, d.owner_ref, d.owner_id, d.token, d.platform
             FROM push_devices d
             WHERE EXISTS (
                 SELECT 1 FROM push_devices n
                 WHERE n.token = d.token AND n.doc_path <> d.doc_path
                   AND COALESCE(n.last_updated, 'epoch') > COALESCE(d.last_updated, 'epoch')
             )`,
        );
        if (older.length === 0) return 0;
        await this.removeDevices(older, 'phone now used by another account');
        return older.length;
    }

    /**
     * Delete token docs Firebase says are dead (app uninstalled, token
     * replaced) or that belong to an older owner. Never throws.
     */
    async removeDevices(devices: DeviceRow[], reason: string): Promise<void> {
        if (devices.length === 0) return;
        const firestore = this.firebase.firestore;
        try {
            if (firestore) {
                for (let i = 0; i < devices.length; i += 400) {
                    const batch = firestore.batch();
                    for (const d of devices.slice(i, i + 400)) {
                        batch.delete(firestore.doc(d.doc_path));
                    }
                    await batch.commit();
                }
            }
            await this.dataSource.query(
                `DELETE FROM push_devices WHERE doc_path = ANY($1::text[])`,
                [devices.map((d) => d.doc_path)],
            );
            this.logger.log(
                `Removed ${devices.length} phone registration(s): ${reason}`,
            );
        } catch (error) {
            this.logger.error(
                `Could not remove ${devices.length} phone registration(s)`,
                error instanceof Error ? error.stack : error,
            );
        }
    }
}

/**
 * Read one Firestore doc into a device row, or null when it is not an app
 * token doc (`users/{owner}/tokens/{token}` with a token string).
 */
export function parseTokenDoc(
    path: string,
    data: Record<string, unknown>,
): FirestoreTokenDoc | null {
    const parts = path.split('/');
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'tokens') {
        return null;
    }
    const token =
        typeof data.token === 'string' && data.token ? data.token : parts[3];
    if (!token) return null;
    const platform =
        typeof data.platform === 'string' ? data.platform.toLowerCase() : null;
    const raw = data.lastUpdated as
        | { toDate?: () => Date }
        | Date
        | string
        | null
        | undefined;
    let lastUpdated: Date | null = null;
    if (raw instanceof Date) lastUpdated = raw;
    else if (
        raw &&
        typeof raw === 'object' &&
        typeof raw.toDate === 'function'
    ) {
        lastUpdated = raw.toDate();
    } else if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) {
        lastUpdated = new Date(raw);
    }
    return {
        docPath: path,
        ownerRef: parts[1],
        token,
        platform,
        lastUpdated,
    };
}
