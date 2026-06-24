import {
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { Server } from 'socket.io';
import { Notification } from '../entities/notification.entity';
import { NotificationRecipient } from '../entities/notification-recipient.entity';
import { NotificationSetting } from '../entities/notification-setting.entity';
import { Role } from '../entities/role.entity';
import {
    getNotificationEvent,
    NotificationEventDef,
} from './notification-events';

export interface DispatchInput {
    tenantId: number;
    branchId: number | null;
    brandId?: number | null;
    type: string;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
    /** When set, collapses recurring conditions to a single open notification. */
    dedupeKey?: string | null;
}

export interface SystemAlertItem {
    dedupeKey: string;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
    brandId?: number | null;
}

interface EffectiveSetting {
    isEnabled: boolean;
    soundEnabled: boolean;
    roleIds: number[];
}

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);
    private server: Server | null = null;

    constructor(
        @InjectRepository(Notification)
        private readonly notifRepo: Repository<Notification>,
        @InjectRepository(NotificationRecipient)
        private readonly recipientRepo: Repository<NotificationRecipient>,
        @InjectRepository(NotificationSetting)
        private readonly settingRepo: Repository<NotificationSetting>,
        @InjectRepository(Role)
        private readonly roleRepo: Repository<Role>,
        private readonly dataSource: DataSource,
    ) {}

    /** Called by the gateway once the socket server is initialized. */
    bindServer(server: Server) {
        this.server = server;
    }

    private emitToUsers(userIds: number[], event: string, payload: unknown) {
        if (!this.server || userIds.length === 0) return;
        for (const uid of new Set(userIds)) {
            this.server.to(`user:${uid}`).emit(event, payload);
        }
    }

    // ---------------- Dispatch ----------------

    /**
     * Persist + deliver a notification for an event. Resolves the effective
     * role-targeting config (most specific scope wins, catalog defaults otherwise),
     * snapshots recipients, and emits to their sockets. Returns null when the event
     * is unknown, muted, or has no recipients.
     */
    async dispatch(input: DispatchInput): Promise<Notification | null> {
        const def = getNotificationEvent(input.type);
        if (!def) {
            this.logger.warn(`Unknown notification type: ${input.type}`);
            return null;
        }
        const branchId = input.branchId ?? null;
        const brandId = input.brandId ?? null;

        const setting = await this.resolveEffectiveSetting(
            input.tenantId,
            input.type,
            branchId,
            brandId,
            def,
        );
        if (!setting.isEnabled || setting.roleIds.length === 0) return null;

        // Reuse an existing open notification with the same dedupe key.
        if (input.dedupeKey) {
            const existing = await this.notifRepo.findOne({
                where: { dedupeKey: input.dedupeKey, status: 'open' },
            });
            if (existing) return existing;
        }

        const userIds = await this.resolveRecipients(
            branchId,
            setting.roleIds,
            brandId,
        );
        if (userIds.length === 0) return null;

        let notif: Notification;
        try {
            notif = await this.notifRepo.save(
                this.notifRepo.create({
                    tenantId: input.tenantId,
                    branchId,
                    brandId,
                    type: def.type,
                    category: def.category,
                    surface: def.surface,
                    severity: def.severity,
                    resolutionMode: def.resolutionMode,
                    title: input.title,
                    body: input.body ?? null,
                    data: input.data ?? null,
                    actions: def.actions,
                    soundEnabled: setting.soundEnabled,
                    dedupeKey: input.dedupeKey ?? null,
                    status: 'open',
                }),
            );
        } catch (e) {
            // Lost a dedupe race against another dispatch — reuse the winner.
            if (
                e instanceof QueryFailedError &&
                (e as { driverError?: { code?: string } }).driverError?.code ===
                    '23505' &&
                input.dedupeKey
            ) {
                return this.notifRepo.findOne({
                    where: { dedupeKey: input.dedupeKey, status: 'open' },
                });
            }
            throw e;
        }

        await this.recipientRepo.save(
            userIds.map((uid) =>
                this.recipientRepo.create({
                    notificationId: notif.id,
                    userId: uid,
                }),
            ),
        );

        this.emitToUsers(
            userIds,
            'notification:new',
            this.toClientDto(notif, null),
        );
        return notif;
    }

    /**
     * Reconcile the open notifications of a system-managed type (inventory alerts)
     * against the current condition set: open new ones, auto-resolve cleared ones.
     */
    async syncSystemAlerts(
        tenantId: number,
        branchId: number,
        type: string,
        items: SystemAlertItem[],
    ): Promise<{ opened: number; resolved: number }> {
        const open = await this.notifRepo.find({
            where: { tenantId, branchId, type, status: 'open' },
        });
        const openByKey = new Map(
            open.filter((n) => n.dedupeKey).map((n) => [n.dedupeKey, n]),
        );
        const currentKeys = new Set(items.map((i) => i.dedupeKey));
        let opened = 0;
        let resolved = 0;

        for (const item of items) {
            if (!openByKey.has(item.dedupeKey)) {
                const created = await this.dispatch({
                    tenantId,
                    branchId,
                    brandId: item.brandId ?? null,
                    type,
                    title: item.title,
                    body: item.body ?? null,
                    data: item.data ?? null,
                    dedupeKey: item.dedupeKey,
                });
                if (created) opened += 1;
            }
        }
        for (const n of open) {
            if (n.dedupeKey && !currentKeys.has(n.dedupeKey)) {
                await this.resolveSystem(n);
                resolved += 1;
            }
        }
        return { opened, resolved };
    }

    // ---------------- Recipient / setting resolution ----------------

    private async resolveRecipients(
        branchId: number | null,
        roleIds: number[],
        brandId: number | null,
    ): Promise<number[]> {
        if (branchId == null || roleIds.length === 0) return [];
        const rows = (await this.dataSource.query(
            `SELECT DISTINCT bu.user_id
             FROM branch_users bu
             WHERE bu.branch_id = $1
               AND bu.role_id = ANY($2::int[])
               AND ($3::int IS NULL OR bu.brand_id IS NULL OR bu.brand_id = $3)`,
            [branchId, roleIds, brandId],
        )) as unknown as Array<{ user_id: number }>;
        return rows.map((r) => Number(r.user_id));
    }

    private async resolveEffectiveSetting(
        tenantId: number,
        eventType: string,
        branchId: number | null,
        brandId: number | null,
        def: NotificationEventDef,
    ): Promise<EffectiveSetting> {
        const rows = await this.settingRepo.find({
            where: { tenantId, eventType },
        });
        const match =
            (branchId != null && brandId != null
                ? rows.find(
                      (r) => r.branchId === branchId && r.brandId === brandId,
                  )
                : undefined) ??
            (branchId != null
                ? rows.find((r) => r.branchId === branchId && r.brandId == null)
                : undefined) ??
            rows.find((r) => r.branchId == null && r.brandId == null);

        if (match) {
            return {
                isEnabled: match.isEnabled,
                soundEnabled: match.soundEnabled,
                roleIds: match.targetRoleIds ?? [],
            };
        }
        // No configured row → fall back to the catalog defaults so alerts work
        // out of the box before any admin configuration.
        const roleIds = await this.resolveRoleIdsBySlug(
            tenantId,
            def.defaultRoleSlugs,
        );
        return { isEnabled: true, soundEnabled: def.sound, roleIds };
    }

    private async resolveRoleIdsBySlug(
        tenantId: number,
        slugs: string[],
    ): Promise<number[]> {
        if (slugs.length === 0) return [];
        const roles = await this.roleRepo.find({
            where: { slug: In(slugs) },
        });
        return roles
            .filter((r) => r.tenantId == null || r.tenantId === tenantId)
            .map((r) => r.id);
    }

    // ---------------- Reads for clients ----------------

    /** Catch-up: all open notifications delivered to this user (split client-side). */
    async listOpenForUser(userId: number) {
        const rows = await this.recipientRepo
            .createQueryBuilder('r')
            .innerJoinAndSelect('r.notification', 'n')
            .where('r.userId = :userId', { userId })
            .andWhere("n.status = 'open'")
            .orderBy('n.createdAt', 'DESC')
            .getMany();
        return rows.map((r) => this.toClientDto(r.notification, r.readAt));
    }

    async unreadCount(userId: number): Promise<number> {
        return this.recipientRepo
            .createQueryBuilder('r')
            .innerJoin('r.notification', 'n')
            .where('r.userId = :userId', { userId })
            .andWhere('r.readAt IS NULL')
            .andWhere("n.status = 'open'")
            .getCount();
    }

    // ---------------- Actions ----------------

    /**
     * Record a terminal action (Accept/Reject) on a notification and resolve it.
     * For `shared`/`system` notifications the resolution clears it for every
     * recipient. Idempotent if already resolved.
     */
    async act(notificationId: number, userId: number, actionKey?: string) {
        const notif = await this.notifRepo.findOne({
            where: { id: notificationId },
        });
        if (!notif) throw new NotFoundException('Notification not found');
        const recipient = await this.recipientRepo.findOne({
            where: { notificationId, userId },
        });
        if (!recipient) {
            throw new ForbiddenException(
                'You are not a recipient of this notification',
            );
        }
        if (notif.status === 'resolved') {
            return this.toClientDto(notif, recipient.readAt);
        }
        notif.status = 'resolved';
        notif.resolvedAt = new Date();
        notif.resolvedByUserId = userId;
        notif.resolvedAction = actionKey ?? null;
        await this.notifRepo.save(notif);

        const recipients = await this.recipientRepo.find({
            where: { notificationId },
        });
        this.emitToUsers(
            recipients.map((r) => r.userId),
            'notification:resolved',
            {
                id: notificationId,
                resolvedByUserId: userId,
                resolvedAction: actionKey ?? null,
            },
        );
        return this.toClientDto(notif, recipient.readAt);
    }

    async markRead(notificationId: number, userId: number) {
        const recipient = await this.recipientRepo.findOne({
            where: { notificationId, userId },
        });
        if (!recipient) {
            throw new ForbiddenException(
                'You are not a recipient of this notification',
            );
        }
        if (recipient.readAt == null) {
            recipient.readAt = new Date();
            await this.recipientRepo.save(recipient);
        }
        return { ok: true };
    }

    async markAllRead(userId: number) {
        await this.recipientRepo
            .createQueryBuilder()
            .update(NotificationRecipient)
            .set({ readAt: () => 'now()' })
            .where('user_id = :userId', { userId })
            .andWhere('read_at IS NULL')
            .execute();
        return { ok: true };
    }

    // ---------------- Internals ----------------

    private async resolveSystem(notif: Notification) {
        notif.status = 'resolved';
        notif.resolvedAt = new Date();
        notif.resolvedAction = 'auto';
        await this.notifRepo.save(notif);
        const recipients = await this.recipientRepo.find({
            where: { notificationId: notif.id },
        });
        this.emitToUsers(
            recipients.map((r) => r.userId),
            'notification:resolved',
            { id: notif.id, resolvedAction: 'auto' },
        );
    }

    private toClientDto(notif: Notification, readAt: Date | null) {
        const def = getNotificationEvent(notif.type);
        return {
            id: notif.id,
            type: notif.type,
            category: notif.category,
            surface: notif.surface,
            severity: notif.severity,
            resolutionMode: notif.resolutionMode,
            title: notif.title,
            body: notif.body,
            data: notif.data,
            actions: notif.actions ?? def?.actions ?? [],
            soundEnabled: notif.soundEnabled,
            repeatSound: def?.repeatSound ?? false,
            branchId: notif.branchId,
            brandId: notif.brandId,
            status: notif.status,
            createdAt: notif.createdAt,
            readAt: readAt ?? null,
        };
    }
}
