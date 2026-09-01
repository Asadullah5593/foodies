import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PATH_REQUIRED_PERMISSIONS } from './path-permissions';
import { BRAND_LOCK_SQL } from '../branch-users/brand-lock';
import { expandPermissions } from '../roles/permission-implications';
import { isEnabled as isActivityLogEnabled } from '../activity-log/activity-log.config';

const ALL_BRANCHES_ACCESS = 'all-branches:access';

/**
 * Restricts access by permissions and special cases:
 * - Super admin (tenantId == null): full access.
 * - Rider: only /rider/* (deliveries module).
 * - Other tenant users: must have at least one of the required permissions for the request path
 *   (permissions come from roles assigned in tenant_users and branch_users; roles are configured
 *   in the Roles module by super admin / tenant admin).
 * Also sets request.user.allowedBranchIds for tenant users: null = all branches (GM), number[] = only those branches (Branch Manager).
 * Also sets request.user.allowedBrandIds: null = all brands; number[] = the user's
 * branch_users rows all carry a brand_id, locking the user to those brands (brand till).
 */
@Injectable()
export class RoleAccessGuard implements CanActivate {
    constructor(private dataSource: DataSource) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{
            user?: {
                id: number;
                tenantId: number | null;
                isSuperAdmin?: boolean;
                isRider?: boolean;
                allowedBranchIds?: number[] | null;
                allowedBrandIds?: number[] | null;
                permissions?: string[];
                orderHistoryDays?: number | null;
                staffDiscountCeiling?: {
                    maxPercent: number | null;
                    maxAmount: number | null;
                };
                roles?: Array<{ slug: string; name: string }>;
            };
            path?: string;
            url?: string;
        }>();
        const user = request.user;
        if (!user?.id) return true;

        const path =
            (request.path ?? request.url?.split('?')[0] ?? '').replace(
                /\/$/,
                '',
            ) || '/';

        // Platform administrator: no restriction, no branch filter. Read off
        // the user row — never inferred from a missing tenant link.
        if (user.isSuperAdmin === true) return true;

        // No tenant and not a platform admin: the account belongs to nobody.
        // Everything downstream reads `tenantId == null` as "super admin", so
        // this request must not be allowed to travel any further. It is what a
        // half-finished delete leaves behind.
        if (user.tenantId == null) {
            throw new ForbiddenException(
                'This account is not attached to any business.',
            );
        }

        // Resolve allowed branches for tenant users (Branch Manager vs General Manager)
        user.allowedBranchIds = await this.getAllowedBranchIds(
            user.id,
            user.tenantId,
        );
        user.allowedBrandIds = await this.getAllowedBrandIds(
            user.id,
            user.tenantId,
        );
        // Expose the resolved permission set so downstream services can enforce
        // action-specific permissions (the path guard is coarse, any-of-prefix).
        // Expand umbrella → granular so services reading request.user.permissions
        // (and the path check below) see the full effective set.
        const permissionNames = expandPermissions(
            await this.getUserPermissionNames(user.id, user.tenantId),
        );
        user.permissions = [...permissionNames];
        // How far back this user may read order history (null = unlimited).
        user.orderHistoryDays = await this.getOrderHistoryDays(
            user.id,
            user.tenantId,
        );
        // How large a staff discount this user may grant at the till.
        user.staffDiscountCeiling = await this.getStaffDiscountCeiling(
            user.id,
            user.tenantId,
        );
        // Roles held RIGHT NOW, snapshotted onto the row by the activity log.
        // Roles get edited, so resolving them at read time would answer "what
        // can they do today" when the question is "what could they do then".
        // Skipped entirely when the log is off, so the auth path pays nothing.
        if (isActivityLogEnabled()) {
            user.roles = await this.getUserRoles(user.id, user.tenantId);
        }

        // Tenant users cannot access tenants module (super admin only)
        if (path.startsWith('/admin/tenants')) {
            throw new ForbiddenException(
                'Only Super Admin can access the Tenants module',
            );
        }

        // Rider: only deliveries (rider/*)
        if (user.isRider === true) {
            if (path.startsWith('/rider')) return true;
            throw new ForbiddenException(
                'Rider can only access the deliveries module',
            );
        }

