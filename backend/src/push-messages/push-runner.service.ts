import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PushMessage } from '../entities/push-message.entity';
import { PushAudience } from '../entities/push-audience.entity';
import { PushSettingsService } from './push-settings.service';
import { PushAudienceService } from './push-audience.service';
import { PushDeviceSyncService, DeviceRow } from './push-device-sync.service';
import {
    PushSenderService,
    FCM_BATCH,
    OutgoingPush,
} from './push-sender.service';
import { devicePlatforms } from './push-audience-rules';
import { nextOccurrence } from './push-schedule';
import { isQuietTime } from './push-time';
import {
    hasPlaceholders,
    personalize,
    PersonalValues,
} from './push-personalize';
import type { AudienceSpec } from './push-message.types';
import { returningRows } from './push-sql';

/** A send whose process stopped beating this long ago is picked up again. */
const STALE_AFTER_MS = 5 * 60_000;
/** Customers handled per batch (a customer can have several phones). */
const CUSTOMERS_PER_BATCH = 200;

interface RunRow {
    id: number;
    message_id: number;
    tenant_id: number;
    scheduled_for: Date;
}

/**
 * The minute job behind every scheduled, repeating and "send now" message.
 *
 * Claiming is atomic: a due message is moved on to its next time with
 * `UPDATE … WHERE next_run_at = <the time we read>`, and the send itself is a
 * row unique on (message, time) — so two ticks, or two server processes,
 * never send the same occurrence twice.
 *
 * Quiet hours hold a due message until they end; a message that is already
 * later than its own expiry when it comes due (server down for a day) is
 * skipped rather than sent stale. Recipients are written before anything goes
 * out and marked batch by batch, so a restart carries on where it stopped and
 * a batch caught mid-flight is marked "unknown" instead of being sent again.
 */
@Injectable()
export class PushRunnerService {
    private readonly logger = new Logger(PushRunnerService.name);
    private ticking = false;

    constructor(
        private readonly dataSource: DataSource,
        private readonly settings: PushSettingsService,
        private readonly audiences: PushAudienceService,
        private readonly devices: PushDeviceSyncService,
        private readonly sender: PushSenderService,
    ) {}

    @Cron(CronExpression.EVERY_MINUTE)
    async scheduledTick(): Promise<void> {
        await this.tick();
    }

    /** Run now instead of waiting for the next minute ("Send now"). */
    kick(): void {
        setImmediate(() => void this.tick());
    }

    async tick(): Promise<void> {
        if (this.ticking) return;
        this.ticking = true;
        try {
            await this.resumeStaleRuns();
            await this.claimDue();
        } catch (error) {
            this.logger.error(
                'Push runner tick failed',
                error instanceof Error ? error.stack : error,
            );
        } finally {
            this.ticking = false;
        }
    }

    // ---------------------------------------------------------------------
    // Claiming due messages
    // ---------------------------------------------------------------------

    private async claimDue(): Promise<void> {
        const due: Array<{ id: number; tenant_id: number }> =
            await this.dataSource.query(
                `SELECT id, tenant_id FROM push_messages
                 WHERE next_run_at IS NOT NULL AND next_run_at <= now()
                   AND status IN ('scheduled', 'active')
                 ORDER BY next_run_at
                 LIMIT 20`,
            );
        for (const row of due) {
            const settings = await this.settings.get(row.tenant_id);
            const now = new Date();
            if (
                settings.quietHoursEnabled &&
                isQuietTime(
                    now,
                    settings.timezone,
                    settings.quietStart,
                    settings.quietEnd,
                )
            ) {
                continue; // held until the quiet hours end
            }
            const message = await this.dataSource
                .getRepository(PushMessage)
                .findOne({ where: { id: row.id } });
            if (!message || !message.nextRunAt) continue;
            const run = await this.claim(message, now);
            if (!run) continue;
            const lateMs = now.getTime() - message.nextRunAt.getTime();
            if (lateMs > message.expiryHours * 3_600_000) {
                await this.finishRun(run.id, 'skipped', {
                    note: 'Not sent: it came due while the server was down and was already past its expiry.',
                });
                await this.settleMessage(message.id);
                continue;
            }
            await this.executeRun(run, message);
        }
    }

