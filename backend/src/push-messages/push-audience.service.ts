import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
    audienceConditionSql,
    scopeConditionSql,
    SqlParams,
} from './push-audience-rules';
import type {
    AudienceSpec,
    PerCustomer,
    PushAudienceScope,
} from './push-message.types';
import type { DeviceRow } from './push-device-sync.service';

/** Order statuses that mean "the kitchen or a rider has it right now". */
export const IN_PROGRESS_STATUSES = [
    'placed',
    'accepted',
    'preparing',
    'ready',
];
/** An "in progress" order older than this is a forgotten one, not a wait. */
const IN_PROGRESS_MAX_HOURS = 12;

export interface EvaluateOptions {
    tenantId: number;
    audience: AudienceSpec;
    scope: PushAudienceScope;
    /** Only these phone types are sent to (null = all). */
    platforms: string[] | null;
    skipOrderInProgress: boolean;
    respectCap: boolean;
    capPerDay: number | null;
    capPerWeek: number | null;
    /** The message's own "once ever / once every N days" rule. */
    perCustomer?: {
        messageId: number;
        mode: PerCustomer;
        days: number | null;
    } | null;
}

export type SkipReason =
    | 'no_app'
    | 'rider'
    | 'opt_out'
    | 'repeat'
    | 'in_progress'
    | 'cap';

export interface EvaluatedCustomer {
    id: number;
    name: string | null;
    phone: string;
    phones: number;
    skip: SkipReason | null;
}

export interface AudienceCounts {
    matched: number;
    with_app: number;
    eligible: number;
    phones: number;
    skipped: Record<SkipReason, number>;
}

/**
 * Turns an audience into customers, and decides for each one whether they get
 * the message. A customer is counted under the first reason that applies:
 * no app → rider id → asked to stop → already had this message → order in
 * progress → over the cap. Everyone else is eligible.
 */
@Injectable()
export class PushAudienceService {
    constructor(private readonly dataSource: DataSource) {}

    async evaluate(opts: EvaluateOptions): Promise<EvaluatedCustomer[]> {
        const p = new SqlParams();
        const tenant = p.bind(opts.tenantId);
        const platforms = opts.platforms ? p.bind(opts.platforms) : null;
        const where = audienceConditionSql(opts.audience, p.bind);
        const scope = scopeConditionSql(opts.scope, p.bind);

        const inProgress = opts.skipOrderInProgress
            ? `EXISTS (SELECT 1 FROM orders ip WHERE ip.customer_id = c.id
                  AND ip.status = ANY(${p.bind(IN_PROGRESS_STATUSES)}::text[])
                  AND (ip.delivery_status IS NULL OR ip.delivery_status NOT IN ('delivered', 'delivery_failed'))
                  AND ip.placed_at >= now() - make_interval(hours => ${IN_PROGRESS_MAX_HOURS}))`
            : 'false';

        const capParts: string[] = [];
        if (opts.respectCap && opts.capPerDay != null) {
            capParts.push(`(SELECT count(*) FROM push_message_recipients cr
                WHERE cr.customer_id = c.id AND cr.status = 'sent'
                  AND cr.sent_at >= now() - interval '24 hours') >= ${p.bind(opts.capPerDay)}`);
        }
        if (opts.respectCap && opts.capPerWeek != null) {
            capParts.push(`(SELECT count(*) FROM push_message_recipients cr
                WHERE cr.customer_id = c.id AND cr.status = 'sent'
                  AND cr.sent_at >= now() - interval '7 days') >= ${p.bind(opts.capPerWeek)}`);
        }
        const capped = capParts.length ? `(${capParts.join(' OR ')})` : 'false';

        let repeat = 'false';
        const pc = opts.perCustomer;
        if (pc && pc.mode !== 'every') {
            const since =
                pc.mode === 'days' && pc.days
                    ? ` AND rr.sent_at >= now() - make_interval(days => ${p.bind(pc.days)})`
                    : '';
            repeat = `EXISTS (SELECT 1 FROM push_message_recipients rr
                WHERE rr.message_id = ${p.bind(pc.messageId)} AND rr.customer_id = c.id
                  AND rr.status IN ('sent', 'holdout', 'unknown')${since})`;
        }

        const rows: Array<{
            id: number;
            name: string | null;
            phone: string;
            is_rider: boolean;
            opted_out: boolean;
            phones: number;
            in_progress: boolean;
            capped: boolean;
            repeat_skip: boolean;
        }> = await this.dataSource.query(
            `SELECT c.id, c.name, c.phone,
                    EXISTS (SELECT 1 FROM rider_profiles rp WHERE rp.user_id = c.id) AS is_rider,
                    COALESCE(c.push_opt_out, false) AS opted_out,
                    (SELECT count(*)::int FROM push_devices d
                      WHERE ${usableDeviceSql('d', platforms)}) AS phones,
                    ${inProgress} AS in_progress,
                    ${capped} AS capped,
                    ${repeat} AS repeat_skip
             FROM customers c
             WHERE c.tenant_id = ${tenant}${scope} AND ${where}
             ORDER BY c.id DESC`,
            p.values,
        );

        return rows.map((r) => {
            let skip: SkipReason | null = null;
            if (r.is_rider) skip = 'rider';
            else if (r.phones === 0) skip = 'no_app';
            else if (r.opted_out) skip = 'opt_out';
            else if (r.repeat_skip) skip = 'repeat';
            else if (r.in_progress) skip = 'in_progress';
            else if (r.capped) skip = 'cap';
            return {
                id: Number(r.id),
                name: r.name,
                phone: r.phone,
                phones: Number(r.phones),
                skip,
            };
        });
    }

