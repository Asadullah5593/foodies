import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/** What an archive run produced, or why it refused to. */
export interface ArchiveResult {
    partition: string;
    month: string;
    rowCount: number;
    bytes: number;
    sha256: string;
    key: string;
    manifestKey: string;
    verified: boolean;
    dryRun: boolean;
}

/** A row as it comes off the partition: all columns, plus the two we key on. */
type ArchiveRow = Record<string, unknown> & {
    id: string | number;
    created_at: Date | string;
};

const PREFIX = 'activity-logs';
/** Rows read per round trip. Keeps memory flat regardless of month size. */
const PAGE = 5000;

/**
 * Writes a month of `activity_logs` to a compressed, self-describing file and
 * proves it arrived intact.
 *
 * Format is gzipped NDJSON — one JSON object per line, every column, ISO
 * timestamps. It is the smallest format that stays readable years from now with
 * tools that exist everywhere and no version of our code:
 *
 *     zcat activity-logs-2026-01.jsonl.gz | jq 'select(.action=="role.edit")'
 *
 * The ordering rule is the whole safety story: **archive → verify → drop.** The
 * caller may only drop a partition after `verified` comes back true, which means
 * the bytes were read BACK from the destination and re-hashed. Anything less
 * would be trusting a write we never confirmed.
 */
@Injectable()
export class ActivityLogArchiveService {
    private readonly logger = new Logger(ActivityLogArchiveService.name);
    private readonly region = process.env.AWS_REGION || 'ap-southeast-1';
    private s3?: S3Client;

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    /** `s3` in production; `local` keeps dev off the write-once bucket. */
    driver(): 's3' | 'local' {
        return (process.env.ACTIVITY_LOG_ARCHIVE_DRIVER || 'local')
            .trim()
            .toLowerCase() === 's3'
            ? 's3'
            : 'local';
    }

    bucket(): string {
        return (process.env.ACTIVITY_LOG_ARCHIVE_BUCKET || '').trim();
    }

    private localDir(): string {
        return (
            process.env.ACTIVITY_LOG_ARCHIVE_DIR ||
            join(process.cwd(), 'storage', 'activity-log-archives')
        );
    }

    private client(): S3Client {
        if (!this.s3) this.s3 = new S3Client({ region: this.region });
        return this.s3;
    }

    /** True when the configured destination is usable. */
    isConfigured(): boolean {
        return this.driver() === 'local' || this.bucket().length > 0;
    }

    /**
     * Archive one monthly partition. Does NOT drop it — that is the caller's
     * job, and only once `verified` is true.
     */
    async archivePartition(
        partition: string,
        opts: { dryRun?: boolean } = {},
    ): Promise<ArchiveResult> {
        const match = /^activity_logs_(\d{4})_(\d{2})$/.exec(partition);
        if (!match) {
            throw new Error(
                `Refusing to archive "${partition}": not a monthly partition`,
            );
        }
        const month = `${match[1]}-${match[2]}`;
        if (!this.isConfigured()) {
            throw new Error(
                'Archive destination not configured (set ACTIVITY_LOG_ARCHIVE_BUCKET, or use the local driver)',
            );
        }

        const base = `activity-logs-${month}`;
        const key = `${PREFIX}/${month}/${base}.jsonl.gz`;
        const manifestKey = `${PREFIX}/${month}/${base}.manifest.json`;
        const tmpFile = join(tmpdir(), `${base}-${process.pid}.jsonl.gz`);

        let rowCount = 0;
        let minAt: string | null = null;
        let maxAt: string | null = null;
        const hash = createHash('sha256');

        try {
            const gzip = createGzip({ level: 9 });
            const out = createWriteStream(tmpFile);
            // Hash the COMPRESSED bytes: that is what lands in the bucket, so
            // it is what a later integrity check can actually recompute.
            gzip.on('data', (chunk: Buffer) => hash.update(chunk));
            const writing = pipeline(gzip, out);

            // Keyset pagination on the primary key. OFFSET would re-scan from
            // the start on every page and quietly go quadratic on a big month.
            let afterCreatedAt: string | null = null;
            let afterId: string | null = null;
            for (;;) {
                const rows = await this.readPage(
                    partition,
                    afterCreatedAt,
                    afterId,
                );
                if (!rows.length) break;
                for (const row of rows) {
                    const createdAt = row.created_at as Date;
                    const iso =
                        createdAt instanceof Date
                            ? createdAt.toISOString()
                            : String(createdAt);
                    if (!minAt) minAt = iso;
                    maxAt = iso;
                    gzip.write(
                        `${JSON.stringify({ ...row, created_at: iso })}\n`,
                    );
                    rowCount++;
                }
                const last = rows[rows.length - 1];
                afterCreatedAt =
                    last.created_at instanceof Date
                        ? last.created_at.toISOString()
                        : String(last.created_at);
                afterId = String(last.id);
                if (rows.length < PAGE) break;
            }
            gzip.end();
            await writing;

            const sha256 = hash.digest('hex');
            const bytes = (await stat(tmpFile)).size;
            const manifest = {
                schema_version: 1,
                partition,
                month,
                row_count: rowCount,
                first_event_at: minAt,
                last_event_at: maxAt,
                bytes,
                sha256,
                object_key: key,
                archived_at: new Date().toISOString(),
                format: 'gzipped NDJSON; one JSON object per row, all columns',
            };

            if (opts.dryRun) {
                this.logger.log(
                    `[dry-run] ${partition}: ${rowCount} rows, ${bytes} bytes, sha256 ${sha256.slice(0, 12)}…`,
                );
                return {
                    partition,
                    month,
                    rowCount,
                    bytes,
                    sha256,
                    key,
                    manifestKey,
                    verified: false,
                    dryRun: true,
                };
            }

            await this.put(key, createReadStream(tmpFile), 'application/gzip');
            await this.put(
                manifestKey,
                Buffer.from(JSON.stringify(manifest, null, 2)),
                'application/json',
            );

            // Read it BACK and re-hash. An upload that returned 200 is not
            // evidence the bytes are correct, and the next step deletes the
            // only other copy.
            const verified = (await this.sha256Of(key)) === sha256;
            if (!verified) {
                throw new Error(
                    `Checksum mismatch for ${key} — refusing to report success (partition NOT safe to drop)`,
                );
            }
            this.logger.log(
                `archived ${partition}: ${rowCount} rows → ${key} (${bytes} bytes, verified)`,
            );
            return {
                partition,
                month,
                rowCount,
                bytes,
                sha256,
                key,
                manifestKey,
                verified: true,
                dryRun: false,
            };
        } finally {
            await rm(tmpFile, { force: true }).catch(() => undefined);
        }
    }