        // Find longest matching path prefix
        const sorted = [...PATH_REQUIRED_PERMISSIONS].sort(
            (a, b) => b.prefix.length - a.prefix.length,
        );
        const match = sorted.find(
            (p) => path === p.prefix || path.startsWith(p.prefix + '/'),
        );
        if (!match) return true; // unknown path, allow (or add more entries to PATH_REQUIRED_PERMISSIONS)

        // No open-ended modules: empty required permissions means no access
        if (match.permissionNames.length === 0) {
            throw new ForbiddenException('This route requires a permission');
        }

        const hasAny = match.permissionNames.some((p) =>
            permissionNames.has(p),
        );
        if (!hasAny) {
            throw new ForbiddenException(
                `Access requires one of these permissions: ${match.permissionNames.join(', ')}`,
            );
        }
        return true;
    }

    /** Role slug + name for the audit snapshot. One indexed lookup on ≤3 ids. */
    private async getUserRoles(
        userId: number,
        tenantId: number,
    ): Promise<Array<{ slug: string; name: string }>> {
        try {
            const rows = (await this.dataSource.query(
                `SELECT DISTINCT r.slug, r.name
                 FROM roles r
                 WHERE r.id IN (
                     SELECT role_id FROM tenant_users
                     WHERE user_id = $1 AND tenant_id = $2 AND role_id IS NOT NULL
                     UNION
                     SELECT role_id FROM branch_users WHERE user_id = $1
                 )`,
                [userId, tenantId],
            )) as unknown as Array<{ slug: string; name: string }>;
            return rows;
        } catch {
            // Never let an audit nicety break authentication.
            return [];
        }
    }

    private async getUserPermissionNames(
        userId: number,
        tenantId: number,
    ): Promise<Set<string>> {
        const roleIdRows = (await this.dataSource.query(
            `SELECT role_id FROM tenant_users WHERE user_id = $1 AND tenant_id = $2 AND role_id IS NOT NULL
             UNION
             SELECT role_id FROM branch_users WHERE user_id = $1`,
            [userId, tenantId],
        )) as unknown as Array<{ role_id: number | null }>;
        const roleIds = [...new Set(roleIdRows.map((r) => r.role_id))].filter(
            (id) => id != null,
        );
        if (roleIds.length === 0) return new Set();
        const placeholders = roleIds.map((_, i) => `$${i + 1}`).join(',');
        const rows = (await this.dataSource.query(
            `SELECT p.name FROM permissions p
             INNER JOIN role_permissions rp ON rp.permission_id = p.id
             WHERE rp.role_id IN (${placeholders})`,
            roleIds,
        )) as unknown as Array<{ name: string }>;
        return new Set(rows.map((r) => r.name));
    }

    /**
     * Order-history window in days for the admin Orders module; null =
     * unlimited. A user may hold several roles, so the most permissive window
     * wins: any role with no limit means no limit, otherwise the largest value.
     */
    private async getOrderHistoryDays(
        userId: number,
        tenantId: number,
    ): Promise<number | null> {
        const rows = (await this.dataSource.query(
            `SELECT bool_or(r.order_history_days IS NULL) AS has_unlimited,
                    MAX(r.order_history_days) AS max_days
             FROM roles r
             WHERE r.id IN (
                 SELECT role_id FROM tenant_users
                 WHERE user_id = $1 AND tenant_id = $2 AND role_id IS NOT NULL
                 UNION
                 SELECT role_id FROM branch_users WHERE user_id = $1
             )`,
            [userId, tenantId],
        )) as unknown as Array<{
            has_unlimited: boolean | null;
            max_days: number | string | null;
        }>;
        const row = rows[0];
        // No roles at all, or at least one unrestricted role → unlimited.
        if (!row || row.has_unlimited !== false) return null;
        const maxDays = row.max_days == null ? null : Number(row.max_days);
        return maxDays != null && Number.isFinite(maxDays) && maxDays > 0
            ? maxDays
            : null;
    }

    /**
     * Ceiling on a staff discount this user may grant, resolved across all their
     * roles — most permissive wins (null/uncapped beats any number, otherwise
     * the largest), same rule as the order-history window. A user with no roles
     * gets 0/0, i.e. may grant nothing.
     *
     * `maxPercent` gates percentage presets by their configured value;
     * `maxAmount` gates the resulting rupees for any preset, which is the only
     * meaningful check on a flat one.
     */
    private async getStaffDiscountCeiling(
        userId: number,
        tenantId: number,
    ): Promise<{ maxPercent: number | null; maxAmount: number | null }> {
        const rows = (await this.dataSource.query(
            `SELECT bool_or(r.max_staff_discount_percent IS NULL) AS percent_unlimited,
                    MAX(r.max_staff_discount_percent) AS max_percent,
                    bool_or(r.max_staff_discount_amount IS NULL) AS amount_unlimited,
                    MAX(r.max_staff_discount_amount) AS max_amount,
                    COUNT(*) AS role_count
             FROM roles r
             WHERE r.id IN (
                 SELECT role_id FROM tenant_users
                 WHERE user_id = $1 AND tenant_id = $2 AND role_id IS NOT NULL
                 UNION
                 SELECT role_id FROM branch_users WHERE user_id = $1
             )`,
            [userId, tenantId],
        )) as unknown as Array<{
            percent_unlimited: boolean | null;
            max_percent: number | string | null;
            amount_unlimited: boolean | null;
            max_amount: number | string | null;
            role_count: number | string;
        }>;
        const row = rows[0];
        // No roles at all → grant nothing, rather than inheriting "unlimited"
        // from an empty aggregate.
        if (!row || Number(row.role_count ?? 0) === 0)
            return { maxPercent: 0, maxAmount: 0 };
        return {
            maxPercent:
                row.percent_unlimited !== false
                    ? null
                    : Number(row.max_percent ?? 0),
            maxAmount:
                row.amount_unlimited !== false
                    ? null
                    : Number(row.max_amount ?? 0),
        };
    }

    /**
     * For tenant users: null = can access all tenant branches (General Manager);
     * number[] = can only access these branch IDs (Branch Manager).
     */
    private async getAllowedBranchIds(
        userId: number,
        tenantId: number,
    ): Promise<number[] | null> {
        const permissionNames = await this.getUserPermissionNames(
            userId,
            tenantId,
        );
        if (permissionNames.has(ALL_BRANCHES_ACCESS)) return null;

        const rows = (await this.dataSource.query(
            `SELECT DISTINCT bu.branch_id
             FROM branch_users bu
             INNER JOIN branch_brands bb ON bb.branch_id = bu.branch_id
             INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
             WHERE bu.user_id = $2`,
            [tenantId, userId],
        )) as unknown as Array<{ branch_id: number }>;
        return rows.map((r) => r.branch_id);
    }

    /**
     * null = unrestricted (all brands); number[] = user is brand-locked.
     * A user is brand-locked only when they have branch_users rows and EVERY
     * row carries a brand_id (a row without brand_id grants the whole branch).
     * Users with all-branches:access (GM/owner) are never brand-locked.
     */
    private async getAllowedBrandIds(
        userId: number,
        tenantId: number,
    ): Promise<number[] | null> {
        const permissionNames = await this.getUserPermissionNames(
            userId,
            tenantId,
        );
        if (permissionNames.has(ALL_BRANCHES_ACCESS)) return null;

        // One row per branch, each naming the brands it locks the user to. A
        // single row without a lock means "all brands" somewhere, which is a
        // lock on nothing — the whole user goes unrestricted, as before.
        const rows = (await this.dataSource.query(
            `SELECT DISTINCT ${BRAND_LOCK_SQL('bu')} AS brand_ids
             FROM branch_users bu
             INNER JOIN branch_brands bb ON bb.branch_id = bu.branch_id
             INNER JOIN brands br ON br.id = bb.brand_id AND br.tenant_id = $1
             WHERE bu.user_id = $2`,
            [tenantId, userId],
        )) as unknown as Array<{ brand_ids: number[] | null }>;
        if (rows.length === 0) return null;
        if (rows.some((r) => r.brand_ids == null)) return null;
        const ids = new Set<number>();
        for (const r of rows)
            for (const id of r.brand_ids ?? []) ids.add(Number(id));
        return ids.size === 0 ? null : [...ids];
    }
}