    /**
     * Move the message on to its next time and open the send row. Returns null
     * when another tick got there first.
     */
    private async claim(
        message: PushMessage,
        now: Date,
    ): Promise<RunRow | null> {
        const scheduledFor = message.nextRunAt!;
        let next: Date | null = null;
        if (message.scheduleType === 'repeat' && message.repeat) {
            next = nextOccurrence(
                message.repeat,
                message.timezone,
                now > scheduledFor ? now : scheduledFor,
                message.runsCount + 1,
                message.skipDates ?? [],
            );
        }
        return this.dataSource.transaction(async (m) => {
            const moved = returningRows<{ id: number }>(
                await m.query(
                    `UPDATE push_messages
                 SET next_run_at = $2, last_run_at = now(), runs_count = runs_count + 1,
                     status = CASE WHEN schedule_type = 'repeat' THEN 'active' ELSE 'sending' END,
                     updated_at = now()
                 WHERE id = $1 AND next_run_at = $3 AND status IN ('scheduled', 'active')
                 RETURNING id`,
                    [message.id, next, scheduledFor],
                ),
            );
            if (moved.length === 0) return null;
            const runs: RunRow[] = await m.query(
                `INSERT INTO push_message_runs (message_id, tenant_id, scheduled_for, started_at, heartbeat_at, status)
                 VALUES ($1, $2, $3, now(), now(), 'sending')
                 ON CONFLICT (message_id, scheduled_for) DO NOTHING
                 RETURNING id, message_id, tenant_id, scheduled_for`,
                [message.id, message.tenantId, scheduledFor],
            );
            return runs[0] ?? null;
        });
    }

    // ---------------------------------------------------------------------
    // One send
    // ---------------------------------------------------------------------

    private async audienceOf(message: PushMessage): Promise<AudienceSpec> {
        if (message.audienceId) {
            const saved = await this.dataSource
                .getRepository(PushAudience)
                .findOne({
                    where: {
                        id: message.audienceId,
                        tenantId: message.tenantId,
                    },
                });
            if (saved) return saved.rules;
        }
        return message.audience;
    }

    /**
     * Work out the recipients (once, in one transaction) and send to them.
     * Safe to call again for a run whose recipients are already written.
     */
    async executeRun(run: RunRow, message: PushMessage): Promise<void> {
        try {
            const existing: Array<{ n: number }> = await this.dataSource.query(
                `SELECT count(*)::int AS n FROM push_message_recipients WHERE run_id = $1`,
                [run.id],
            );
            if (existing[0].n === 0) {
                await this.devices
                    .ensureFresh()
                    .catch((error) =>
                        this.logger.warn(
                            `Phone list refresh failed, sending from the last copy: ${error instanceof Error ? error.message : error}`,
                        ),
                    );
                await this.prepareRecipients(run, message);
            }
            await this.sendPending(run, message);
            await this.finishRun(
                run.id,
                this.sender.isConfigured ? 'sent' : 'failed',
                {
                    note: this.sender.isConfigured
                        ? null
                        : 'Firebase is not configured on this server, so nothing could be sent.',
                },
            );
        } catch (error) {
            this.logger.error(
                `Push message ${message.id} send ${run.id} failed`,
                error instanceof Error ? error.stack : error,
            );
            await this.finishRun(run.id, 'failed', {
                note: error instanceof Error ? error.message : String(error),
            });
        }
        await this.settleMessage(message.id);
    }

