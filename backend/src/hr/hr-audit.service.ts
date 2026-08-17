import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { HrAuditLog } from '../entities/hr-audit-log.entity';

type AuditEntry = {
    tenantId: number | null;
    actorUserId: number | null;
    action: string;
    entityTable: string;
    entityId: number | null;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    ipAddress?: string | null;
};

/**
 * Append-only HR audit trail.
 *
 * Writes never block the operation that triggered them: an audit failure is
 * logged and swallowed, because refusing to record someone's resignation
 * because the log table is full would be a worse outcome than a gap in the log.
 * Pass a transactional `EntityManager` when the caller is inside one, so the
 * audit row rolls back with the change it describes.
 */
@Injectable()
export class HrAuditService {
    private readonly logger = new Logger(HrAuditService.name);

    constructor(
        @InjectRepository(HrAuditLog)
        private readonly repo: Repository<HrAuditLog>,
    ) {}

    async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
        try {
            const repo = manager
                ? manager.getRepository(HrAuditLog)
                : this.repo;
            await repo.save(
                repo.create({
                    tenantId: entry.tenantId,
                    actorUserId: entry.actorUserId,
                    action: entry.action,
                    entityTable: entry.entityTable,
                    entityId: entry.entityId,
                    before: entry.before ?? {},
                    after: entry.after ?? {},
                    ipAddress: entry.ipAddress ?? null,
                }),
            );
        } catch (err) {
            this.logger.error(
                `HR audit write failed for ${entry.action} on ${entry.entityTable}#${entry.entityId}`,
                err instanceof Error ? err.stack : String(err),
            );
        }
    }

    /**
     * Only the fields that actually changed, so the log answers "who changed
     * this and from what" instead of duplicating the row on every edit.
     */
    static diff(
        before: Record<string, unknown>,
        after: Record<string, unknown>,
    ): { before: Record<string, unknown>; after: Record<string, unknown> } {
        const b: Record<string, unknown> = {};
        const a: Record<string, unknown> = {};
        for (const key of Object.keys(after)) {
            if (before[key] !== after[key]) {
                b[key] = before[key];
                a[key] = after[key];
            }
        }
        return { before: b, after: a };
    }

    async list(
        tenantId: number | null,
        filters: { entityTable?: string; entityId?: number; limit?: number },
    ) {
        const qb = this.repo
            .createQueryBuilder('log')
            .leftJoinAndSelect('log.actor', 'actor')
            .orderBy('log.created_at', 'DESC')
            .limit(Math.min(filters.limit ?? 100, 500));
        if (tenantId != null)
            qb.andWhere('log.tenant_id = :tenantId', { tenantId });
        if (filters.entityTable)
            qb.andWhere('log.entity_table = :t', { t: filters.entityTable });
        if (filters.entityId != null)
            qb.andWhere('log.entity_id = :eid', { eid: filters.entityId });

        const rows = await qb.getMany();
        return rows.map((r) => ({
            id: r.id,
            action: r.action,
            entity_table: r.entityTable,
            entity_id: r.entityId,
            actor: r.actor ? { id: r.actor.id, name: r.actor.name } : null,
            before: r.before,
            after: r.after,
            created_at: r.createdAt,
        }));
    }
}
