import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ActivityLogArchiveService } from './activity-log-archive.service';

/** Partitions kept ahead of "now" so a row can never arrive without a home. */
const MONTHS_AHEAD = 3;
/** Months kept in Postgres before a partition becomes archivable (Phase 6). */
const DEFAULT_HOT_MONTHS = 3;
/** Hard floor: nothing younger than this can ever be dropped, by anyone. */
const MIN_DROP_AGE_MONTHS = 3;

/**
 * Keeps `activity_logs` partitioned and bounded.
 *
 * Phase 0 does the additive half only: make sure the next few months exist.
 * That is safe by construction — `CREATE TABLE … PARTITION OF` on a future
 * range takes no lock anything else is waiting on, and creating a partition
 * that already exists is a no-op.
 *
 * The destructive half (archive to S3, verify, then DROP the partition) lands
 * in Phase 6. The guard rails are already here so they cannot be forgotten
 * later: dropping requires `ACTIVITY_LOG_RETENTION_ENABLED=true`, honours a
 * dry-run flag, and refuses anything younger than MIN_DROP_AGE_MONTHS.
 *
 * Mirrors `orders/rider-location-retention.service.ts` (daily cron, `*_DRY_RUN`
 * env flag, one summary log line). 2 AM and 3 AM are taken by other jobs.
 */
@Injectable()
export class ActivityLogMaintenanceService {
    private readonly logger = new Logger(ActivityLogMaintenanceService.name);

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly archive: ActivityLogArchiveService,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async handleDailyMaintenance(): Promise<void> {
        await this.run();
    }

    /** Never throws: a maintenance failure must not take the app down. */
    async run(): Promise<{ created: string[]; dropped: string[] }> {
        const created: string[] = [];
        const dropped: string[] = [];
        try {
            created.push(...(await this.ensureFuturePartitions()));
            dropped.push(...(await this.dropExpiredPartitions()));
            const defaultRows = await this.defaultPartitionCount();
            if (defaultRows > 0) {
                // Should be impossible while we stay months ahead. If it happens,
                // rows are landing outside every declared range.
                this.logger.warn(
                    `activity_logs_default holds ${defaultRows} rows — partition coverage has a gap`,
                );
            }
            this.logger.log(
                `activity log maintenance: ${created.length} partition(s) created, ${dropped.length} dropped, default=${defaultRows}`,
            );
        } catch (e) {
            this.logger.error(`activity log maintenance failed: ${String(e)}`);
        }
        return { created, dropped };
    }

    /** `activity_logs_2026_01` — must match the migration's naming exactly. */
    partitionName(year: number, month: number): string {
        return `activity_logs_${year}_${String(month).padStart(2, '0')}`;
    }

    /** First day of a month as `YYYY-MM-DD`, normalising month overflow. */
    monthStart(year: number, month: number): string {
        const y = year + Math.floor((month - 1) / 12);
        const m = ((month - 1) % 12) + 1;
        return `${y}-${String(m).padStart(2, '0')}-01`;
    }

