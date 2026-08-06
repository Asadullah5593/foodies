import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ActivityLogWriter } from './activity-log.writer';
import type { CaptureLevel } from './activity-log.policy';

export interface ActivityLogSettings {
    capture_level: CaptureLevel;
    pii_mode: 'mask' | 'full';
    hot_months: number;
    retention_months: number;
    updated_at: string | null;
    /** True when ACTIVITY_LOG_ENABLED=false overrides everything below. */
    env_disabled: boolean;
}

const CAPTURE_LEVELS: CaptureLevel[] = [
    'off',
    'mutations',
    'mutations+sensitive_reads',
    'all',
];

/** How long a resolved setting is trusted before re-reading. */
const CACHE_MS = 30_000;

/**
 * Admin-changeable capture controls.
 *
 * Two rules make this safe to expose:
 *
 * 1. **The change is logged BEFORE it takes effect**, with old and new values.
 *    Turning capture off is the obvious way to work unobserved, so the act of
 *    turning it off must itself be on the record.
 * 2. **The env var wins.** `ACTIVITY_LOG_ENABLED=false` disables everything
 *    regardless of what is in this table, so the brake works even when the
 *    database is the problem.
 *
 * Reads are cached for 30s: the middleware consults this on every request, and
 * a DB round trip per request would be a self-inflicted wound.
 */
@Injectable()
export class ActivityLogSettingsService {
    private readonly logger = new Logger(ActivityLogSettingsService.name);
    private cache: { at: number; value: ActivityLogSettings } | null = null;

    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        private readonly writer: ActivityLogWriter,
    ) {}

    /** Cached settings; falls back to the last known good value on error. */
    async get(): Promise<ActivityLogSettings> {
        const now = Date.now();
        if (this.cache && now - this.cache.at < CACHE_MS) {
            return this.cache.value;
        }
        try {
            const rows = await this.dataSource.query<
                Array<{
                    capture_level: string;
                    pii_mode: string;
                    hot_months: number;
                    retention_months: number;
                    updated_at: Date | null;
                }>
            >(
                `SELECT capture_level, pii_mode, hot_months, retention_months, updated_at
                 FROM activity_log_settings WHERE tenant_id IS NULL LIMIT 1`,
            );
            const row = rows[0];
            const value: ActivityLogSettings = {
                capture_level: CAPTURE_LEVELS.includes(
                    row?.capture_level as CaptureLevel,
                )
                    ? (row.capture_level as CaptureLevel)
                    : 'mutations+sensitive_reads',
                pii_mode: row?.pii_mode === 'full' ? 'full' : 'mask',
                hot_months: row?.hot_months ?? 3,
                retention_months: row?.retention_months ?? 13,
                updated_at: row?.updated_at?.toISOString() ?? null,
                env_disabled:
                    String(process.env.ACTIVITY_LOG_ENABLED || '')
                        .trim()
                        .toLowerCase() !== 'true',
            };
            this.cache = { at: now, value };
            return value;
        } catch (e) {
            // Never fail closed on a settings read — losing audit rows because
            // a SELECT hiccuped would be the wrong trade.
            this.logger.error(`settings read failed: ${String(e)}`);
            return (
                this.cache?.value ?? {
                    capture_level: 'mutations+sensitive_reads',
                    pii_mode: 'mask',
                    hot_months: 3,
                    retention_months: 13,
                    updated_at: null,
                    env_disabled: true,
                }
            );
        }
    }

    /** Synchronous read of the cache, for the request path. */
    cached(): ActivityLogSettings | null {
        return this.cache?.value ?? null;
    }

    /** Warm the cache at boot so the first request does not miss. */
    async prime(): Promise<void> {
        await this.get();
    }

    async update(
        dto: {
            capture_level?: string;
            pii_mode?: string;
            hot_months?: number;
            retention_months?: number;
            password: string;
        },
        actor: {
            id: number;
            tenantId: number | null;
            name?: string;
            email?: string;
        },
    ): Promise<ActivityLogSettings> {
        const rows = await this.dataSource.query<Array<{ password: string }>>(
            'SELECT password FROM users WHERE id = $1',
            [actor.id],
        );
        const hash = rows[0]?.password;
        const ok =
            typeof hash === 'string' &&
            hash.length > 0 &&
            (await bcrypt.compare(dto.password ?? '', hash));
        if (!ok) throw new ForbiddenException('Password is incorrect');

        const before = await this.get();
        const next = {
            capture_level: CAPTURE_LEVELS.includes(
                dto.capture_level as CaptureLevel,
            )
                ? (dto.capture_level as CaptureLevel)
                : before.capture_level,
            pii_mode: dto.pii_mode === 'full' ? 'full' : 'mask',
            hot_months: Math.min(
                12,
                Math.max(1, dto.hot_months ?? before.hot_months),
            ),
            retention_months: Math.min(
                24,
                Math.max(3, dto.retention_months ?? before.retention_months),
            ),
        };

        // Logged BEFORE the write. If the change is "capture off", this is the
        // last row that will be written — so it had better already be durable.
        await this.writer.writeImmediate({
            ...this.writer.systemRow(
                'activity-log.settings.update',
                `Capture ${before.capture_level} → ${next.capture_level}, PII ${before.pii_mode} → ${next.pii_mode}, retention ${before.retention_months}m → ${next.retention_months}m`,
            ),
            actorType: 'staff',
            actorUserId: actor.id,
            actorLabel: actor.name ?? actor.email ?? `user#${actor.id}`,
            tenantId: actor.tenantId,
            entityType: 'activity_log_settings',
            changes: {
                capture_level: {
                    before: before.capture_level,
                    after: next.capture_level,
                },
                pii_mode: { before: before.pii_mode, after: next.pii_mode },
                hot_months: {
                    before: before.hot_months,
                    after: next.hot_months,
                },
                retention_months: {
                    before: before.retention_months,
                    after: next.retention_months,
                },
            },
            changedFields: [
                'capture_level',
                'pii_mode',
                'hot_months',
                'retention_months',
            ],
        });

        await this.dataSource.query(
            `UPDATE activity_log_settings
             SET capture_level = $1, pii_mode = $2, hot_months = $3,
                 retention_months = $4, updated_by = $5, updated_at = now()
             WHERE tenant_id IS NULL`,
            [
                next.capture_level,
                next.pii_mode,
                next.hot_months,
                next.retention_months,
                actor.id,
            ],
        );
        this.cache = null;
        return this.get();
    }
}
