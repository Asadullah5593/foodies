import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PATH_REQUIRED_PERMISSIONS } from './path-permissions';

const ALL_BRANCHES_ACCESS = 'all-branches:access';

/**
 * Restricts access by permissions and special cases:
 * - Super admin (tenantId == null): full access.
 * - Rider: only /rider/* (deliveries module).
 * - Other tenant users: must have at least one of the required permissions for the request path
 *   (permissions come from roles assigned in tenant_users and branch_users; roles are configured
 *   in the Roles module by super admin / tenant admin).
 * Also sets request.user.allowedBranchIds for tenant users: null = all branches (GM), number[] = only those branches (Branch Manager).
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

        // Super admin: no restriction; no branch filter
        if (user.tenantId == null) return true;

        // Resolve allowed branches for tenant users (Branch Manager vs General Manager)
        user.allowedBranchIds = await this.getAllowedBranchIds(
            user.id,
            user.tenantId,
        );

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

        const permissionNames = await this.getUserPermissionNames(
            user.id,
            user.tenantId,
        );
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
}