    private async ensureFuturePartitions(): Promise<string[]> {
        const now = new Date();
        const made: string[] = [];
        for (let i = 0; i < MONTHS_AHEAD; i++) {
            const year = now.getUTCFullYear();
            const month = now.getUTCMonth() + 1 + i;
            const name = this.partitionName(
                year + Math.floor((month - 1) / 12),
                ((month - 1) % 12) + 1,
            );
            const exists = await this.partitionExists(name);
            if (exists) continue;
            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS ${name}
                PARTITION OF activity_logs
                FOR VALUES FROM ('${this.monthStart(year, month)}')
                             TO ('${this.monthStart(year, month + 1)}')
            `);
            made.push(name);
        }
        return made;
    }

    /**
     * Phase 6 will archive first and only then drop. Until archiving exists,
     * this stays behind an explicit opt-in so no deployment can quietly start
     * deleting audit history.
     */
    private async dropExpiredPartitions(): Promise<string[]> {
        if (!this.isRetentionEnabled()) return [];
        const retentionMonths = this.retentionMonths();
        const dryRun = this.isDryRunEnabled();
        const cutoff = new Date();
        cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);

        const partitions = await this.listPartitions();
        const dropped: string[] = [];
        for (const { name, start } of partitions) {
            if (start >= cutoff) continue;
            const ageMonths = this.monthsBetween(start, new Date());
            if (ageMonths < MIN_DROP_AGE_MONTHS) continue;

            // ARCHIVE → VERIFY → DROP, in that order, always. The archive is
            // read back and re-hashed before anything is deleted; if that fails
            // we log and move on, leaving the data exactly where it is. The
            // next run retries. There is no path here that drops first.
            try {
                const result = await this.archive.archivePartition(name, {
                    dryRun,
                });
                if (dryRun) {
                    this.logger.log(
                        `[dry-run] would archive ${name} (${result.rowCount} rows) then drop it`,
                    );
                    continue;
                }
                if (!result.verified) {
                    this.logger.error(
                        `archive of ${name} did not verify — keeping the partition`,
                    );
                    continue;
                }
                await this.dataSource.query(`DROP TABLE IF EXISTS ${name}`);
                dropped.push(name);
                this.logger.log(
                    `dropped ${name} after verified archive ${result.key}`,
                );
            } catch (e) {
                // A failed archive must never cost us the data.
                this.logger.error(
                    `could not archive ${name}, partition kept: ${String(e)}`,
                );
            }
        }
        return dropped;
    }

    private async partitionExists(name: string): Promise<boolean> {
        const rows: Array<{ exists: boolean }> = await this.dataSource.query(
            `SELECT to_regclass($1) IS NOT NULL AS exists`,
            [name],
        );
        return rows[0]?.exists === true;
    }

    /** Every month partition with its lower bound, parsed from the catalog. */
    private async listPartitions(): Promise<
        Array<{ name: string; start: Date }>
    > {
        const rows: Array<{ name: string }> = await this.dataSource.query(`
            SELECT c.relname AS name
            FROM pg_inherits i
            JOIN pg_class c ON c.oid = i.inhrelid
            JOIN pg_class p ON p.oid = i.inhparent
            WHERE p.relname = 'activity_logs'
        `);
        const out: Array<{ name: string; start: Date }> = [];
        for (const { name } of rows) {
            const m = /^activity_logs_(\d{4})_(\d{2})$/.exec(name);
            if (!m) continue; // skips activity_logs_default, which is never dropped
            out.push({
                name,
                start: new Date(Date.UTC(+m[1], +m[2] - 1, 1)),
            });
        }
        return out;
    }

    private async defaultPartitionCount(): Promise<number> {
        try {
            const rows: Array<{ count: string }> = await this.dataSource.query(
                `SELECT count(*)::text AS count FROM activity_logs_default`,
            );
            return Number(rows[0]?.count ?? 0);
        } catch {
            return 0;
        }
    }

    private monthsBetween(from: Date, to: Date): number {
        return (
            (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
            (to.getUTCMonth() - from.getUTCMonth())
        );
    }

    private retentionMonths(): number {
        const raw = Number(process.env.ACTIVITY_LOG_RETENTION_MONTHS);
        if (!Number.isFinite(raw) || raw < DEFAULT_HOT_MONTHS) return 13;
        return Math.min(24, Math.floor(raw));
    }

    private isRetentionEnabled(): boolean {
        return (
            String(process.env.ACTIVITY_LOG_RETENTION_ENABLED || '')
                .trim()
                .toLowerCase() === 'true'
        );
    }

    private isDryRunEnabled(): boolean {
        const raw = String(process.env.ACTIVITY_LOG_RETENTION_DRY_RUN || '')
            .trim()
            .toLowerCase();
        // Defaults to dry-run: deleting audit history must be opted into twice.
        return raw !== 'false';
    }
}