    private async prepareRecipients(
        run: RunRow,
        message: PushMessage,
    ): Promise<void> {
        const settings = await this.settings.get(message.tenantId);
        const audience = await this.audienceOf(message);
        const rows = await this.audiences.evaluate({
            tenantId: message.tenantId,
            audience,
            scope: message.scope ?? {},
            platforms: devicePlatforms(audience),
            skipOrderInProgress: message.skipOrderInProgress,
            respectCap: message.respectCap,
            capPerDay: settings.capPerDay,
            capPerWeek: settings.capPerWeek,
            perCustomer:
                message.scheduleType === 'repeat'
                    ? {
                          messageId: message.id,
                          mode: message.perCustomer,
                          days: message.perCustomerDays,
                      }
                    : null,
        });
        const counts = this.audiences.count(rows);
        const eligible = shuffle(rows.filter((r) => !r.skip));
        const holdoutCount = Math.floor(
            (eligible.length * (message.holdoutPercent ?? 0)) / 100,
        );
        const holdout = eligible.slice(0, holdoutCount);
        const send = eligible.slice(holdoutCount);
        const abSplit =
            message.variantB && message.abSplit ? message.abSplit : null;
        const bCount = abSplit ? Math.round((send.length * abSplit) / 100) : 0;
        const variantOf = (i: number): string | null =>
            abSplit ? (i < bCount ? 'B' : 'A') : null;

        await this.dataSource.transaction(async (m) => {
            const all = [
                ...holdout.map((r) => ({
                    r,
                    status: 'holdout',
                    variant: null as string | null,
                })),
                ...send.map((r, i) => ({
                    r,
                    status: 'pending',
                    variant: variantOf(i),
                })),
            ];
            for (let i = 0; i < all.length; i += 5000) {
                const chunk = all.slice(i, i + 5000);
                await m.query(
                    `INSERT INTO push_message_recipients
                        (run_id, message_id, tenant_id, customer_id, variant, status, phones, sent_at)
                     SELECT $1, $2, $3, x.customer_id, x.variant, x.status, x.phones,
                            CASE WHEN x.status = 'holdout' THEN now() END
                     FROM unnest($4::int[], $5::text[], $6::text[], $7::int[])
                          AS x(customer_id, variant, status, phones)
                     ON CONFLICT (run_id, customer_id) DO NOTHING`,
                    [
                        run.id,
                        message.id,
                        message.tenantId,
                        chunk.map((c) => c.r.id),
                        chunk.map((c) => c.variant),
                        chunk.map((c) => c.status),
                        chunk.map((c) => c.r.phones),
                    ],
                );
            }
            await m.query(
                `UPDATE push_message_runs SET
                    matched = $2, with_app = $3, recipients = $4,
                    skipped_opt_out = $5, skipped_cap = $6, skipped_in_progress = $7,
                    skipped_repeat = $8, skipped_rider = $9, holdout = $10,
                    heartbeat_at = now()
                 WHERE id = $1`,
                [
                    run.id,
                    counts.matched,
                    counts.with_app,
                    send.length,
                    counts.skipped.opt_out,
                    counts.skipped.cap,
                    counts.skipped.in_progress,
                    counts.skipped.repeat,
                    counts.skipped.rider,
                    holdout.length,
                ],
            );
        });
    }

    private async sendPending(
        run: RunRow,
        message: PushMessage,
    ): Promise<void> {
        const audience = await this.audienceOf(message);
        const platforms = devicePlatforms(audience);
        const personal =
            hasPlaceholders(message.title) ||
            hasPlaceholders(message.body) ||
            (message.variantB != null &&
                (hasPlaceholders(message.variantB.title) ||
                    hasPlaceholders(message.variantB.body)));
        for (;;) {
            const status: Array<{ status: string }> =
                await this.dataSource.query(
                    `SELECT status FROM push_messages WHERE id = $1`,
                    [message.id],
                );
            if (status[0]?.status === 'cancelled') {
                await this.dataSource.query(
                    `UPDATE push_message_recipients SET status = 'cancelled'
                     WHERE run_id = $1 AND status = 'pending'`,
                    [run.id],
                );
                await this.dataSource.query(
                    `UPDATE push_message_runs SET note = 'Stopped part-way: the message was cancelled.' WHERE id = $1`,
                    [run.id],
                );
                return;
            }
            // Claim the next batch: pending → sending, in one statement.
            const batch = returningRows<{
                id: string;
                customer_id: number;
                variant: string | null;
            }>(
                await this.dataSource.query(
                    `UPDATE push_message_recipients SET status = 'sending'
                     WHERE id IN (
                         SELECT id FROM push_message_recipients
                         WHERE run_id = $1 AND status = 'pending'
                         ORDER BY id LIMIT $2
                         FOR UPDATE SKIP LOCKED)
                     RETURNING id, customer_id, variant`,
                    [run.id, CUSTOMERS_PER_BATCH],
                ),
            );
            if (batch.length === 0) return;
            await this.sendBatch(run, message, batch, platforms, personal);
            await this.dataSource.query(
                `UPDATE push_message_runs SET heartbeat_at = now() WHERE id = $1`,
                [run.id],
            );
        }
    }

