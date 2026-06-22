import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

type RiderRow = {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
};

type LinkRow = {
    rider_user_id: number;
    brand_id: number;
    source: 'owned' | 'shared';
    brand_name: string;
};

type ShareRequestRow = {
    id: number;
    tenant_id: number;
    requesting_brand_id: number;
    brand_name: string | null;
    rider_user_id: number;
    rider_name: string | null;
    status: string;
    note: string | null;
    requested_by: number | null;
    requested_by_name: string | null;
    reviewed_by: number | null;
    reviewed_at: Date | null;
    review_note: string | null;
    created_at: Date;
    updated_at: Date;
};

/**
 * Rider brand-ownership & sharing. rider_brands is the single source of truth
 * for which brands a rider serves; share requests let a brand admin ask the
 * owner/GM to share a Foodies-pool rider to their brand.
 */
@Injectable()
export class RiderSharingService {
    constructor(private readonly dataSource: DataSource) {}

    /** Typed raw query (TypeORM's query() is untyped). */
    private async raw<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        const rows: unknown = await this.dataSource.query(sql, params);
        return (rows ?? []) as T[];
    }

    /** Typed raw query inside a transaction. */
    private async rawM<T>(
        manager: EntityManager,
        sql: string,
        params: unknown[] = [],
    ): Promise<T[]> {
        const rows: unknown = await manager.query(sql, params);
        return (rows ?? []) as T[];
    }

    /** Clamp a brand-locked caller to their own brands; reject escapes. */
    private assertBrandInScope(
        brandId: number,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        if (allowedBrandIds == null) return;
        if (!allowedBrandIds.includes(Number(brandId))) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
    }

    private async fetchRatings(
        tenantId: number,
        riderIds: number[],
    ): Promise<
        Map<number, { rating_count: number; rating_average: number | null }>
    > {
        const map = new Map<
            number,
            { rating_count: number; rating_average: number | null }
        >();
        if (riderIds.length === 0) return map;
        const stats = await this.raw<{
            rider_id: number;
            rating_count: string;
            rating_average: string | null;
        }>(
            `SELECT ror.rider_user_id AS rider_id,
                    COUNT(*)::text AS rating_count,
                    AVG(ror.stars)::text AS rating_average
             FROM rider_order_ratings ror
             INNER JOIN orders o ON o.id = ror.order_id AND o.tenant_id = $1
             WHERE ror.rider_user_id = ANY($2::int[])
             GROUP BY ror.rider_user_id`,
            [tenantId, riderIds],
        );
        for (const s of stats) {
            const avgRaw = s.rating_average;
            map.set(Number(s.rider_id), {
                rating_count: parseInt(String(s.rating_count), 10) || 0,
                rating_average:
                    avgRaw != null && avgRaw !== ''
                        ? Math.round(parseFloat(String(avgRaw)) * 10) / 10
                        : null,
            });
        }
        return map;
    }

    private async fetchLinksByRider(
        tenantId: number,
        riderIds: number[],
    ): Promise<Map<number, LinkRow[]>> {
        const map = new Map<number, LinkRow[]>();
        if (riderIds.length === 0) return map;
        const rows = await this.raw<LinkRow>(
            `SELECT rb.rider_user_id, rb.brand_id, rb.source, b.name AS brand_name
             FROM rider_brands rb
             INNER JOIN brands b ON b.id = rb.brand_id
             WHERE rb.tenant_id = $1 AND rb.rider_user_id = ANY($2::int[])
             ORDER BY b.name ASC`,
            [tenantId, riderIds],
        );
        for (const r of rows) {
            const list = map.get(Number(r.rider_user_id)) ?? [];
            list.push(r);
            map.set(Number(r.rider_user_id), list);
        }
        return map;
    }

    /** Owner/GM view: every tenant rider with their brand links + owner badge. */
    async listRidersForOwner(tenantId: number) {
        const riders = await this.raw<RiderRow>(
            `SELECT DISTINCT u.id, u.name, u.email, u.phone
             FROM users u
             WHERE u.id IN (
                 SELECT bu.user_id FROM branch_users bu
                 INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
                 INNER JOIN branch_brands bb ON bb.branch_id = bu.branch_id
                 INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
                 UNION
                 SELECT rb.rider_user_id FROM rider_brands rb WHERE rb.tenant_id = $1
             )
             ORDER BY u.name ASC`,
            [tenantId],
        );
        const ids = riders.map((r) => r.id);
        const [links, ratings] = await Promise.all([
            this.fetchLinksByRider(tenantId, ids),
            this.fetchRatings(tenantId, ids),
        ]);
        return riders.map((r) => this.toRiderWithBrands(r, links, ratings));
    }

    private toRiderWithBrands(
        r: RiderRow,
        links: Map<number, LinkRow[]>,
        ratings: Map<
            number,
            { rating_count: number; rating_average: number | null }
        >,
    ) {
        const myLinks = links.get(r.id) ?? [];
        const owned = myLinks.find((l) => l.source === 'owned');
        const st = ratings.get(r.id);
        return {
            id: r.id,
            name: r.name,
            email: r.email ?? null,
            phone: r.phone ?? null,
            owner_brand_id: owned ? owned.brand_id : null,
            owner_brand_name: owned ? owned.brand_name : null,
            brand_ids: myLinks.map((l) => l.brand_id),
            brands: myLinks.map((l) => ({
                id: l.brand_id,
                name: l.brand_name,
                source: l.source,
            })),
            is_dispatchable: myLinks.length > 0,
            rating_count: st?.rating_count ?? 0,
            rating_average: st?.rating_average ?? null,
        };
    }

    /** Brand links for a single rider (owner/GM). */
    async getRiderBrandLinks(tenantId: number, riderUserId: number) {
        const links = await this.fetchLinksByRider(tenantId, [riderUserId]);
        return (links.get(riderUserId) ?? []).map((l) => ({
            rider_user_id: riderUserId,
            brand_id: l.brand_id,
            brand_name: l.brand_name,
            source: l.source,
        }));
    }

    private async assertTenantRider(
        tenantId: number,
        riderUserId: number,
    ): Promise<void> {
        const rows = await this.raw<{ ok: number }>(
            `SELECT 1 AS ok FROM users u
             WHERE u.id = $2 AND u.id IN (
                 SELECT bu.user_id FROM branch_users bu
                 INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
                 INNER JOIN branch_brands bb ON bb.branch_id = bu.branch_id
                 INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
             )
             LIMIT 1`,
            [tenantId, riderUserId],
        );
        if (rows.length === 0) {
            throw new NotFoundException('Rider not found in this tenant');
        }
    }

    /** Owner/GM: link a rider to a brand (shared). Idempotent. */
    async assignRiderToBrand(
        tenantId: number,
        riderUserId: number,
        brandId: number,
        actingUserId: number,
    ) {
        await this.assertTenantRider(tenantId, riderUserId);
        const brandRows = await this.raw<{ ok: number }>(
            `SELECT 1 AS ok FROM brands WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            [brandId, tenantId],
        );
        if (brandRows.length === 0) {
            throw new NotFoundException('Brand not found in this tenant');
        }
        await this.raw(
            `INSERT INTO rider_brands (rider_user_id, brand_id, tenant_id, source, created_by, created_at)
             VALUES ($1, $2, $3, 'shared', $4, now())
             ON CONFLICT (rider_user_id, brand_id) DO NOTHING`,
            [riderUserId, brandId, tenantId, actingUserId],
        );
        return this.getRiderBrandLinks(tenantId, riderUserId);
    }

    private async assertNoActiveOrderForBrand(
        tenantId: number,
        riderUserId: number,
        brandId: number,
    ): Promise<void> {
        const rows = await this.raw<{ ok: number }>(
            `SELECT 1 AS ok FROM orders
             WHERE tenant_id = $1 AND rider_id = $2 AND brand_id = $3
               AND delivery_status IN ('accepted', 'picked_up')
             LIMIT 1`,
            [tenantId, riderUserId, brandId],
        );
        if (rows.length > 0) {
            throw new BadRequestException(
                'This rider has an active order for this brand; reassign it before removing the link',
            );
        }
    }

    /** Owner/GM: remove a brand link (cannot remove the 'owned' link). */
    async removeRiderFromBrand(
        tenantId: number,
        riderUserId: number,
        brandId: number,
    ) {
        const existing = await this.raw<{ source: string }>(
            `SELECT source FROM rider_brands
             WHERE rider_user_id = $1 AND brand_id = $2 AND tenant_id = $3
             LIMIT 1`,
            [riderUserId, brandId, tenantId],
        );
        if (existing.length === 0) {
            throw new NotFoundException('Rider is not linked to this brand');
        }
        if (existing[0].source === 'owned') {
            throw new BadRequestException(
                'Cannot remove the owning brand of a rider',
            );
        }
        await this.assertNoActiveOrderForBrand(tenantId, riderUserId, brandId);
        await this.raw(
            `DELETE FROM rider_brands
             WHERE rider_user_id = $1 AND brand_id = $2 AND tenant_id = $3`,
            [riderUserId, brandId, tenantId],
        );
        return this.getRiderBrandLinks(tenantId, riderUserId);
    }

    /**
     * Owner/GM: replace a rider's SHARED links with the given set. The owned
     * link is always retained regardless of the payload. Removals are rejected
     * when the rider has an active order for that brand.
     */
    async setRiderBrands(
        tenantId: number,
        riderUserId: number,
        brandIds: number[],
        actingUserId: number,
    ) {
        await this.assertTenantRider(tenantId, riderUserId);
        const current = await this.raw<{ brand_id: number; source: string }>(
            `SELECT brand_id, source FROM rider_brands
             WHERE rider_user_id = $1 AND tenant_id = $2`,
            [riderUserId, tenantId],
        );
        const ownedBrandId = current.find(
            (c) => c.source === 'owned',
        )?.brand_id;
        const target = new Set(brandIds.map((b) => Number(b)));
        if (ownedBrandId != null) target.add(Number(ownedBrandId)); // never drop owner

        // Validate target brands belong to this tenant.
        if (target.size > 0) {
            const valid = await this.raw<{ id: number }>(
                `SELECT id FROM brands WHERE tenant_id = $1 AND id = ANY($2::int[])`,
                [tenantId, [...target]],
            );
            const validSet = new Set(valid.map((v) => Number(v.id)));
            for (const b of target) {
                if (!validSet.has(b)) {
                    throw new NotFoundException(
                        `Brand ${b} not found in this tenant`,
                    );
                }
            }
        }

        const currentShared = current
            .filter((c) => c.source === 'shared')
            .map((c) => Number(c.brand_id));
        const toRemove = currentShared.filter((b) => !target.has(b));
        const currentAll = new Set(current.map((c) => Number(c.brand_id)));
        const toAdd = [...target].filter((b) => !currentAll.has(b));

        for (const b of toRemove) {
            await this.assertNoActiveOrderForBrand(tenantId, riderUserId, b);
        }
        for (const b of toRemove) {
            await this.raw(
                `DELETE FROM rider_brands
                 WHERE rider_user_id = $1 AND brand_id = $2 AND tenant_id = $3 AND source = 'shared'`,
                [riderUserId, b, tenantId],
            );
        }
        for (const b of toAdd) {
            await this.raw(
                `INSERT INTO rider_brands (rider_user_id, brand_id, tenant_id, source, created_by, created_at)
                 VALUES ($1, $2, $3, 'shared', $4, now())
                 ON CONFLICT (rider_user_id, brand_id) DO NOTHING`,
                [riderUserId, b, tenantId, actingUserId],
            );
        }
        return this.getRiderBrandLinks(tenantId, riderUserId);
    }

    // ——— Share requests ———

    private toRequestResponse(r: ShareRequestRow) {
        return {
            id: r.id,
            tenant_id: r.tenant_id,
            requesting_brand_id: r.requesting_brand_id,
            brand_name: r.brand_name ?? null,
            rider_user_id: r.rider_user_id,
            rider_name: r.rider_name ?? null,
            status: r.status,
            note: r.note ?? null,
            requested_by_user_id: r.requested_by ?? null,
            requested_by_name: r.requested_by_name ?? null,
            decided_by_user_id: r.reviewed_by ?? null,
            decided_at: r.reviewed_at?.toISOString() ?? null,
            decline_reason: r.review_note ?? null,
            created_at: r.created_at?.toISOString() ?? null,
            updated_at: r.updated_at?.toISOString() ?? null,
        };
    }

    /**
     * List share requests. Owner/GM (allowedBrandIds == null) sees all; a
     * brand-locked caller sees only requests for their own brands.
     */
    async listShareRequests(
        tenantId: number,
        opts: { status?: string; allowedBrandIds?: number[] | null },
    ) {
        const params: unknown[] = [tenantId];
        let where = `req.tenant_id = $1`;
        if (opts.allowedBrandIds != null) {
            if (opts.allowedBrandIds.length === 0) return [];
            params.push(opts.allowedBrandIds);
            where += ` AND req.requesting_brand_id = ANY($${params.length}::int[])`;
        }
        if (opts.status) {
            params.push(opts.status);
            where += ` AND req.status = $${params.length}`;
        }
        const rows = await this.raw<ShareRequestRow>(
            `SELECT req.id, req.tenant_id, req.requesting_brand_id,
                    b.name AS brand_name, req.rider_user_id, ru.name AS rider_name,
                    req.status, req.note, req.requested_by, qu.name AS requested_by_name,
                    req.reviewed_by, req.reviewed_at, req.review_note,
                    req.created_at, req.updated_at
             FROM rider_share_requests req
             LEFT JOIN brands b ON b.id = req.requesting_brand_id
             LEFT JOIN users ru ON ru.id = req.rider_user_id
             LEFT JOIN users qu ON qu.id = req.requested_by
             WHERE ${where}
             ORDER BY req.created_at DESC`,
            params,
        );
        return rows.map((r) => this.toRequestResponse(r));
    }

    /** Pool riders (no 'owned' link) a brand may request, not yet linked to it. */
    async listAvailablePoolRiders(
        tenantId: number,
        brandId: number,
        allowedBrandIds: number[] | null | undefined,
    ) {
        this.assertBrandInScope(brandId, allowedBrandIds);
        const riders = await this.raw<RiderRow>(
            `SELECT DISTINCT u.id, u.name, u.email, u.phone
             FROM users u
             WHERE u.status = 'active'
               AND u.id IN (
                 SELECT bu.user_id FROM branch_users bu
                 INNER JOIN roles r ON r.id = bu.role_id AND r.slug = 'rider'
                 INNER JOIN branch_brands bb ON bb.branch_id = bu.branch_id
                 INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
               )
               AND NOT EXISTS (
                 SELECT 1 FROM rider_brands ro
                 WHERE ro.rider_user_id = u.id AND ro.source = 'owned'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM rider_brands rl
                 WHERE rl.rider_user_id = u.id AND rl.brand_id = $2
               )
             ORDER BY u.name ASC`,
            [tenantId, brandId],
        );
        const ids = riders.map((r) => r.id);
        const ratings = await this.fetchRatings(tenantId, ids);
        const pending = await this.raw<{ rider_user_id: number }>(
            `SELECT rider_user_id FROM rider_share_requests
             WHERE tenant_id = $1 AND requesting_brand_id = $2 AND status = 'pending'`,
            [tenantId, brandId],
        );
        const pendingSet = new Set(pending.map((p) => Number(p.rider_user_id)));
        return riders.map((r) => {
            const st = ratings.get(r.id);
            return {
                id: r.id,
                name: r.name,
                phone: r.phone ?? null,
                rating_average: st?.rating_average ?? null,
                rating_count: st?.rating_count ?? 0,
                request_status: pendingSet.has(r.id) ? 'pending' : null,
            };
        });
    }

    /** Brand admin: request a pool rider for a brand. */
    async createShareRequest(
        tenantId: number,
        input: { brand_id: number; rider_user_id: number; note?: string },
        requestedBy: number,
        allowedBrandIds: number[] | null | undefined,
    ) {
        const brandId = Number(input.brand_id);
        const riderUserId = Number(input.rider_user_id);
        if (!brandId || !riderUserId) {
            throw new BadRequestException(
                'brand_id and rider_user_id are required',
            );
        }
        this.assertBrandInScope(brandId, allowedBrandIds);
        await this.assertTenantRider(tenantId, riderUserId);

        const already = await this.raw<{ source: string }>(
            `SELECT source FROM rider_brands
             WHERE rider_user_id = $1 AND brand_id = $2 AND tenant_id = $3 LIMIT 1`,
            [riderUserId, brandId, tenantId],
        );
        if (already.length > 0) {
            throw new ConflictException(
                'This rider is already linked to your brand',
            );
        }
        const owned = await this.raw<{ ok: number }>(
            `SELECT 1 AS ok FROM rider_brands
             WHERE rider_user_id = $1 AND source = 'owned' LIMIT 1`,
            [riderUserId],
        );
        if (owned.length > 0) {
            throw new BadRequestException(
                'Only Foodies-pool riders can be requested',
            );
        }
        try {
            const rows = await this.raw<{ id: number }>(
                `INSERT INTO rider_share_requests
                    (tenant_id, requesting_brand_id, rider_user_id, status, note, requested_by, created_at, updated_at)
                 VALUES ($1, $2, $3, 'pending', $4, $5, now(), now())
                 RETURNING id`,
                [
                    tenantId,
                    brandId,
                    riderUserId,
                    input.note ?? null,
                    requestedBy,
                ],
            );
            return { id: rows[0].id, status: 'pending' };
        } catch (e) {
            // Partial-unique pending index → duplicate open request.
            const code = (e as { code?: string })?.code;
            if (code === '23505') {
                throw new ConflictException(
                    'A pending request for this rider already exists',
                );
            }
            throw e;
        }
    }

    /** Brand admin (or owner): cancel a pending request. */
    async cancelShareRequest(
        tenantId: number,
        id: number,
        actingUserId: number,
        allowedBrandIds: number[] | null | undefined,
    ) {
        return this.dataSource.transaction(async (manager) => {
            const rows = await this.rawM<{
                id: number;
                requesting_brand_id: number;
                status: string;
            }>(
                manager,
                `SELECT id, requesting_brand_id, status FROM rider_share_requests
                 WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [id, tenantId],
            );
            if (rows.length === 0) {
                throw new NotFoundException('Request not found');
            }
            const req = rows[0];
            this.assertBrandInScope(req.requesting_brand_id, allowedBrandIds);
            if (req.status !== 'pending') {
                throw new BadRequestException(
                    'Only pending requests can be cancelled',
                );
            }
            await this.rawM(
                manager,
                `UPDATE rider_share_requests
                 SET status = 'cancelled', reviewed_by = $2, reviewed_at = now(), updated_at = now()
                 WHERE id = $1`,
                [id, actingUserId],
            );
            return { id, status: 'cancelled' };
        });
    }

    /** Owner/GM: approve a pending request → create a 'shared' link. */
    async approveShareRequest(
        tenantId: number,
        id: number,
        actingUserId: number,
    ) {
        return this.dataSource.transaction(async (manager) => {
            const rows = await this.rawM<{
                id: number;
                requesting_brand_id: number;
                rider_user_id: number;
                status: string;
            }>(
                manager,
                `SELECT id, requesting_brand_id, rider_user_id, status
                 FROM rider_share_requests
                 WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [id, tenantId],
            );
            if (rows.length === 0) {
                throw new NotFoundException('Request not found');
            }
            const req = rows[0];
            if (req.status !== 'pending') {
                throw new BadRequestException(
                    'Only pending requests can be approved',
                );
            }
            const riderActive = await this.rawM<{ ok: number }>(
                manager,
                `SELECT 1 AS ok FROM users WHERE id = $1 AND status = 'active' LIMIT 1`,
                [req.rider_user_id],
            );
            if (riderActive.length === 0) {
                throw new BadRequestException(
                    'Rider is no longer active; cannot approve',
                );
            }
            await this.rawM(
                manager,
                `INSERT INTO rider_brands (rider_user_id, brand_id, tenant_id, source, created_by, created_at)
                 VALUES ($1, $2, $3, 'shared', $4, now())
                 ON CONFLICT (rider_user_id, brand_id) DO NOTHING`,
                [
                    req.rider_user_id,
                    req.requesting_brand_id,
                    tenantId,
                    actingUserId,
                ],
            );
            await this.rawM(
                manager,
                `UPDATE rider_share_requests
                 SET status = 'approved', reviewed_by = $2, reviewed_at = now(), updated_at = now()
                 WHERE id = $1`,
                [id, actingUserId],
            );
            return { id, status: 'approved' };
        });
    }

    /** Owner/GM: decline a pending request. */
    async declineShareRequest(
        tenantId: number,
        id: number,
        actingUserId: number,
        reason?: string,
    ) {
        return this.dataSource.transaction(async (manager) => {
            const rows = await this.rawM<{ id: number; status: string }>(
                manager,
                `SELECT id, status FROM rider_share_requests
                 WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [id, tenantId],
            );
            if (rows.length === 0) {
                throw new NotFoundException('Request not found');
            }
            if (rows[0].status !== 'pending') {
                throw new BadRequestException(
                    'Only pending requests can be declined',
                );
            }
            await this.rawM(
                manager,
                `UPDATE rider_share_requests
                 SET status = 'declined', reviewed_by = $2, reviewed_at = now(),
                     review_note = $3, updated_at = now()
                 WHERE id = $1`,
                [id, actingUserId, reason ?? null],
            );
            return { id, status: 'declined' };
        });
    }
}