    count(rows: EvaluatedCustomer[]): AudienceCounts {
        const skipped: Record<SkipReason, number> = {
            no_app: 0,
            rider: 0,
            opt_out: 0,
            repeat: 0,
            in_progress: 0,
            cap: 0,
        };
        let phones = 0;
        let eligible = 0;
        for (const r of rows) {
            if (r.skip) skipped[r.skip]++;
            else {
                eligible++;
                phones += r.phones;
            }
        }
        return {
            matched: rows.length,
            with_app: rows.length - skipped.no_app - skipped.rider,
            eligible,
            phones,
            skipped,
        };
    }

    /**
     * The phones to send to for these customers: newest owner only, the
     * chosen phone types only, one copy per phone.
     */
    async devicesFor(
        customerIds: number[],
        platforms: string[] | null,
    ): Promise<DeviceRow[]> {
        if (customerIds.length === 0) return [];
        const params: unknown[] = [customerIds];
        const plat = platforms ? `$2` : null;
        if (platforms) params.push(platforms);
        const rows: DeviceRow[] = await this.dataSource.query(
            `SELECT d.doc_path, d.owner_ref, d.owner_id, d.token, d.platform
             FROM push_devices d
             WHERE d.owner_id = ANY($1::int[])
               AND ${usableDeviceSql('d', plat, false)}
             ORDER BY d.owner_id, d.last_updated DESC NULLS LAST`,
            params,
        );
        const seen = new Set<string>();
        return rows.filter((r) => {
            if (seen.has(r.token)) return false;
            seen.add(r.token);
            return true;
        });
    }
}

/**
 * A device row (alias `d`) that may receive for customer `c`: owned by them,
 * of an allowed phone type, and not saved more recently under another account
 * (a phone handed on keeps only its newest owner).
 */
function usableDeviceSql(
    d: string,
    platformsParam: string | null,
    ownerIsC = true,
): string {
    const owner = ownerIsC ? `${d}.owner_id = c.id AND ` : '';
    const plat = platformsParam
        ? ` AND ${d}.platform = ANY(${platformsParam}::text[])`
        : '';
    return `${owner}NOT EXISTS (
        SELECT 1 FROM push_devices nd
        WHERE nd.token = ${d}.token AND nd.doc_path <> ${d}.doc_path
          AND COALESCE(nd.last_updated, 'epoch') > COALESCE(${d}.last_updated, 'epoch')
    )${plat}`;
}
