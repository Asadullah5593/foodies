import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PushMessage } from '../entities/push-message.entity';
import { PushAudience } from '../entities/push-audience.entity';
import { PushTemplate } from '../entities/push-template.entity';
import { PushSettingsService } from './push-settings.service';
import {
    PushAudienceService,
    EvaluatedCustomer,
} from './push-audience.service';
import { PushDeviceSyncService } from './push-device-sync.service';
import { PushSenderService } from './push-sender.service';
import { PushRunnerService } from './push-runner.service';
import {
    audienceRulesMeta,
    devicePlatforms,
    normalizeAudience,
    ORDER_SOURCES,
    ORDER_TYPES,
    phoneKey,
    PHONE_KEY_SQL,
} from './push-audience-rules';
import {
    nextOccurrence,
    normalizeRepeatRule,
    upcomingOccurrences,
} from './push-schedule';
import { isQuietTime, localParts, quietEndsAt } from './push-time';
import {
    hasPlaceholders,
    PERSONAL_TOKENS,
    personalize,
    unknownPlaceholders,
} from './push-personalize';
import {
    EMPTY_AUDIENCE,
    type AudienceSpec,
    type PerCustomer,
    type PushAudienceScope,
    type PushMessageStatus,
    type PushViewerScope,
    type RepeatRule,
    type ScheduleType,
} from './push-message.types';

export interface PushUser {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
}

/** Body of POST/PUT /admin/push-notifications/messages. */
export interface SaveMessageBody {
    action?: 'draft' | 'schedule';
    name?: string | null;
    brand_id?: number | null;
    title?: string;
    body?: string;
    image_url?: string | null;
    expiry_hours?: number;
    replace_previous?: boolean;
    audience?: AudienceSpec;
    audience_id?: number | null;
    skip_order_in_progress?: boolean;
    respect_cap?: boolean;
    per_customer?: PerCustomer;
    per_customer_days?: number | null;
    schedule_type?: ScheduleType;
    send_at?: string | null;
    repeat?: RepeatRule | null;
    variant_b?: { title: string; body: string } | null;
    ab_split?: number | null;
    holdout_percent?: number;
}

const EDITABLE: PushMessageStatus[] = [
    'draft',
    'scheduled',
    'active',
    'paused',
];
const STATUS_GROUPS: Record<string, PushMessageStatus[]> = {
    scheduled: ['scheduled', 'sending'],
    repeating: ['active', 'paused'],
    sent: ['sent', 'completed', 'failed'],
    drafts: ['draft'],
    cancelled: ['cancelled'],
};
/** A row passed straight through to the page. */
type Row = Record<string, unknown>;
type CountRow = { n: number };

const TITLE_MAX = 120;
const BODY_MAX = 1000;

/**
 * Everything the admin page does with push notifications except the sending
 * itself (PushRunnerService). Tenant-scoped throughout; brand-locked staff see
 * and reach only their brand, branch-limited staff only their branches.
 */
@Injectable()
export class PushMessagesService {
    constructor(
        @InjectRepository(PushMessage)
        private readonly messages: Repository<PushMessage>,
        @InjectRepository(PushAudience)
        private readonly savedAudiences: Repository<PushAudience>,
        @InjectRepository(PushTemplate)
        private readonly templates: Repository<PushTemplate>,
        private readonly dataSource: DataSource,
        private readonly settings: PushSettingsService,
        private readonly audiences: PushAudienceService,
        private readonly devices: PushDeviceSyncService,
        private readonly sender: PushSenderService,
        private readonly runner: PushRunnerService,
    ) {}

    // ---------------------------------------------------------------------
    // Scope helpers
    // ---------------------------------------------------------------------

    viewer(user: PushUser): PushViewerScope {
        if (user.tenantId == null) {
            throw new ForbiddenException(
                'Push notifications are sent by a business; sign in as one of its users',
            );
        }
        return {
            tenantId: user.tenantId,
            allowedBranchIds: user.allowedBranchIds ?? null,
            allowedBrandIds: user.allowedBrandIds ?? null,
        };
    }

    private scopeOf(v: PushViewerScope): PushAudienceScope {
        const scope: PushAudienceScope = {};
        if (v.allowedBrandIds) scope.brand_ids = v.allowedBrandIds;
        if (v.allowedBranchIds) scope.branch_ids = v.allowedBranchIds;
        return scope;
    }

    /** Can this viewer see / change a row saved for `brandId` with `scope`? */
    private canSee(
        v: PushViewerScope,
        row: {
            brandId: number | null;
            scope?: PushAudienceScope | null;
            createdBy?: number | null;
        },
        userId: number,
    ): boolean {
        if (v.allowedBrandIds) {
            return (
                row.brandId != null && v.allowedBrandIds.includes(row.brandId)
            );
        }
        if (v.allowedBranchIds) {
            if (row.createdBy === userId) return true;
            const ids = row.scope?.branch_ids;
            return !!ids && ids.some((id) => v.allowedBranchIds!.includes(id));
        }
        return true;
    }

    private async findVisible(
        user: PushUser,
        id: number,
    ): Promise<PushMessage> {
        const v = this.viewer(user);
        const m = await this.messages.findOne({
            where: { id, tenantId: v.tenantId },
        });
        if (!m || !this.canSee(v, m, user.id)) {
            throw new NotFoundException('Notification not found');
        }
        return m;
    }

    // ---------------------------------------------------------------------
    // Meta: everything the composer needs to draw itself
    // ---------------------------------------------------------------------