    private async sendBatch(
        run: RunRow,
        message: PushMessage,
        batch: Array<{
            id: string;
            customer_id: number;
            variant: string | null;
        }>,
        platforms: string[] | null,
        personal: boolean,
    ): Promise<void> {
        const ids = batch.map((b) => b.customer_id);
        const devices = await this.audiences.devicesFor(ids, platforms);
        const values = personal
            ? await this.personalValues(ids)
            : new Map<number, PersonalValues>();
        const byCustomer = new Map<number, DeviceRow[]>();
        for (const d of devices) {
            const list = byCustomer.get(d.owner_id!) ?? [];
            list.push(d);
            byCustomer.set(d.owner_id!, list);
        }
        const pushes: Array<
            OutgoingPush & { customerId: number; device: DeviceRow }
        > = [];
        for (const b of batch) {
            const useB = b.variant === 'B' && message.variantB;
            const title = useB ? message.variantB!.title : message.title;
            const body = useB ? message.variantB!.body : message.body;
            const v = values.get(b.customer_id) ?? {};
            for (const device of byCustomer.get(b.customer_id) ?? []) {
                pushes.push({
                    token: device.token,
                    title: personal ? personalize(title, v) : title,
                    body: personal ? personalize(body, v) : body,
                    customerId: b.customer_id,
                    device,
                });
            }
        }

        const perCustomer = new Map<
            number,
            { sent: number; failed: number; error: string | null }
        >();
        const dead: DeviceRow[] = [];
        for (let i = 0; i < pushes.length; i += FCM_BATCH) {
            const chunk = pushes.slice(i, i + FCM_BATCH);
            const results = await this.sender.sendBatch(chunk, {
                messageId: message.id,
                imageUrl: message.imageUrl,
                expiryHours: message.expiryHours,
                replacePrevious: message.replacePrevious,
            });
            results.forEach((r, j) => {
                const p = chunk[j];
                const agg = perCustomer.get(p.customerId) ?? {
                    sent: 0,
                    failed: 0,
                    error: null,
                };
                if (r.ok) agg.sent++;
                else {
                    agg.failed++;
                    agg.error = agg.error ?? r.error;
                    if (r.dead) dead.push(p.device);
                }
                perCustomer.set(p.customerId, agg);
            });
        }

        // Write every customer's outcome in one statement.
        const rows = batch.map((b) => {
            const agg = perCustomer.get(b.customer_id);
            if (!agg) {
                return {
                    id: b.id,
                    status: 'failed',
                    sent: 0,
                    failed: 0,
                    phones: 0,
                    error: 'No phone left to send to',
                };
            }
            return {
                id: b.id,
                status: agg.sent > 0 ? 'sent' : 'failed',
                sent: agg.sent,
                failed: agg.failed,
                phones: agg.sent + agg.failed,
                error: agg.sent > 0 ? null : agg.error,
            };
        });
        await this.dataSource.query(
            `UPDATE push_message_recipients r SET
                status = x.status, sent = x.sent, failed = x.failed, phones = x.phones,
                error = x.error, sent_at = now()
             FROM unnest($1::bigint[], $2::text[], $3::int[], $4::int[], $5::int[], $6::text[])
                  AS x(id, status, sent, failed, phones, error)
             WHERE r.id = x.id`,
            [
                rows.map((r) => r.id),
                rows.map((r) => r.status),
                rows.map((r) => r.sent),
                rows.map((r) => r.failed),
                rows.map((r) => r.phones),
                rows.map((r) => r.error),
            ],
        );
        const sent = rows.reduce((s, r) => s + r.sent, 0);
        const failed = rows.reduce((s, r) => s + r.failed, 0);
        await this.dataSource.query(
            `UPDATE push_message_runs SET phones = phones + $2, sent = sent + $3, failed = failed + $4
             WHERE id = $1`,
            [run.id, sent + failed, sent, failed],
        );
        if (dead.length) {
            await this.devices.removeDevices(
                dead,
                'Firebase says the app is no longer on that phone',
            );
        }
    }

