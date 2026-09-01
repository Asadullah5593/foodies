import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import { expandPermissions } from './permission-implications';

@Injectable()
export class RequirePermissionGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private dataSource: DataSource,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Metadata is an array (any-of). Tolerate a legacy single-string value.
        const requiredRaw = this.reflector.get<string | string[]>(
            REQUIRE_PERMISSION_KEY,
            context.getHandler(),
        );
        const required = Array.isArray(requiredRaw)
            ? requiredRaw
            : requiredRaw
              ? [requiredRaw]
              : [];
        if (required.length === 0) return true;

        const request = context.switchToHttp().getRequest<{
            user?: {
                id: number;
                tenantId: number | null;
                isSuperAdmin?: boolean;
            };
        }>();
        const user = request.user;
        if (!user?.id) return false;

        // Platform administrator holds everything. Read off the user row, not
        // inferred from a missing tenant link — an account left tenant-less by
        // a failed delete used to pass this check and every write behind it.
        if (user.isSuperAdmin === true) return true;

        const tenantId = user.tenantId;
        if (tenantId == null) return false;

        type RoleIdRow = { role_id: number };
        const tenantUser = (await this.dataSource.query(
            'SELECT role_id FROM tenant_users WHERE user_id = $1 AND tenant_id = $2 LIMIT 1',
            [user.id, tenantId],
        )) as unknown as RoleIdRow[];
        const branchUsers = (await this.dataSource.query(
            'SELECT role_id FROM branch_users WHERE user_id = $1',
            [user.id],
        )) as unknown as RoleIdRow[];
        const roleIds: number[] = [
            ...(tenantUser[0]?.role_id != null ? [tenantUser[0].role_id] : []),
            ...branchUsers.map((r: RoleIdRow) => r.role_id),
        ].filter((id): id is number => id != null);
        if (roleIds.length === 0)
            throw new ForbiddenException('No role assigned');

        const placeholders = roleIds.map((_, i) => `$${i + 1}`).join(',');
        type PermissionRow = { name: string };
        const rows = (await this.dataSource.query(
            `SELECT p.name FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id IN (${placeholders})`,
            roleIds,
        )) as unknown as PermissionRow[];
        const permissionNames = expandPermissions(
            rows.map((r: PermissionRow) => r.name),
        );
        if (!required.some((p) => permissionNames.has(p))) {
            throw new ForbiddenException(
                `Permission required: one of ${required.join(', ')}`,
            );
        }
        return true;
    }
}