    async meta(user: PushUser) {
        const v = this.viewer(user);
        const brandFilter = v.allowedBrandIds
            ? ` AND b.id = ANY($2::int[])`
            : '';
        const branchFilter = v.allowedBranchIds
            ? ` AND b.id = ANY($2::int[])`
            : '';
        const [
            brands,
            branches,
            categories,
            items,
            recent,
            settings,
            lastSync,
        ] = await Promise.all([
            this.dataSource.query<Row[]>(
                `SELECT b.id, b.name, b.is_active FROM brands b
                     WHERE b.tenant_id = $1${brandFilter} ORDER BY b.name`,
                v.allowedBrandIds
                    ? [v.tenantId, v.allowedBrandIds]
                    : [v.tenantId],
            ),
            this.dataSource.query<Row[]>(
                `SELECT b.id, b.name, b.is_active, (b.latitude IS NOT NULL) AS has_location
                     FROM branches b
                     WHERE b.id IN (SELECT bb.branch_id FROM branch_brands bb
                                    JOIN brands br ON br.id = bb.brand_id WHERE br.tenant_id = $1)${branchFilter} ORDER BY b.name`,
                v.allowedBranchIds
                    ? [v.tenantId, v.allowedBranchIds]
                    : [v.tenantId],
            ),
            this.dataSource.query<Row[]>(
                `SELECT mc.id, mc.name, mc.brand_id, b.name AS brand_name, mc.is_active
                     FROM menu_categories mc JOIN brands b ON b.id = mc.brand_id
                     WHERE b.tenant_id = $1${v.allowedBrandIds ? ' AND b.id = ANY($2::int[])' : ''}
                     ORDER BY b.name, mc.name`,
                v.allowedBrandIds
                    ? [v.tenantId, v.allowedBrandIds]
                    : [v.tenantId],
            ),
            this.dataSource.query<Row[]>(
                `SELECT mi.id, mi.name, mi.brand_id, b.name AS brand_name, mi.is_active
                     FROM menu_items mi JOIN brands b ON b.id = mi.brand_id
                     WHERE b.tenant_id = $1${v.allowedBrandIds ? ' AND b.id = ANY($2::int[])' : ''}
                     ORDER BY b.name, mi.name`,
                v.allowedBrandIds
                    ? [v.tenantId, v.allowedBrandIds]
                    : [v.tenantId],
            ),
            this.recentMessages(user, v),
            this.settings.get(v.tenantId),
            this.devices.lastSyncedAt(),
        ]);
        return {
            rules: audienceRulesMeta(),
            options: {
                brands,
                branches,
                categories,
                items,
                messages: recent,
                order_types: ORDER_TYPES,
                sources: ORDER_SOURCES,
                platforms: ['android', 'ios'],
            },
            personal_tokens: PERSONAL_TOKENS,
            settings: this.settings.toDto(settings),
            firebase_configured: this.sender.isConfigured,
            devices_synced_at: lastSync,
            brand_locked: v.allowedBrandIds != null,
            limits: { title: TITLE_MAX, body: BODY_MAX },
        };
    }

    private async recentMessages(user: PushUser, v: PushViewerScope) {
        const rows = await this.messages.find({
            where: { tenantId: v.tenantId },
            order: { createdAt: 'DESC' },
            take: 300,
        });
        return rows
            .filter((m) => m.runsCount > 0 && this.canSee(v, m, user.id))
            .map((m) => ({
                id: m.id,
                label: m.name || m.title,
                last_run_at: m.lastRunAt,
            }));
    }

    // ---------------------------------------------------------------------
    // Live previews
    // ---------------------------------------------------------------------

    async previewAudience(
        user: PushUser,
        body: {
            audience?: AudienceSpec;
            audience_id?: number | null;
            skip_order_in_progress?: boolean;
            respect_cap?: boolean;
            message_id?: number | null;
            per_customer?: PerCustomer;
            per_customer_days?: number | null;
        },
    ) {
        const v = this.viewer(user);
        const scope = this.scopeOf(v);
        const audience = body.audience_id
            ? (await this.findAudience(user, Number(body.audience_id))).rules
            : normalizeAudience(body.audience ?? EMPTY_AUDIENCE, scope);
        const settings = await this.settings.get(v.tenantId);
        const perCustomer =
            body.message_id &&
            body.per_customer &&
            body.per_customer !== 'every'
                ? {
                      messageId: Number(body.message_id),
                      mode: body.per_customer,
                      days: body.per_customer_days ?? null,
                  }
                : null;
        const rows = await this.audiences.evaluate({
            tenantId: v.tenantId,
            audience,
            scope,
            platforms: devicePlatforms(audience),
            skipOrderInProgress:
                body.skip_order_in_progress ?? settings.skipOrderInProgress,
            respectCap: body.respect_cap ?? true,
            capPerDay: settings.capPerDay,
            capPerWeek: settings.capPerWeek,
            perCustomer,
        });
        return {
            ...this.audiences.count(rows),
            sample: rows
                .filter((r) => !r.skip)
                .slice(0, 20)
                .map(sampleRow),
            devices_synced_at: await this.devices.lastSyncedAt(),
        };
    }

    async previewSchedule(
        user: PushUser,
        body: {
            schedule_type?: ScheduleType;
            send_at?: string | null;
            repeat?: RepeatRule | null;
            skip_dates?: string[];
            runs_count?: number;
        },
    ) {
        const v = this.viewer(user);
        const s = await this.settings.get(v.tenantId);
        const now = new Date();
        let next: Date[] = [];
        if (body.schedule_type === 'repeat') {
            const rule = normalizeRepeatRule(body.repeat);
            next = upcomingOccurrences(
                rule,
                s.timezone,
                now,
                5,
                body.runs_count ?? 0,
                body.skip_dates ?? [],
            );
        } else if (body.schedule_type === 'once' && body.send_at) {
            const at = new Date(body.send_at);
            if (!Number.isNaN(at.getTime())) next = [at];
        } else {
            next = [now];
        }
        return {
            timezone: s.timezone,
            occurrences: next.map((at) => this.describeMoment(at, s)),
            ends:
                body.schedule_type === 'repeat' && next.length === 0
                    ? 'never_sends'
                    : null,
        };
    }

    /** A send time with its local reading and whether quiet hours hold it. */
    private describeMoment(
        at: Date,
        s: {
            timezone: string;
            quietHoursEnabled: boolean;
            quietStart: string;
            quietEnd: string;
        },
    ) {
        const local = localParts(at, s.timezone);
        const quiet =
            s.quietHoursEnabled &&
            isQuietTime(at, s.timezone, s.quietStart, s.quietEnd);
        return {
            at: at.toISOString(),
            local_date: local.date,
            local_time: local.time,
            weekday: local.weekday,
            held_until: quiet
                ? quietEndsAt(
                      at,
                      s.timezone,
                      s.quietStart,
                      s.quietEnd,
                  ).toISOString()
                : null,
        };
    }

    // ---------------------------------------------------------------------
    // Create / edit
    // ---------------------------------------------------------------------

    async create(user: PushUser, body: SaveMessageBody) {
        const v = this.viewer(user);
        const m = this.messages.create({
            tenantId: v.tenantId,
            createdBy: user.id,
            runsCount: 0,
            skipDates: [],
        });
        await this.apply(m, user, v, body);
        const saved = await this.messages.save(m);
        this.kickIfDue(saved);
        return this.detail(user, saved.id);
    }

    async update(user: PushUser, id: number, body: SaveMessageBody) {
        const v = this.viewer(user);
        const m = await this.findVisible(user, id);
        if (!EDITABLE.includes(m.status)) {
            throw new BadRequestException(
                'This notification has already gone out — duplicate it to send it again',
            );
        }
        await this.apply(m, user, v, body);
        const saved = await this.messages.save(m);
        this.kickIfDue(saved);
        return this.detail(user, saved.id);
    }

    private kickIfDue(m: PushMessage) {
        if (m.nextRunAt && m.nextRunAt.getTime() <= Date.now() + 60_000) {
            this.runner.kick();
        }
    }

