import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PushSettings } from '../entities/push-settings.entity';
import { isValidTimeZone, TIME_RE } from './push-time';
import { phoneKey } from './push-audience-rules';

export interface PushSettingsDto {
    timezone: string;
    quiet_hours_enabled: boolean;
    quiet_start: string;
    quiet_end: string;
    cap_per_day: number | null;
    cap_per_week: number | null;
    default_expiry_hours: number;
    skip_order_in_progress: boolean;
    test_phones: string[];
    updated_at: Date | null;
}

const FALLBACK_TZ = 'Asia/Karachi';

@Injectable()
export class PushSettingsService {
    constructor(
        @InjectRepository(PushSettings)
        private readonly repo: Repository<PushSettings>,
        private readonly dataSource: DataSource,
    ) {}

    /**
     * The tenant's settings, created with the agreed defaults on first use:
     * quiet 01:00–10:00, at most 1 promo a day and 3 a week per customer,
     * expiry 12 hours, customers with an order in progress left out. The zone
     * is the tenant's branches' own (tenants default to 'UTC', which would put
     * "7 PM" at midnight in Pakistan), falling back to Asia/Karachi.
     */
    async get(tenantId: number): Promise<PushSettings> {
        const found = await this.repo.findOne({ where: { tenantId } });
        if (found) return found;
        const timezone = await this.guessTimezone(tenantId);
        await this.repo
            .createQueryBuilder()
            .insert()
            .values({
                tenantId,
                timezone,
                quietHoursEnabled: true,
                quietStart: '01:00',
                quietEnd: '10:00',
                capPerDay: 1,
                capPerWeek: 3,
                defaultExpiryHours: 12,
                skipOrderInProgress: true,
                testPhones: [],
            })
            .orIgnore()
            .execute();
        return this.repo.findOneOrFail({ where: { tenantId } });
    }

    private async guessTimezone(tenantId: number): Promise<string> {
        const rows: Array<{ tz: string }> = await this.dataSource.query(
            `SELECT tz FROM (
                SELECT b.timezone AS tz, count(*) AS n FROM branches b
                WHERE b.timezone IS NOT NULL AND b.timezone <> 'UTC'
                  -- branches reach a tenant through their brands
                  AND b.id IN (SELECT bb.branch_id FROM branch_brands bb
                               JOIN brands br ON br.id = bb.brand_id WHERE br.tenant_id = $1)
                GROUP BY b.timezone
                UNION ALL
                SELECT t.default_timezone, 0 FROM tenants t
                WHERE t.id = $1 AND t.default_timezone IS NOT NULL AND t.default_timezone <> 'UTC'
             ) z ORDER BY n DESC LIMIT 1`,
            [tenantId],
        );
        const tz = rows[0]?.tz;
        return tz && isValidTimeZone(tz) ? tz : FALLBACK_TZ;
    }

    toDto(s: PushSettings): PushSettingsDto {
        return {
            timezone: s.timezone,
            quiet_hours_enabled: s.quietHoursEnabled,
            quiet_start: s.quietStart,
            quiet_end: s.quietEnd,
            cap_per_day: s.capPerDay,
            cap_per_week: s.capPerWeek,
            default_expiry_hours: s.defaultExpiryHours,
            skip_order_in_progress: s.skipOrderInProgress,
            test_phones: s.testPhones ?? [],
            updated_at: s.updatedAt ?? null,
        };
    }

    async update(
        tenantId: number,
        userId: number,
        body: Partial<PushSettingsDto>,
    ): Promise<PushSettingsDto> {
        const s = await this.get(tenantId);
        if (body.timezone !== undefined) {
            const tz = String(body.timezone).trim();
            if (!isValidTimeZone(tz)) {
                throw new BadRequestException(`Unknown time zone "${tz}"`);
            }
            s.timezone = tz;
        }
        if (body.quiet_hours_enabled !== undefined) {
            s.quietHoursEnabled = Boolean(body.quiet_hours_enabled);
        }
        for (const key of ['quiet_start', 'quiet_end'] as const) {
            if (body[key] !== undefined) {
                const v = String(body[key]);
                if (!TIME_RE.test(v)) {
                    throw new BadRequestException(
                        'Quiet hours must be times like 01:00',
                    );
                }
                if (key === 'quiet_start') s.quietStart = v;
                else s.quietEnd = v;
            }
        }
        if (s.quietHoursEnabled && s.quietStart === s.quietEnd) {
            throw new BadRequestException(
                'Quiet hours start and end cannot be the same time',
            );
        }
        const cap = (v: unknown, label: string): number | null => {
            if (v === null || v === '' || v === undefined) return null;
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 100) {
                throw new BadRequestException(
                    `${label} must be 1 to 100, or empty for no limit`,
                );
            }
            return n;
        };
        if (body.cap_per_day !== undefined) {
            s.capPerDay = cap(body.cap_per_day, 'The daily limit');
        }
        if (body.cap_per_week !== undefined) {
            s.capPerWeek = cap(body.cap_per_week, 'The weekly limit');
        }
        if (
            s.capPerDay != null &&
            s.capPerWeek != null &&
            s.capPerWeek < s.capPerDay
        ) {
            throw new BadRequestException(
                'The weekly limit cannot be lower than the daily limit',
            );
        }
        if (body.default_expiry_hours !== undefined) {
            const n = Number(body.default_expiry_hours);
            if (!Number.isInteger(n) || n < 1 || n > 672) {
                throw new BadRequestException(
                    'Expiry must be 1 to 672 hours (4 weeks)',
                );
            }
            s.defaultExpiryHours = n;
        }
        if (body.skip_order_in_progress !== undefined) {
            s.skipOrderInProgress = Boolean(body.skip_order_in_progress);
        }
        if (body.test_phones !== undefined) {
            const list = Array.isArray(body.test_phones)
                ? body.test_phones
                : String(body.test_phones ?? '').split(/[\s,;]+/);
            const cleaned: string[] = [];
            for (const raw of list
                .map((p) => String(p).trim())
                .filter(Boolean)) {
                const key = phoneKey(raw);
                if (!key) {
                    throw new BadRequestException(
                        `"${raw}" is not a valid Pakistani mobile number`,
                    );
                }
                const normalized = `0${key}`;
                if (!cleaned.includes(normalized)) cleaned.push(normalized);
            }
            if (cleaned.length > 20) {
                throw new BadRequestException('At most 20 test phones');
            }
            s.testPhones = cleaned;
        }
        s.updatedBy = userId;
        await this.repo.save(s);
        return this.toDto(await this.get(tenantId));
    }
}
