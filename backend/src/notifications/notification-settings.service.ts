import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationSetting } from '../entities/notification-setting.entity';
import {
    getNotificationEvent,
    NOTIFICATION_EVENT_LIST,
} from './notification-events';
import { UpsertNotificationSettingDto } from './notification-settings.dto';

@Injectable()
export class NotificationSettingsService {
    constructor(
        @InjectRepository(NotificationSetting)
        private readonly settingRepo: Repository<NotificationSetting>,
    ) {}

    /** Catalog of configurable events + the tenant's current overrides. */
    async list(tenantId: number) {
        const settings = await this.settingRepo.find({ where: { tenantId } });
        return {
            events: NOTIFICATION_EVENT_LIST.map((e) => ({
                type: e.type,
                label: e.label,
                description: e.description,
                category: e.category,
                surface: e.surface,
                severity: e.severity,
                defaultRoleSlugs: e.defaultRoleSlugs,
                sound: e.sound,
                repeatSound: e.repeatSound,
                actions: e.actions,
            })),
            settings,
        };
    }

    async upsert(tenantId: number, dto: UpsertNotificationSettingDto) {
        if (!getNotificationEvent(dto.event_type)) {
            throw new BadRequestException(
                `Unknown notification event: ${dto.event_type}`,
            );
        }
        const branchId = dto.branch_id ?? null;
        const brandId = dto.brand_id ?? null;
        if (brandId != null && branchId == null) {
            throw new BadRequestException(
                'A brand-scoped override must also specify a branch',
            );
        }

        const existing = await this.settingRepo
            .createQueryBuilder('s')
            .where('s.tenantId = :tenantId', { tenantId })
            .andWhere('s.eventType = :eventType', { eventType: dto.event_type })
            .andWhere('COALESCE(s.branchId, 0) = :branchKey', {
                branchKey: branchId ?? 0,
            })
            .andWhere('COALESCE(s.brandId, 0) = :brandKey', {
                brandKey: brandId ?? 0,
            })
            .getOne();

        const roleIds = [...new Set((dto.target_role_ids ?? []).map(Number))];
        const row =
            existing ??
            this.settingRepo.create({
                tenantId,
                eventType: dto.event_type,
                branchId,
                brandId,
            });
        row.targetRoleIds = roleIds;
        if (dto.sound_enabled !== undefined)
            row.soundEnabled = dto.sound_enabled;
        if (dto.is_enabled !== undefined) row.isEnabled = dto.is_enabled;
        return this.settingRepo.save(row);
    }

    /** Remove an override, reverting that scope to the catalog default. */
    async remove(tenantId: number, id: number) {
        const row = await this.settingRepo.findOne({ where: { id, tenantId } });
        if (!row) return { ok: true };
        await this.settingRepo.remove(row);
        return { ok: true };
    }
}