    /** Validate the body onto the entity and work out status + next send. */
    private async apply(
        m: PushMessage,
        user: PushUser,
        v: PushViewerScope,
        body: SaveMessageBody,
    ): Promise<void> {
        const settings = await this.settings.get(v.tenantId);
        const scope = this.scopeOf(v);

        // —— message ——
        const title = String(body.title ?? m.title ?? '').trim();
        const text = String(body.body ?? m.body ?? '').trim();
        if (!title) throw new BadRequestException('Write a title');
        if (!text) throw new BadRequestException('Write the message');
        if (title.length > TITLE_MAX) {
            throw new BadRequestException(
                `Keep the title under ${TITLE_MAX} characters`,
            );
        }
        if (text.length > BODY_MAX) {
            throw new BadRequestException(
                `Keep the message under ${BODY_MAX} characters`,
            );
        }
        const unknown = [
            ...unknownPlaceholders(title),
            ...unknownPlaceholders(text),
        ];
        if (unknown.length) {
            throw new BadRequestException(
                `Unknown placeholder ${unknown.map((u) => `{${u}}`).join(', ')}`,
            );
        }
        m.title = title;
        m.body = text;
        m.name =
            body.name !== undefined
                ? String(body.name ?? '').trim() || null
                : (m.name ?? null);
        if (body.image_url !== undefined) {
            const url = String(body.image_url ?? '').trim();
            if (url && !/^https:\/\/\S+$/i.test(url)) {
                throw new BadRequestException(
                    'The image must be an https:// link',
                );
            }
            m.imageUrl = url || null;
        }
        const expiry = Number(
            body.expiry_hours ?? m.expiryHours ?? settings.defaultExpiryHours,
        );
        if (!Number.isInteger(expiry) || expiry < 1 || expiry > 672) {
            throw new BadRequestException(
                'Expiry must be 1 to 672 hours (4 weeks)',
            );
        }
        m.expiryHours = expiry;
        m.replacePrevious = Boolean(
            body.replace_previous ?? m.replacePrevious ?? false,
        );

        // —— brand ——
        let brandId =
            body.brand_id !== undefined ? body.brand_id : (m.brandId ?? null);
        if (brandId != null) brandId = Number(brandId);
        if (v.allowedBrandIds) {
            if (brandId == null && v.allowedBrandIds.length === 1) {
                brandId = v.allowedBrandIds[0];
            }
            if (brandId == null || !v.allowedBrandIds.includes(brandId)) {
                throw new BadRequestException(
                    'Pick your brand for this notification',
                );
            }
        }
        if (brandId != null) {
            const ok = await this.dataSource.query<Row[]>(
                `SELECT 1 FROM brands WHERE id = $1 AND tenant_id = $2`,
                [brandId, v.tenantId],
            );
            if (!ok.length) throw new BadRequestException('Unknown brand');
        }
        m.brandId = brandId;

        // —— audience ——
        m.scope = scope;
        if (body.audience_id !== undefined && body.audience_id != null) {
            const saved = await this.findAudience(
                user,
                Number(body.audience_id),
            );
            m.audienceId = saved.id;
            m.audience = saved.rules; // snapshot, used if the saved one is deleted
        } else {
            m.audienceId = null;
            m.audience = normalizeAudience(
                body.audience ?? m.audience ?? EMPTY_AUDIENCE,
                scope,
            );
        }
        m.skipOrderInProgress = Boolean(
            body.skip_order_in_progress ??
            m.skipOrderInProgress ??
            settings.skipOrderInProgress,
        );
        m.respectCap = Boolean(body.respect_cap ?? m.respectCap ?? true);

        // —— A/B and hold-back ——
        if (body.variant_b !== undefined) {
            if (
                body.variant_b &&
                (body.variant_b.title || body.variant_b.body)
            ) {
                const bt = String(body.variant_b.title ?? '').trim();
                const bb = String(body.variant_b.body ?? '').trim();
                if (!bt || !bb) {
                    throw new BadRequestException(
                        'Version B needs a title and a message',
                    );
                }
                if (bt.length > TITLE_MAX || bb.length > BODY_MAX) {
                    throw new BadRequestException('Version B is too long');
                }
                const unknownB = [
                    ...unknownPlaceholders(bt),
                    ...unknownPlaceholders(bb),
                ];
                if (unknownB.length) {
                    throw new BadRequestException(
                        `Unknown placeholder ${unknownB.map((u) => `{${u}}`).join(', ')}`,
                    );
                }
                const split = Number(body.ab_split ?? 50);
                if (!Number.isInteger(split) || split < 1 || split > 99) {
                    throw new BadRequestException(
                        'Send version B to 1–99% of the audience',
                    );
                }
                m.variantB = { title: bt, body: bb };
                m.abSplit = split;
            } else {
                m.variantB = null;
                m.abSplit = null;
            }
        }
        if (body.holdout_percent !== undefined) {
            const h = Number(body.holdout_percent);
            if (!Number.isInteger(h) || h < 0 || h > 50) {
                throw new BadRequestException(
                    'Hold back 0–50% of the audience',
                );
            }
            m.holdoutPercent = h;
        }
        m.holdoutPercent = m.holdoutPercent ?? 0;

        // —— when ——
        const type = body.schedule_type ?? m.scheduleType ?? 'now';
        if (!['now', 'once', 'repeat'].includes(type)) {
            throw new BadRequestException(
                'Send now, once at a time, or on repeat',
            );
        }
        m.scheduleType = type;
        m.timezone = settings.timezone;
        const now = new Date();
        if (type === 'repeat') {
            m.repeat = normalizeRepeatRule(body.repeat ?? m.repeat);
            m.sendAt = null;
            const pc = body.per_customer ?? m.perCustomer ?? 'every';
            if (!['every', 'once', 'days'].includes(pc)) {
                throw new BadRequestException('Unknown per-customer rule');
            }
            m.perCustomer = pc;
            if (pc === 'days') {
                const d = Number(body.per_customer_days ?? m.perCustomerDays);
                if (!Number.isInteger(d) || d < 1 || d > 365) {
                    throw new BadRequestException(
                        '"Once every N days" needs 1 to 365 days',
                    );
                }
                m.perCustomerDays = d;
            } else {
                m.perCustomerDays = null;
            }
        } else {
            m.repeat = null;
            m.perCustomer = 'every';
            m.perCustomerDays = null;
            if (type === 'once') {
                const at = new Date(String(body.send_at ?? m.sendAt ?? ''));
                if (Number.isNaN(at.getTime())) {
                    throw new BadRequestException(
                        'Pick the date and time to send',
                    );
                }
                m.sendAt = at;
            } else {
                m.sendAt = null;
            }
        }

        // —— status and the queue ——
        const action =
            body.action ??
            (m.status === 'draft' || !m.status ? 'draft' : 'schedule');
        if (action === 'draft') {
            m.status = 'draft';
            m.nextRunAt = null;
            return;
        }
        if (type === 'now') {
            m.status = 'scheduled';
            m.nextRunAt = now;
        } else if (type === 'once') {
            if (m.sendAt!.getTime() < now.getTime() - 60_000) {
                throw new BadRequestException(
                    'That time has passed — pick a time in the future',
                );
            }
            m.status = 'scheduled';
            m.nextRunAt = m.sendAt;
        } else {
            const next = nextOccurrence(
                m.repeat!,
                m.timezone,
                now,
                m.runsCount ?? 0,
                m.skipDates ?? [],
            );
            if (!next) {
                throw new BadRequestException(
                    'With these dates the repeat would never send',
                );
            }
            m.status = m.status === 'paused' ? 'paused' : 'active';
            m.nextRunAt = next;
        }
        m.updatedBy = user.id;
    }