    /** Values for {first_name}, {app_points}, {last_brand}. */
    async personalValues(
        customerIds: number[],
    ): Promise<Map<number, PersonalValues>> {
        const rows: Array<{
            id: number;
            name: string | null;
            app_points: string | null;
            last_brand: string | null;
        }> = await this.dataSource.query(
            `SELECT c.id, c.name,
                        (SELECT w.balance FROM loyalty_wallets w
                          WHERE w.customer_id = c.id AND w.wallet_type = 'app' LIMIT 1) AS app_points,
                        (SELECT b.name FROM orders o JOIN brands b ON b.id = o.brand_id
                          WHERE o.customer_id = c.id AND o.status <> 'cancelled'
                          ORDER BY o.placed_at DESC LIMIT 1) AS last_brand
                 FROM customers c WHERE c.id = ANY($1::int[])`,
            [customerIds],
        );
        return new Map(
            rows.map((r) => [
                Number(r.id),
                {
                    name: r.name,
                    app_points:
                        r.app_points != null ? Number(r.app_points) : null,
                    last_brand: r.last_brand,
                },
            ]),
        );
    }

    // ---------------------------------------------------------------------
    // Finishing and recovery
    // ---------------------------------------------------------------------

    private async finishRun(
        runId: number,
        status: 'sent' | 'failed' | 'skipped',
        extra: { note: string | null },
    ): Promise<void> {
        await this.dataSource.query(
            `UPDATE push_message_runs
             SET status = $2, finished_at = now(), heartbeat_at = now(),
                 note = COALESCE($3, note)
             WHERE id = $1`,
            [runId, status, extra.note],
        );
    }

    /**
     * After a send: a one-off becomes "sent" (or "failed" when nothing went
     * out), a repeat with no next time becomes "completed".
     */
    private async settleMessage(messageId: number): Promise<void> {
        await this.dataSource.query(
            `UPDATE push_messages m SET
                status = CASE
                    WHEN m.status = 'sending' THEN
                        CASE WHEN EXISTS (SELECT 1 FROM push_message_runs r
                                          WHERE r.message_id = m.id AND r.status = 'sent')
                             THEN 'sent' ELSE 'failed' END
                    WHEN m.status = 'active' AND m.next_run_at IS NULL THEN 'completed'
                    ELSE m.status END,
                updated_at = now()
             WHERE m.id = $1`,
            [messageId],
        );
    }

    /** Pick up sends whose process died mid-way (restart, deploy, crash). */
    private async resumeStaleRuns(): Promise<void> {
        const stale = returningRows<RunRow>(
            await this.dataSource.query(
                `UPDATE push_message_runs SET heartbeat_at = now()
             WHERE status = 'sending'
               AND COALESCE(heartbeat_at, started_at) < now() - make_interval(secs => $1)
             RETURNING id, message_id, tenant_id, scheduled_for`,
                [STALE_AFTER_MS / 1000],
            ),
        );
        for (const run of stale) {
            if (!run?.id || !run.message_id) continue;
            // A batch caught mid-flight may or may not have reached the phones:
            // never send it twice.
            await this.dataSource.query(
                `UPDATE push_message_recipients SET status = 'unknown', sent_at = now()
                 WHERE run_id = $1 AND status = 'sending'`,
                [run.id],
            );
            const message = await this.dataSource
                .getRepository(PushMessage)
                .findOne({ where: { id: run.message_id } });
            if (!message) continue;
            this.logger.warn(
                `Resuming push send ${run.id} of message ${message.id}`,
            );
            await this.executeRun(run, message);
        }
    }
}

/** Fisher–Yates: random hold-back and A/B groups. */
function shuffle<T>(items: T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