    /** Everything archived so far, newest first. */
    async listArchives(): Promise<
        Array<{ key: string; size: number; lastModified: string | null }>
    > {
        if (this.driver() === 'local') {
            return [];
        }
        const res = await this.client().send(
            new ListObjectsV2Command({
                Bucket: this.bucket(),
                Prefix: `${PREFIX}/`,
                MaxKeys: 500,
            }),
        );
        return (res.Contents ?? [])
            .filter((o) => o.Key?.endsWith('.jsonl.gz'))
            .map((o) => ({
                key: o.Key ?? '',
                size: o.Size ?? 0,
                lastModified: o.LastModified?.toISOString() ?? null,
            }))
            .sort((a, b) => (a.key < b.key ? 1 : -1));
    }

    private async put(
        key: string,
        body: Readable | Buffer,
        contentType: string,
    ): Promise<void> {
        if (this.driver() === 'local') {
            const path = join(this.localDir(), key);
            await mkdir(join(path, '..'), { recursive: true });
            if (Buffer.isBuffer(body)) {
                await pipeline(Readable.from(body), createWriteStream(path));
            } else {
                await pipeline(body, createWriteStream(path));
            }
            return;
        }
        await this.client().send(
            new PutObjectCommand({
                Bucket: this.bucket(),
                Key: key,
                Body: body,
                ContentType: contentType,
            }),
        );
    }

    /** Re-reads the stored object and hashes it. The verification step. */
    private async sha256Of(key: string): Promise<string> {
        const hash = createHash('sha256');
        if (this.driver() === 'local') {
            await pipeline(
                createReadStream(join(this.localDir(), key)),
                async function* (source) {
                    for await (const chunk of source) {
                        hash.update(chunk as Buffer);
                        yield chunk;
                    }
                },
                async function (source) {
                    // Drain: the hash is accumulated by the stage above.
                    for await (const chunk of source) {
                        void chunk;
                    }
                },
            );
            return hash.digest('hex');
        }
        const res = await this.client().send(
            new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
        );
        const body = res.Body as Readable;
        for await (const chunk of body) {
            hash.update(chunk as Buffer);
        }
        return hash.digest('hex');
    }

    /**
     * One page of a partition, keyset-paginated on the primary key.
     * OFFSET would re-scan from the start on every page and go quadratic on a
     * big month.
     */
    private async readPage(
        partition: string,
        afterCreatedAt: string | null,
        afterId: string | null,
    ): Promise<ArchiveRow[]> {
        const keyed = afterCreatedAt !== null && afterId !== null;
        const where = keyed
            ? 'WHERE (created_at, id) > ($1::timestamptz, $2::bigint)'
            : '';
        const params: unknown[] = keyed ? [afterCreatedAt, afterId] : [];
        const rows: unknown = await this.dataSource.query(
            `SELECT * FROM ${partition} ${where}
             ORDER BY created_at, id LIMIT ${PAGE}`,
            params,
        );
        return rows as ArchiveRow[];
    }
}