    // ---------------------------------------------------------------------
    // Lifecycle actions
    // ---------------------------------------------------------------------

    async pause(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        if (m.status !== 'active') {
            throw new BadRequestException(
                'Only a running repeat can be paused',
            );
        }
        await this.messages.update(m.id, {
            status: 'paused',
            updatedBy: user.id,
        });
        return this.detail(user, id);
    }

    async resume(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        if (m.status !== 'paused' || !m.repeat) {
            throw new BadRequestException(
                'Only a paused repeat can be resumed',
            );
        }
        const next = nextOccurrence(
            m.repeat,
            m.timezone,
            new Date(),
            m.runsCount,
            m.skipDates ?? [],
        );
        await this.messages.update(m.id, {
            status: next ? 'active' : 'completed',
            nextRunAt: next,
            updatedBy: user.id,
        });
        return this.detail(user, id);
    }

    async cancel(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        if (['sent', 'completed', 'cancelled', 'failed'].includes(m.status)) {
            throw new BadRequestException(
                'This notification is already finished',
            );
        }
        await this.messages.update(m.id, {
            status: 'cancelled',
            nextRunAt: null,
            cancelledAt: new Date(),
            cancelledBy: user.id,
            updatedBy: user.id,
        });
        return this.detail(user, id);
    }

    /** Skip the next occurrence of a repeat (e.g. a holiday). */
    async skipNext(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        if (
            !m.repeat ||
            !m.nextRunAt ||
            !['active', 'paused'].includes(m.status)
        ) {
            throw new BadRequestException(
                'Only a repeat with a next send can skip it',
            );
        }
        const date = localParts(m.nextRunAt, m.timezone).date;
        const skipDates = [...new Set([...(m.skipDates ?? []), date])].sort();
        const next = nextOccurrence(
            m.repeat,
            m.timezone,
            new Date(),
            m.runsCount,
            skipDates,
        );
        await this.messages.update(m.id, {
            skipDates,
            nextRunAt: next,
            status: next ? m.status : 'completed',
            updatedBy: user.id,
        });
        return this.detail(user, id);
    }

    async duplicate(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        const copy = this.messages.create({
            ...m,
            id: undefined,
            name: `Copy of ${m.name || m.title}`.slice(0, 200),
            status: 'draft',
            nextRunAt: null,
            lastRunAt: null,
            runsCount: 0,
            skipDates: [],
            createdBy: user.id,
            updatedBy: user.id,
            cancelledAt: null,
            cancelledBy: null,
            createdAt: undefined,
            updatedAt: undefined,
        });
        const saved = await this.messages.save(copy);
        return this.detail(user, saved.id);
    }

    /** Drafts, and cancelled messages that never sent, can be deleted. */
    async remove(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        if (
            !(
                m.status === 'draft' ||
                (m.status === 'cancelled' && m.runsCount === 0)
            )
        ) {
            throw new BadRequestException(
                'Only drafts can be deleted — cancel a scheduled one instead, and sent ones stay for the record',
            );
        }
        await this.messages.delete(m.id);
        return { deleted: true };
    }

    // ---------------------------------------------------------------------
    // List and detail
    // ---------------------------------------------------------------------

