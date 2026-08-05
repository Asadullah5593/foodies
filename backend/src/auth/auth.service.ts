import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';
import { expandPermissions } from '../roles/permission-implications';
import { normalizePakistaniPhone } from '../utils/phone';
import { ActivityContext } from '../activity-log/activity-context';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @InjectRepository(User)
        private userRepo: Repository<User>,
        private jwtService: JwtService,
        private dataSource: DataSource,
    ) {}

    async validateUser(
        identifier: { email?: string; phone?: string },
        password: string,
    ) {
        const plain =
            typeof password === 'string' ? String(password).trim() : '';
        if (!plain) return null;

        const emailNorm =
            typeof identifier.email === 'string'
                ? identifier.email.trim().toLowerCase()
                : '';
        const phoneNorm =
            typeof identifier.phone === 'string'
                ? normalizePakistaniPhone(identifier.phone)
                : null;
        if (!emailNorm && !phoneNorm) return null;

        // Raw query: users table has no tenant_id; we get it from tenant_users
        interface UserRow {
            id: number;
            name: string;
            email: string | null;
            phone: string | null;
            status: string;
            password: string;
        }
        const rows = (await this.dataSource.query(
            phoneNorm
                ? `SELECT id, name, email, phone, status, password FROM users WHERE phone = $1`
                : `SELECT id, name, email, phone, status, password FROM users WHERE LOWER(TRIM(email)) = $1`,
            [phoneNorm ?? emailNorm],
        )) as unknown as UserRow[];
        const row: UserRow | undefined = rows[0];

        // Attribute the ATTEMPT, not just the success. A failed login is written
        // by the audit middleware with whatever scope it can see, and it can see
        // none — the request is unauthenticated by definition. Without this, a
        // tenant's own admins could never review failed logins against their own
        // staff, because those rows would carry no tenant_id and be filtered out
        // of every tenant-scoped query. No-op when no request is in flight.
        if (row) {
            ActivityContext.setSubject('user', row.id, row.name);
            const attemptTenant = (await this.dataSource.query(
                'SELECT tenant_id FROM tenant_users WHERE user_id = $1 LIMIT 1',
                [row.id],
            )) as unknown as Array<{ tenant_id: number }>;
            ActivityContext.setScope({
                tenantId: attemptTenant[0]?.tenant_id ?? null,
            });
        }

        if (!row || row.status !== 'active') return null;

        const hash = row.password;
        if (!hash || typeof hash !== 'string') return null;

        // Only ever accept a valid bcrypt hash compared via bcrypt.
        // No plain-text fallback and no demo backdoor: passwords are always
        // hashed at creation (users/customers/tenants services + seeds), and a
        // live-DB audit confirmed 0 non-bcrypt password rows.
        let matches = false;
        try {
            matches = await bcrypt.compare(plain, hash);
        } catch (e) {
            this.logger.warn(`bcrypt.compare error for user id=${row.id}`, e);
            return null;
        }
        if (!matches) return null;

        const tenantRows = (await this.dataSource.query(
            'SELECT tenant_id FROM tenant_users WHERE user_id = $1 LIMIT 1',
            [row.id],
        )) as unknown as { tenant_id: number }[];
        const tenantId = tenantRows[0]?.tenant_id ?? null;
        ActivityContext.setScope({ tenantId });
        const isRider = await this.checkIsRider(row.id);
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            status: row.status,
            tenantId,
            isRider,
        };
    }

    private async checkIsRider(userId: number): Promise<boolean> {
        const rows = (await this.dataSource.query(
            `SELECT 1 FROM tenant_users tu
             INNER JOIN roles r ON r.id = tu.role_id
             WHERE tu.user_id = $1 AND LOWER(r.slug) = 'rider'
             UNION
             SELECT 1 FROM branch_users bu
             INNER JOIN roles r ON r.id = bu.role_id
             WHERE bu.user_id = $1 AND LOWER(r.slug) = 'rider'
             LIMIT 1`,
            [userId],
        )) as unknown as unknown[];
        return Array.isArray(rows) && rows.length > 0;
    }

    /** Owner / super admin — the only roles allowed to manage their own account. */
    private async checkIsOwner(
        userId: number,
        tenantId: number | null,
    ): Promise<boolean> {
        if (tenantId == null) return true; // super admin
        const rows = (await this.dataSource.query(
            `SELECT 1 FROM tenant_users tu
             INNER JOIN roles r ON r.id = tu.role_id
             WHERE tu.user_id = $1 AND tu.tenant_id = $2 AND LOWER(r.slug) IN ('owner', 'super_admin')
             UNION
             SELECT 1 FROM branch_users bu
             INNER JOIN roles r ON r.id = bu.role_id
             WHERE bu.user_id = $1 AND LOWER(r.slug) IN ('owner', 'super_admin')
             LIMIT 1`,
            [userId, tenantId],
        )) as unknown as unknown[];
        return Array.isArray(rows) && rows.length > 0;
    }

    /** Get all permission names for user (from tenant_users role + branch_users roles). Super admin gets all. */
    private async getPermissionsForUser(
        userId: number,
        tenantId: number | null,
    ): Promise<string[]> {
        if (tenantId == null) {
            const rows = (await this.dataSource.query(
                'SELECT name FROM permissions',
            )) as unknown as { name: string }[];
            return rows.map((r) => r.name);
        }
        const roleIdRows = (await this.dataSource.query(
            `SELECT role_id FROM tenant_users WHERE user_id = $1 AND tenant_id = $2
             UNION SELECT role_id FROM branch_users WHERE user_id = $1`,
            [userId, tenantId],
        )) as unknown as { role_id: number }[];
        const roleIds = [...new Set(roleIdRows.map((r) => r.role_id))].filter(
            (id) => id != null,
        );
        if (roleIds.length === 0) return [];
        const placeholders = roleIds.map((_, i) => `$${i + 1}`).join(',');
        const permRows = (await this.dataSource.query(
            `SELECT p.name FROM permissions p
             INNER JOIN role_permissions rp ON rp.permission_id = p.id
             WHERE rp.role_id IN (${placeholders})`,
            roleIds,
        )) as unknown as { name: string }[];
        // Expand umbrella permissions to the granular ones they imply, so the
        // frontend sees (and can gate buttons on) the full effective set.
        return [...expandPermissions(permRows.map((r) => r.name))];
    }

    /**
     * Brand lock for the user: null = all brands; number[] = locked to these
     * brands (every branch_users row carries a brand_id). Mirrors
     * RoleAccessGuard.getAllowedBrandIds so the frontend can adapt its UI.
     */
    /**
     * Order-history window (days) across the user's roles; null = unlimited.
     * Mirrors RoleAccessGuard.getOrderHistoryDays so the frontend can clamp the
     * date pickers to the same window the API enforces.
     */
    private async getOrderHistoryDaysForUser(
        userId: number,
        tenantId: number | null,
    ): Promise<number | null> {
        if (tenantId == null) return null;
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
        )) as unknown as {
            has_unlimited: boolean | null;
            max_days: number | string | null;
        }[];
        const row = rows[0];
        if (!row || row.has_unlimited !== false) return null;
        const maxDays = row.max_days == null ? null : Number(row.max_days);
        return maxDays != null && Number.isFinite(maxDays) && maxDays > 0
            ? maxDays
            : null;
    }

    private async getAllowedBrandIdsForUser(
        userId: number,
        permissions: string[],
    ): Promise<number[] | null> {
        if (permissions.includes('all-branches:access')) return null;
        const rows = (await this.dataSource.query(
            `SELECT brand_id FROM branch_users WHERE user_id = $1`,
            [userId],
        )) as unknown as { brand_id: number | null }[];
        if (rows.length === 0) return null;
        if (rows.some((r) => r.brand_id == null)) return null;
        return [...new Set(rows.map((r) => Number(r.brand_id)))];
    }

    /**
     * Staff login. Office staff sign in with email; riders sign in with their
     * mobile number and password only — the number is the credential the rider
     * app collects, and an email is not guaranteed to be current for them. A
     * rider presenting an email is refused even when the password is right, so
     * there is exactly one rider login path to reason about.
     */
    async login(
        identifier: { email?: string; phone?: string },
        password: string,
    ) {
        const user = await this.validateUser(identifier, password);
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }
        const loggedInWithPhone =
            typeof identifier.phone === 'string' &&
            normalizePakistaniPhone(identifier.phone) != null;
        if (user.isRider && !loggedInWithPhone) {
            throw new UnauthorizedException(
                'Riders sign in with their mobile number and password.',
            );
        }
        const payload = { sub: user.id, email: user.email };
        const token = this.jwtService.sign(payload);
        const permissions = await this.getPermissionsForUser(
            user.id,
            user.tenantId,
        );
        const allowedBrandIds = await this.getAllowedBrandIdsForUser(
            user.id,
            permissions,
        );
        const isOwner = await this.checkIsOwner(user.id, user.tenantId);
        const orderHistoryDays = await this.getOrderHistoryDaysForUser(
            user.id,
            user.tenantId,
        );
        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                status: user.status,
                tenant_id: user.tenantId,
                is_super_admin: user.tenantId == null,
                is_owner: isOwner,
                is_rider: user.isRider === true,
                permissions,
                allowed_brand_ids: allowedBrandIds,
                brand_id:
                    allowedBrandIds?.length === 1 ? allowedBrandIds[0] : null,
                order_history_days: orderHistoryDays,
            },
            token,
        };
    }

    async findById(id: number) {
        const user = await this.userRepo.findOne({
            where: { id },
            relations: ['tenantUsers'],
            select: ['id', 'name', 'email', 'phone', 'status'],
        });
        if (!user) return null;
        const tenantUsers = user.tenantUsers as
            | { tenantId: number }[]
            | undefined;
        const tenantId = tenantUsers?.[0]?.tenantId ?? null;
        const isRider = await this.checkIsRider(user.id);
        const permissions = await this.getPermissionsForUser(user.id, tenantId);
        const allowedBrandIds = await this.getAllowedBrandIdsForUser(
            user.id,
            permissions,
        );
        const isOwner = await this.checkIsOwner(user.id, tenantId);
        const orderHistoryDays = await this.getOrderHistoryDaysForUser(
            user.id,
            tenantId,
        );
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            status: user.status,
            tenant_id: tenantId,
            is_super_admin: tenantId == null,
            is_owner: isOwner,
            is_rider: isRider,
            permissions,
            order_history_days: orderHistoryDays,
            allowed_brand_ids: allowedBrandIds,
            brand_id: allowedBrandIds?.length === 1 ? allowedBrandIds[0] : null,
        };
    }
}