    async list(
        user: PushUser,
        q: { status?: string; search?: string; page?: number; limit?: number },
    ) {
        const v = this.viewer(user);
        // Filters every tab shares; the status tab is added on top, so the
        // per-tab counts can use the shared part alone.
        const params: unknown[] = [v.tenantId];
        const bind = (x: unknown) => {
            params.push(x);
            return `$${params.length}`;
        };
        const where: string[] = ['m.tenant_id = $1'];
        if (q.search?.trim()) {
            const s = bind(`%${q.search.trim()}%`);
            where.push(
                `(m.title ILIKE ${s} OR m.body ILIKE ${s} OR m.name ILIKE ${s})`,
            );
        }
        if (v.allowedBrandIds) {
            where.push(`m.brand_id = ANY(${bind(v.allowedBrandIds)}::int[])`);
        } else if (v.allowedBranchIds) {
            where.push(`(m.created_by = ${bind(user.id)} OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE(m.scope->'branch_ids', '[]'::jsonb)) sb
                WHERE (sb)::int = ANY(${bind(v.allowedBranchIds)}::int[])))`);
        }
        const sharedWhere = where.join(' AND ');
        const sharedParams = [...params];
        const statuses = q.status ? STATUS_GROUPS[q.status] : null;
        if (statuses) where.push(`m.status = ANY(${bind(statuses)}::text[])`);
        const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
        const page = Math.max(Number(q.page) || 1, 1);
        const whereSql = where.join(' AND ');
        const [rows, total, counts] = await Promise.all([
            this.dataSource.query<Row[]>(
                `SELECT m.id, m.name, m.title, m.body, m.status, m.schedule_type, m.brand_id,
                        b.name AS brand_name, m.send_at, m.repeat, m.next_run_at, m.last_run_at,
                        m.runs_count, m.created_at, m.updated_at, u.name AS created_by_name,
                        m.audience_id, pa.name AS audience_name, m.audience, m.variant_b IS NOT NULL AS ab_test,
                        COALESCE(rs.recipients, 0)::int AS recipients,
                        COALESCE(rs.sent, 0)::int AS sent,
                        COALESCE(rs.failed, 0)::int AS failed,
                        COALESCE(att.orders, 0)::int AS orders_7d,
                        COALESCE(att.revenue, 0)::float AS revenue_7d
                 FROM push_messages m
                 LEFT JOIN brands b ON b.id = m.brand_id
                 LEFT JOIN users u ON u.id = m.created_by
                 LEFT JOIN push_audiences pa ON pa.id = m.audience_id
                 LEFT JOIN LATERAL (
                     SELECT sum(r.recipients) AS recipients, sum(r.sent) AS sent, sum(r.failed) AS failed
                     FROM push_message_runs r WHERE r.message_id = m.id) rs ON true
                 LEFT JOIN LATERAL (
                     SELECT count(DISTINCT o.id) AS orders, sum(o.total_amount) AS revenue
                     FROM push_message_recipients pr
                     JOIN orders o ON o.customer_id = pr.customer_id AND o.status <> 'cancelled'
                      AND o.placed_at >= pr.sent_at AND o.placed_at < pr.sent_at + interval '7 days'
                     WHERE pr.message_id = m.id AND pr.status = 'sent') att ON true
                 WHERE ${whereSql}
                 ORDER BY COALESCE(m.next_run_at, m.last_run_at, m.created_at) DESC, m.id DESC
                 LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
                params,
            ),
            this.dataSource.query<CountRow[]>(
                `SELECT count(*)::int AS n FROM push_messages m WHERE ${whereSql}`,
                params,
            ),
            this.dataSource.query<Array<{ status: string; n: number }>>(
                `SELECT m.status, count(*)::int AS n FROM push_messages m
                 WHERE ${sharedWhere} GROUP BY m.status`,
                sharedParams,
            ),
        ]);
        const byStatus: Record<string, number> = {};
        for (const c of counts as Array<{ status: string; n: number }>)
            byStatus[c.status] = c.n;
        const groupCounts = Object.fromEntries(
            Object.entries(STATUS_GROUPS).map(([g, list]) => [
                g,
                list.reduce((sum, st) => sum + (byStatus[st] ?? 0), 0),
            ]),
        );
        return {
            data: rows,
            total: total[0]?.n ?? 0,
            page,
            limit,
            counts: groupCounts,
        };
    }

    async detail(user: PushUser, id: number) {
        const m = await this.findVisible(user, id);
        const s = await this.settings.get(m.tenantId);
        const [runs, results, byBrand, creator, audienceName] =
            await Promise.all([
                this.dataSource.query<Row[]>(
                    `SELECT * FROM push_message_runs WHERE message_id = $1 ORDER BY scheduled_for DESC LIMIT 100`,
                    [m.id],
                ),
                this.results(m.id),
                this.dataSource.query<Row[]>(
                    `SELECT b.id, b.name, count(DISTINCT o.id)::int AS orders,
                        COALESCE(sum(o.total_amount), 0)::float AS revenue
                 FROM push_message_recipients pr
                 JOIN orders o ON o.customer_id = pr.customer_id AND o.status <> 'cancelled'
                  AND o.placed_at >= pr.sent_at AND o.placed_at < pr.sent_at + interval '7 days'
                 LEFT JOIN brands b ON b.id = o.brand_id
                 WHERE pr.message_id = $1 AND pr.status = 'sent'
                 GROUP BY b.id, b.name ORDER BY revenue DESC`,
                    [m.id],
                ),
                m.createdBy
                    ? this.dataSource.query<Array<{ name: string }>>(
                          `SELECT name FROM users WHERE id = $1`,
                          [m.createdBy],
                      )
                    : Promise.resolve([]),
                m.audienceId
                    ? this.dataSource.query<Array<{ name: string }>>(
                          `SELECT name FROM push_audiences WHERE id = $1`,
                          [m.audienceId],
                      )
                    : Promise.resolve([]),
            ]);
        const upcoming =
            m.scheduleType === 'repeat' && m.repeat && m.status === 'active'
                ? upcomingOccurrences(
                      m.repeat,
                      m.timezone,
                      new Date(),
                      5,
                      m.runsCount,
                      m.skipDates ?? [],
                  )
                : m.nextRunAt
                  ? [m.nextRunAt]
                  : [];
        return {
            message: {
                id: m.id,
                name: m.name,
                brand_id: m.brandId,
                title: m.title,
                body: m.body,
                image_url: m.imageUrl,
                expiry_hours: m.expiryHours,
                replace_previous: m.replacePrevious,
                audience: m.audience,
                audience_id: m.audienceId,
                audience_name: audienceName[0]?.name ?? null,
                skip_order_in_progress: m.skipOrderInProgress,
                respect_cap: m.respectCap,
                per_customer: m.perCustomer,
                per_customer_days: m.perCustomerDays,
                schedule_type: m.scheduleType,
                send_at: m.sendAt,
                repeat: m.repeat,
                timezone: m.timezone,
                status: m.status,
                next_run_at: m.nextRunAt,
                last_run_at: m.lastRunAt,
                runs_count: m.runsCount,
                skip_dates: m.skipDates ?? [],
                variant_b: m.variantB,
                ab_split: m.abSplit,
                holdout_percent: m.holdoutPercent,
                created_at: m.createdAt,
                updated_at: m.updatedAt,
                created_by_name: creator[0]?.name ?? null,
                cancelled_at: m.cancelledAt,
                personalized:
                    hasPlaceholders(m.title) || hasPlaceholders(m.body),
            },
            runs,
            upcoming: upcoming.map((at) => this.describeMoment(at, s)),
            results,
            by_brand: byBrand,
        };
    }

    /**
     * Orders placed by the people who got it, 24 hours / 3 days / 7 days after
     * it reached them — per send, per A/B version, and for the hold-back group
     * (who were not sent it), so the lift can be read straight off.
     */
    private async results(messageId: number) {
        const window = (label: string, span: string) => `
                    count(DISTINCT pr.customer_id) FILTER (WHERE o.placed_at < pr.sent_at + interval '${span}')::int AS buyers_${label},
                    count(DISTINCT o.id) FILTER (WHERE o.placed_at < pr.sent_at + interval '${span}')::int AS orders_${label},
                    COALESCE(sum(o.total_amount) FILTER (WHERE o.placed_at < pr.sent_at + interval '${span}'), 0)::float AS revenue_${label}`;
        const rows: Array<Record<string, unknown>> =
            await this.dataSource.query(
                `SELECT pr.run_id, pr.variant, (pr.status = 'holdout') AS holdout,
                    count(DISTINCT pr.customer_id)::int AS customers,
                    ${window('24h', '24 hours')},
                    ${window('72h', '72 hours')},
                    ${window('7d', '7 days')}
             FROM push_message_recipients pr
             LEFT JOIN orders o ON o.customer_id = pr.customer_id AND o.status <> 'cancelled'
              AND o.placed_at >= pr.sent_at AND o.placed_at < pr.sent_at + interval '7 days'
             WHERE pr.message_id = $1 AND pr.status IN ('sent', 'holdout')
             GROUP BY pr.run_id, pr.variant, (pr.status = 'holdout')
             ORDER BY pr.run_id, pr.variant NULLS FIRST`,
                [messageId],
            );
        return rows;
    }

    async recipients(
        user: PushUser,
        id: number,
        q: {
            run_id?: number;
            status?: string;
            search?: string;
            page?: number;
            limit?: number;
        },
        forCsv = false,
    ) {
        const m = await this.findVisible(user, id);
        const params: unknown[] = [m.id];
        const bind = (x: unknown) => {
            params.push(x);
            return `$${params.length}`;
        };
        const where = ['pr.message_id = $1'];
        if (q.run_id) where.push(`pr.run_id = ${bind(Number(q.run_id))}`);
        if (q.status) where.push(`pr.status = ${bind(String(q.status))}`);
        if (q.search?.trim()) {
            const s = bind(`%${q.search.trim()}%`);
            where.push(`(c.name ILIKE ${s} OR c.phone ILIKE ${s})`);
        }
        const limit = forCsv
            ? 50_000
            : Math.min(Math.max(Number(q.limit) || 50, 1), 200);
        const page = forCsv ? 1 : Math.max(Number(q.page) || 1, 1);
        const whereSql = where.join(' AND ');
        const [rows, total] = await Promise.all([
            this.dataSource.query<Row[]>(
                `SELECT pr.id, pr.run_id, pr.customer_id, c.name AS customer_name, c.phone,
                        pr.variant, pr.status, pr.phones, pr.sent, pr.failed, pr.error, pr.sent_at,
                        fo.id AS first_order_id, fo.placed_at AS first_order_at,
                        fo.total_amount AS first_order_total, fb.name AS first_order_brand
                 FROM push_message_recipients pr
                 JOIN customers c ON c.id = pr.customer_id
                 LEFT JOIN LATERAL (
                     SELECT o.id, o.placed_at, o.total_amount, o.brand_id FROM orders o
                     WHERE o.customer_id = pr.customer_id AND o.status <> 'cancelled'
                       AND pr.sent_at IS NOT NULL
                       AND o.placed_at >= pr.sent_at AND o.placed_at < pr.sent_at + interval '7 days'
                     ORDER BY o.placed_at LIMIT 1) fo ON true
                 LEFT JOIN brands fb ON fb.id = fo.brand_id
                 WHERE ${whereSql}
                 ORDER BY pr.id
                 LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
                params,
            ),
            this.dataSource.query<CountRow[]>(
                `SELECT count(*)::int AS n FROM push_message_recipients pr
                 JOIN customers c ON c.id = pr.customer_id WHERE ${whereSql}`,
                params,
            ),
        ]);
        return { data: rows, total: total[0]?.n ?? 0, page, limit };
    }

    async recipientsCsv(
        user: PushUser,
        id: number,
        q: { run_id?: number; status?: string },
    ) {
        const { data } = await this.recipients(user, id, q, true);
        const head = [
            'Customer',
            'Phone',
            'Status',
            'Version',
            'Phones',
            'Delivered',
            'Failed',
            'Error',
            'Sent at',
            'Ordered within 7 days',
            'First order at',
            'First order total',
            'Brand',
        ];
        const cell = (x: unknown) => {
            const s =
                x == null
                    ? ''
                    : x instanceof Date
                      ? x.toISOString()
                      : typeof x === 'object'
                        ? JSON.stringify(x)
                        : String(x as string | number | boolean);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = (data as Array<Record<string, unknown>>).map((r) =>
            [
                r.customer_name,
                r.phone,
                r.status,
                r.variant,
                r.phones,
                r.sent,
                r.failed,
                r.error,
                r.sent_at,
                r.first_order_id ? 'yes' : 'no',
                r.first_order_at,
                r.first_order_total,
                r.first_order_brand,
            ]
                .map(cell)
                .join(','),
        );
        return [head.join(','), ...lines].join('\n');
    }

    // ---------------------------------------------------------------------
    // Test send
    // ---------------------------------------------------------------------

    async testSend(
        user: PushUser,
        body: {
            title?: string;
            body?: string;
            image_url?: string | null;
            expiry_hours?: number;
            replace_previous?: boolean;
            phones?: string[];
        },
    ) {
        const v = this.viewer(user);
        const settings = await this.settings.get(v.tenantId);
        const title = String(body.title ?? '').trim();
        const text = String(body.body ?? '').trim();
        if (!title || !text)
            throw new BadRequestException('Write a title and a message first');
        const raw = body.phones?.length ? body.phones : settings.testPhones;
        const phones = [
            ...new Set(
                (raw ?? []).map((p) => phoneKey(String(p))).filter(Boolean),
            ),
        ] as string[];
        if (phones.length === 0) {
            throw new BadRequestException(
                'Add your test phones in Settings first',
            );
        }
        if (phones.length > 20)
            throw new BadRequestException('At most 20 test phones');
        await this.devices.ensureFresh().catch(() => undefined);
        const customers: Array<{
            id: number;
            name: string | null;
            phone: string;
            key: string;
        }> = await this.dataSource.query(
            `SELECT c.id, c.name, c.phone, ${PHONE_KEY_SQL} AS key FROM customers c
                 WHERE c.tenant_id = $1 AND ${PHONE_KEY_SQL} = ANY($2::text[])`,
            [v.tenantId, phones],
        );
        const values = await this.runner.personalValues(
            customers.map((c) => c.id),
        );
        const out: Array<Record<string, unknown>> = [];
        for (const key of phones) {
            const c = customers.find((x) => x.key === key);
            if (!c) {
                out.push({
                    phone: `0${key}`,
                    customer: null,
                    phones: 0,
                    sent: 0,
                    failed: 0,
                    error: 'No customer with this phone',
                });
                continue;
            }
            const devices = await this.audiences.devicesFor([c.id], null);
            if (devices.length === 0) {
                out.push({
                    phone: c.phone,
                    customer: { id: c.id, name: c.name },
                    phones: 0,
                    sent: 0,
                    failed: 0,
                    error: 'This number has not logged into the app',
                });
                continue;
            }
            const vals = values.get(c.id) ?? {};
            const results = await this.sender.sendBatch(
                devices.map((d) => ({
                    token: d.token,
                    title: personalize(title, vals),
                    body: personalize(text, vals),
                })),
                {
                    messageId: null,
                    imageUrl: body.image_url ? String(body.image_url) : null,
                    expiryHours:
                        Number(body.expiry_hours) ||
                        settings.defaultExpiryHours,
                    replacePrevious: Boolean(body.replace_previous),
                },
            );
            const dead = devices.filter((_, i) => results[i].dead);
            if (dead.length)
                await this.devices.removeDevices(
                    dead,
                    'test send found it gone',
                );
            out.push({
                phone: c.phone,
                customer: { id: c.id, name: c.name },
                phones: devices.length,
                sent: results.filter((r) => r.ok).length,
                failed: results.filter((r) => !r.ok).length,
                error: results.find((r) => !r.ok)?.error ?? null,
            });
        }
        return { results: out };
    }

    // ---------------------------------------------------------------------
    // Overview
    // ---------------------------------------------------------------------

    async overview(user: PushUser) {
        const v = this.viewer(user);
        const scope = this.scopeOf(v);
        const reach = this.audiences.count(
            await this.audiences.evaluate({
                tenantId: v.tenantId,
                audience: EMPTY_AUDIENCE,
                scope,
                platforms: null,
                skipOrderInProgress: false,
                respectCap: false,
                capPerDay: null,
                capPerWeek: null,
            }),
        );
        const msgFilter = v.allowedBrandIds
            ? ` AND m.brand_id = ANY($2::int[])`
            : '';
        const params = v.allowedBrandIds
            ? [v.tenantId, v.allowedBrandIds]
            : [v.tenantId];
        const [platforms, last30, upcoming, top] = await Promise.all([
            this.dataSource.query<
                Array<{ platform: string | null; n: number }>
            >(
                `SELECT d.platform, count(*)::int AS n FROM push_devices d
                 JOIN customers c ON c.id = d.owner_id AND c.tenant_id = $1
                 WHERE NOT EXISTS (SELECT 1 FROM rider_profiles rp WHERE rp.user_id = c.id)
                   -- a phone handed on counts once, for its newest owner
                   AND NOT EXISTS (
                       SELECT 1 FROM push_devices nd
                       WHERE nd.token = d.token AND nd.doc_path <> d.doc_path
                         AND COALESCE(nd.last_updated, 'epoch') > COALESCE(d.last_updated, 'epoch'))
                 GROUP BY d.platform`,
                [v.tenantId],
            ),
            this.dataSource.query<
                Array<{ sends: number; recipients: number; delivered: number }>
            >(
                `SELECT count(DISTINCT r.id)::int AS sends, COALESCE(sum(r.recipients), 0)::int AS recipients,
                        COALESCE(sum(r.sent), 0)::int AS delivered
                 FROM push_message_runs r JOIN push_messages m ON m.id = r.message_id
                 WHERE r.tenant_id = $1 AND r.started_at >= now() - interval '30 days'${msgFilter}`,
                params,
            ),
            this.dataSource.query<Row[]>(
                `SELECT m.id, m.name, m.title, m.next_run_at, m.schedule_type
                 FROM push_messages m
                 WHERE m.tenant_id = $1 AND m.next_run_at IS NOT NULL
                   AND m.status IN ('scheduled', 'active')${msgFilter}
                 ORDER BY m.next_run_at LIMIT 5`,
                params,
            ),
            this.dataSource.query<Row[]>(
                `SELECT m.id, m.name, m.title, count(DISTINCT o.id)::int AS orders,
                        COALESCE(sum(o.total_amount), 0)::float AS revenue,
                        count(DISTINCT pr.customer_id)::int AS recipients
                 FROM push_messages m
                 JOIN push_message_recipients pr ON pr.message_id = m.id AND pr.status = 'sent'
                 LEFT JOIN orders o ON o.customer_id = pr.customer_id AND o.status <> 'cancelled'
                  AND o.placed_at >= pr.sent_at AND o.placed_at < pr.sent_at + interval '7 days'
                 WHERE m.tenant_id = $1 AND pr.sent_at >= now() - interval '90 days'${msgFilter}
                 GROUP BY m.id, m.name, m.title
                 HAVING count(DISTINCT o.id) > 0
                 ORDER BY revenue DESC, orders DESC LIMIT 5`,
                params,
            ),
        ]);
        const att = await this.dataSource.query<
            Array<{ orders: number; revenue: number }>
        >(
            `SELECT count(DISTINCT o.id)::int AS orders, COALESCE(sum(o.total_amount), 0)::float AS revenue
             FROM (SELECT DISTINCT pr.customer_id, pr.sent_at FROM push_message_recipients pr
                   JOIN push_messages m ON m.id = pr.message_id
                   WHERE pr.tenant_id = $1 AND pr.status = 'sent'
                     AND pr.sent_at >= now() - interval '30 days'${msgFilter}) s
             JOIN orders o ON o.customer_id = s.customer_id AND o.status <> 'cancelled'
              AND o.placed_at >= s.sent_at AND o.placed_at < s.sent_at + interval '7 days'`,
            params,
        );
        return {
            reach: {
                customers_with_app: reach.with_app,
                reachable: reach.eligible,
                phones: reach.phones,
                opted_out: reach.skipped.opt_out,
                platforms,
            },
            last_30_days: {
                ...last30[0],
                orders: att[0]?.orders ?? 0,
                revenue: att[0]?.revenue ?? 0,
            },
            upcoming,
            top,
            devices_synced_at: await this.devices.lastSyncedAt(),
            firebase_configured: this.sender.isConfigured,
        };
    }

    async syncDevices(user: PushUser) {
        this.viewer(user);
        return this.devices.syncAll();
    }

    // ---------------------------------------------------------------------
    // One customer: history and "stop promos"
    // ---------------------------------------------------------------------

    private async assertCustomerVisible(
        v: PushViewerScope,
        customerId: number,
    ) {
        const scope = this.scopeOf(v);
        const params: unknown[] = [customerId, v.tenantId];
        let extra = '';
        if (scope.brand_ids) {
            params.push(scope.brand_ids);
            extra = ` AND (EXISTS (SELECT 1 FROM orders so WHERE so.customer_id = c.id AND so.brand_id = ANY($3::int[]))
                        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.brand_ids, '[]'::jsonb)) be
                                   WHERE (be)::int = ANY($3::int[])))`;
        }
        const rows = await this.dataSource.query<Row[]>(
            `SELECT c.id FROM customers c WHERE c.id = $1 AND c.tenant_id = $2${extra}`,
            params,
        );
        if (!rows.length) throw new NotFoundException('Customer not found');
    }

    async customerHistory(user: PushUser, customerId: number) {
        const v = this.viewer(user);
        await this.assertCustomerVisible(v, customerId);
        const [state, rows, phones] = await Promise.all([
            this.dataSource.query<
                Array<{
                    push_opt_out: boolean;
                    push_opt_out_at: Date | null;
                    push_opt_out_by_name: string | null;
                }>
            >(
                `SELECT c.push_opt_out, c.push_opt_out_at, u.name AS push_opt_out_by_name
                 FROM customers c LEFT JOIN users u ON u.id = c.push_opt_out_by WHERE c.id = $1`,
                [customerId],
            ),
            this.dataSource.query<Row[]>(
                `SELECT pr.id, pr.message_id, m.name, m.title, pr.variant, pr.status, pr.sent,
                        pr.failed, pr.sent_at, b.name AS brand_name
                 FROM push_message_recipients pr
                 JOIN push_messages m ON m.id = pr.message_id
                 LEFT JOIN brands b ON b.id = m.brand_id
                 WHERE pr.customer_id = $1 AND pr.tenant_id = $2
                 ORDER BY pr.sent_at DESC NULLS LAST, pr.id DESC LIMIT 100`,
                [customerId, v.tenantId],
            ),
            this.audiences.devicesFor([customerId], null),
        ]);
        return {
            opt_out: Boolean(state[0]?.push_opt_out),
            opt_out_at: state[0]?.push_opt_out_at ?? null,
            opt_out_by: state[0]?.push_opt_out_by_name ?? null,
            phones: phones.map((d) => ({ platform: d.platform })),
            history: rows,
        };
    }

    async setOptOut(user: PushUser, customerId: number, optOut: boolean) {
        const v = this.viewer(user);
        await this.assertCustomerVisible(v, customerId);
        await this.dataSource.query(
            `UPDATE customers SET push_opt_out = $2,
                    push_opt_out_at = CASE WHEN $2 THEN now() END,
                    push_opt_out_by = CASE WHEN $2 THEN $3::int END
             WHERE id = $1`,
            [customerId, optOut, user.id],
        );
        return this.customerHistory(user, customerId);
    }

    // ---------------------------------------------------------------------
    // Saved audiences
    // ---------------------------------------------------------------------

    private async findAudience(
        user: PushUser,
        id: number,
    ): Promise<PushAudience> {
        const v = this.viewer(user);
        const a = await this.savedAudiences.findOne({
            where: { id, tenantId: v.tenantId },
        });
        if (
            !a ||
            !this.canSee(
                v,
                { brandId: a.brandId, createdBy: a.createdBy },
                user.id,
            )
        ) {
            throw new NotFoundException('Saved audience not found');
        }
        return a;
    }

    async listAudiences(user: PushUser) {
        const v = this.viewer(user);
        const rows = await this.dataSource.query<
            Array<Row & { brand_id: number | null; created_by: number | null }>
        >(
            `SELECT a.*, u.name AS created_by_name,
                    (SELECT count(*)::int FROM push_messages m WHERE m.audience_id = a.id
                       AND m.status IN ('scheduled', 'active', 'paused')) AS used_by
             FROM push_audiences a LEFT JOIN users u ON u.id = a.created_by
             WHERE a.tenant_id = $1 ORDER BY a.name`,
            [v.tenantId],
        );
        return rows.filter(
            (a: { brand_id: number | null; created_by: number | null }) =>
                this.canSee(
                    v,
                    { brandId: a.brand_id, createdBy: a.created_by },
                    user.id,
                ),
        );
    }

    async saveAudience(
        user: PushUser,
        body: {
            name?: string;
            description?: string | null;
            rules?: AudienceSpec;
            brand_id?: number | null;
        },
        id?: number,
    ) {
        const v = this.viewer(user);
        const name = String(body.name ?? '').trim();
        if (!name) throw new BadRequestException('Name the audience');
        const rules = normalizeAudience(
            body.rules ?? EMPTY_AUDIENCE,
            this.scopeOf(v),
        );
        const a = id
            ? await this.findAudience(user, id)
            : this.savedAudiences.create({
                  tenantId: v.tenantId,
                  createdBy: user.id,
              });
        a.name = name.slice(0, 200);
        a.description = body.description
            ? String(body.description).trim() || null
            : null;
        a.rules = rules;
        a.brandId = v.allowedBrandIds
            ? v.allowedBrandIds[0]
            : (body.brand_id ?? a.brandId ?? null);
        a.updatedBy = user.id;
        const saved = await this.savedAudiences.save(a);
        // Messages that point at it keep a fresh snapshot for if it is deleted.
        await this.dataSource.query(
            `UPDATE push_messages SET audience = $2 WHERE audience_id = $1`,
            [saved.id, JSON.stringify(rules)],
        );
        return saved;
    }

    async deleteAudience(user: PushUser, id: number) {
        const a = await this.findAudience(user, id);
        await this.savedAudiences.delete(a.id);
        return { deleted: true };
    }

    // ---------------------------------------------------------------------
    // Templates
    // ---------------------------------------------------------------------

    async listTemplates(user: PushUser) {
        const v = this.viewer(user);
        const rows = await this.templates.find({
            where: { tenantId: v.tenantId },
            order: { name: 'ASC' },
        });
        return rows.filter((t) =>
            this.canSee(
                v,
                { brandId: t.brandId, createdBy: t.createdBy },
                user.id,
            ),
        );
    }

    async saveTemplate(
        user: PushUser,
        body: {
            name?: string;
            title?: string;
            body?: string;
            image_url?: string | null;
            brand_id?: number | null;
        },
        id?: number,
    ) {
        const v = this.viewer(user);
        const name = String(body.name ?? '').trim();
        const title = String(body.title ?? '').trim();
        const text = String(body.body ?? '').trim();
        if (!name) throw new BadRequestException('Name the template');
        if (!title || !text)
            throw new BadRequestException(
                'A template needs a title and a message',
            );
        if (title.length > TITLE_MAX || text.length > BODY_MAX) {
            throw new BadRequestException('The template is too long');
        }
        const url = String(body.image_url ?? '').trim();
        if (url && !/^https:\/\/\S+$/i.test(url)) {
            throw new BadRequestException('The image must be an https:// link');
        }
        let t: PushTemplate;
        if (id) {
            const found = await this.templates.findOne({
                where: { id, tenantId: v.tenantId },
            });
            if (
                !found ||
                !this.canSee(
                    v,
                    { brandId: found.brandId, createdBy: found.createdBy },
                    user.id,
                )
            ) {
                throw new NotFoundException('Template not found');
            }
            t = found;
        } else {
            t = this.templates.create({
                tenantId: v.tenantId,
                createdBy: user.id,
            });
        }
        t.name = name.slice(0, 200);
        t.title = title;
        t.body = text;
        t.imageUrl = url || null;
        t.brandId = v.allowedBrandIds
            ? v.allowedBrandIds[0]
            : (body.brand_id ?? t.brandId ?? null);
        t.updatedBy = user.id;
        return this.templates.save(t);
    }

    async deleteTemplate(user: PushUser, id: number) {
        const v = this.viewer(user);
        const t = await this.templates.findOne({
            where: { id, tenantId: v.tenantId },
        });
        if (
            !t ||
            !this.canSee(
                v,
                { brandId: t.brandId, createdBy: t.createdBy },
                user.id,
            )
        ) {
            throw new NotFoundException('Template not found');
        }
        await this.templates.delete(t.id);
        return { deleted: true };
    }
}

function sampleRow(r: EvaluatedCustomer) {
    return { id: r.id, name: r.name, phone: r.phone, phones: r.phones };
}
