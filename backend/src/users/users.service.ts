import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';
import { TenantUser } from '../entities/tenant-user.entity';
import { BranchUser } from '../entities/branch-user.entity';
import { BRAND_LOCK_SQL } from '../branch-users/brand-lock';
import { RolesService } from '../roles/roles.service';
import { ActivityContext } from '../activity-log/activity-context';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private repo: Repository<User>,
        @InjectRepository(TenantUser)
        private tenantUserRepo: Repository<TenantUser>,
        @InjectRepository(BranchUser)
        private branchUserRepo: Repository<BranchUser>,
        private rolesService: RolesService,
        private dataSource: DataSource,
    ) {}

    /**
     * True when the user is linked to one of the given brands — via a branch
     * assignment (branch_users.brand_id) or the recorded home brand
     * (tenant_users.brand_id, for users created without a branch).
     */
    private async userBelongsToBrands(
        userId: number,
        brandIds: number[],
    ): Promise<boolean> {
        if (brandIds.length === 0) return false;
        const branchRows: unknown = await this.dataSource.query(
            `SELECT 1 AS ok FROM branch_users bu
             WHERE bu.user_id = $1 AND ${BRAND_LOCK_SQL('bu')} && $2::int[]
             LIMIT 1`,
            [userId, brandIds],
        );
        if (Array.isArray(branchRows) && branchRows.length > 0) return true;
        const result: unknown = await this.dataSource.query(
            `SELECT 1 AS ok FROM tenant_users
             WHERE user_id = $1 AND brand_id = ANY($2::int[]) LIMIT 1`,
            [userId, brandIds],
        );
        const rows = result as Array<{ ok: number }>;
        return rows.length > 0;
    }

    /** Owner / super admin — the only roles allowed to manage their own account. */
    private async isOwner(userId: number, tenantId: number): Promise<boolean> {
        const result: unknown = await this.dataSource.query(
            `SELECT 1 AS ok FROM tenant_users tu
             INNER JOIN roles r ON r.id = tu.role_id
             WHERE tu.user_id = $1 AND tu.tenant_id = $2 AND LOWER(r.slug) IN ('owner', 'super_admin')
             UNION
             SELECT 1 AS ok FROM branch_users bu
             INNER JOIN roles r ON r.id = bu.role_id
             WHERE bu.user_id = $1 AND LOWER(r.slug) IN ('owner', 'super_admin')
             LIMIT 1`,
            [userId, tenantId],
        );
        return (result as Array<{ ok: number }>).length > 0;
    }

    /**
     * A non-owner may not modify or delete their own account, even with
     * users-module access. Owners (and super admin) may manage themselves.
     */
    private async assertNotSelfUnlessOwner(
        actingUserId: number | null | undefined,
        targetUserId: number,
        tenantId: number,
        action: 'modify' | 'delete',
    ): Promise<void> {
        if (actingUserId == null || actingUserId !== targetUserId) return;
        if (await this.isOwner(actingUserId, tenantId)) return;
        throw new ForbiddenException(`You cannot ${action} your own account`);
    }

    /** Brand-locked admins may not grant roles that carry tenant-wide access. */
    private async assertRoleAssignableByBrandAdmin(
        roleId: number | null,
    ): Promise<void> {
        if (roleId == null) return;
        const rows = await this.dataSource.query(
            `SELECT 1
             FROM role_permissions rp
             INNER JOIN permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = $1
               AND p.name IN ('all-branches:access', 'roles:manage', 'branches:manage', 'business-settings:access')
             LIMIT 1`,
            [roleId],
        );
        if (rows.length > 0) {
            throw new ForbiddenException(
                'You cannot assign roles with tenant-wide access',
            );
        }
    }

    async findAll(tenantId: number, allowedBrandIds?: number[] | null) {
        const tenantUsers = await this.tenantUserRepo.find({
            where: { tenantId },
            relations: ['user', 'role'],
            order: { id: 'ASC' },
        });
        // Brand-locked admins see staff linked to their brand — either via a
        // branch assignment (branch_users.brand_id) or the recorded home brand
        // (tenant_users.brand_id, set at creation before any branch is given).
        if (allowedBrandIds != null) {
            const rows = (await this.dataSource.query(
                `SELECT DISTINCT bu.user_id FROM branch_users bu
                 WHERE ${BRAND_LOCK_SQL('bu')} && $1::int[]`,
                [allowedBrandIds],
            )) as unknown as Array<{ user_id: number }>;
            const brandUserIds = new Set(rows.map((r) => Number(r.user_id)));
            const allowed = new Set(allowedBrandIds.map((b) => Number(b)));
            const filtered = tenantUsers.filter(
                (tu) =>
                    brandUserIds.has(tu.userId) ||
                    (tu.brandId != null && allowed.has(Number(tu.brandId))),
            );
            return this.mapTenantUsers(filtered, tenantId);
        }
        return this.mapTenantUsers(tenantUsers, tenantId);
    }

    private async mapTenantUsers(tenantUsers: TenantUser[], tenantId: number) {
        const fallbackRoleByUserId = await this.getBranchRoleSlugByUserIds(
            tenantUsers
                .filter((tu) => tu.roleId == null)
                .map((tu) => tu.userId),
            tenantId,
        );
        return tenantUsers.map((tu) => {
            const roleSlug =
                tu.role?.slug ??
                (tu.roleId == null
                    ? (fallbackRoleByUserId.get(tu.userId) ?? null)
                    : null);
            return this.toResponse(
                tu.user,
                tu.tenantId,
                roleSlug ?? undefined,
                tu.roleId ?? undefined,
            );
        });
    }

    /** Super admin (tenantId null): all users with tenant/role; tenant user: same as findAll */
    async findAllForAdmin(
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId != null) return this.findAll(tenantId, allowedBrandIds);
        const tenantUsers = await this.tenantUserRepo.find({
            relations: ['user', 'role', 'tenant'],
            order: { id: 'ASC' },
        });
        const tenantIdsNeedingFallback = [
            ...new Set(
                tenantUsers
                    .filter(
                        (tu): tu is typeof tu & { tenantId: number } =>
                            tu.roleId == null && tu.tenantId != null,
                    )
                    .map((tu) => tu.tenantId),
            ),
        ];
        const fallbackByTenant = new Map<number, Map<number, string>>();
        for (const tid of tenantIdsNeedingFallback) {
            const userIds = [
                ...new Set(
                    tenantUsers
                        .filter((t) => t.tenantId === tid && t.roleId == null)
                        .map((t) => t.userId),
                ),
            ];
            fallbackByTenant.set(
                tid,
                await this.getBranchRoleSlugByUserIds(userIds, tid),
            );
        }
        return tenantUsers.map((tu) => {
            const roleSlug =
                tu.role?.slug ??
                (tu.roleId == null && tu.tenantId != null
                    ? (fallbackByTenant.get(tu.tenantId)?.get(tu.userId) ??
                      null)
                    : null);
            const out = this.toResponse(
                tu.user,
                tu.tenantId,
                roleSlug ?? undefined,
                tu.roleId ?? undefined,
            );
            (out as Record<string, unknown>).tenant_name =
                (tu as TenantUser & { tenant?: { name: string } }).tenant
                    ?.name ?? null;
            return out;
        });
    }

    /** Super admin (tenantId null): can view any user by id; tenant user: own tenant only */
    async findOneForAdmin(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId != null)
            return this.findOne(id, tenantId, allowedBrandIds);
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id },
            relations: ['user', 'user.branchUsers', 'role', 'tenant'],
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        const branchIds =
            tenantUser.user.branchUsers?.map((bu) => bu.branchId) ?? [];
        const roleSlug =
            (tenantUser as TenantUser & { role?: { slug: string } }).role
                ?.slug ??
            (tenantUser.roleId == null && tenantUser.tenantId != null
                ? ((
                      await this.getBranchRoleSlugByUserIds(
                          [tenantUser.userId],
                          tenantUser.tenantId,
                      )
                  ).get(tenantUser.userId) ?? null)
                : null);
        const out = this.toResponse(
            tenantUser.user,
            tenantUser.tenantId,
            roleSlug ?? undefined,
            tenantUser.roleId ?? undefined,
        );
        (out as Record<string, unknown>).branch_ids = branchIds;
        (out as Record<string, unknown>).tenant_name =
            (tenantUser as TenantUser & { tenant?: { name: string } }).tenant
                ?.name ?? null;
        return out;
    }

    async findOne(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
            relations: ['user', 'user.branchUsers', 'role'],
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        if (
            allowedBrandIds != null &&
            !(await this.userBelongsToBrands(id, allowedBrandIds))
        ) {
            throw new NotFoundException('User not found');
        }
        const branchIds =
            tenantUser.user.branchUsers?.map((bu) => bu.branchId) ?? [];
        const roleSlug =
            (tenantUser as TenantUser & { role?: { slug: string } }).role
                ?.slug ??
            (tenantUser.roleId == null
                ? ((
                      await this.getBranchRoleSlugByUserIds(
                          [tenantUser.userId],
                          tenantId,
                      )
                  ).get(tenantUser.userId) ?? null)
                : null);
        const out = this.toResponse(
            tenantUser.user,
            tenantId,
            roleSlug ?? undefined,
            tenantUser.roleId ?? undefined,
        );
        (out as { branch_ids?: number[] }).branch_ids = branchIds;
        return out;
    }

    async create(
        dto: {
            name: string;
            email: string;
            password: string;
            phone?: string;
            branch_ids?: number[];
            role_id?: number;
            role?: string;
            brand_id?: number;
        },
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        // Brand-locked admins create staff for their own brand only: every
        // branch assignment is locked to their brand and privileged roles
        // are rejected.
        let lockedBrandId: number | null = null;
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length !== 1) {
                throw new ForbiddenException(
                    'Your account must be locked to a single brand to create users',
                );
            }
            lockedBrandId = allowedBrandIds[0];
        }
        // Brand to record on the new user. Brand-locked admins always use their
        // own brand; unrestricted admins (owner/GM) may choose one explicitly
        // (validated against the tenant). Omitting it leaves the user brand-less.
        let targetBrandId: number | null = lockedBrandId;
        if (allowedBrandIds == null && dto.brand_id != null) {
            const result: unknown = await this.dataSource.query(
                `SELECT 1 AS ok FROM brands WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
                [dto.brand_id, tenantId],
            );
            const rows = result as Array<{ ok: number }>;
            if (rows.length === 0) {
                throw new BadRequestException(
                    'Selected brand was not found for this tenant',
                );
            }
            targetBrandId = dto.brand_id;
        }
        const email =
            typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
        if (!email) {
            throw new BadRequestException('Email is required');
        }
        const existing = await this.repo.findOne({
            where: { email },
        });
        if (existing) {
            throw new ConflictException(
                'A user with this email already exists. Please use a different email.',
            );
        }
        const hashed = await bcrypt.hash(dto.password, 10);
        let user: User;
        try {
            user = await this.repo.save(
                this.repo.create({
                    name: dto.name,
                    email,
                    password: hashed,
                    phone: dto.phone ?? null,
                    status: 'active',
                }),
            );
        } catch (err) {
            const code =
                (err as { code?: string; driverError?: { code?: string } })
                    ?.code ??
                (err as { driverError?: { code?: string } })?.driverError?.code;
            if (err instanceof QueryFailedError && code === '23505') {
                throw new ConflictException(
                    'A user with this email already exists. Please use a different email.',
                );
            }
            throw err;
        }
        let roleId: number | null = dto.role_id ?? null;
        if (roleId == null && dto.role) {
            const role = await this.rolesService.getRoleBySlug(
                dto.role,
                tenantId,
            );
            roleId = role.id;
        }
        if (lockedBrandId != null) {
            await this.assertRoleAssignableByBrandAdmin(roleId);
        }
        await this.tenantUserRepo.save(
            this.tenantUserRepo.create({
                tenantId,
                userId: user.id,
                roleId: targetBrandId != null ? null : roleId,
                // Record the home brand so the user is linked to a brand (and
                // visible / assignable as a branch user) even before any branch
                // assignment / role is given.
                brandId: targetBrandId,
            }),
        );
        if (roleId != null && dto.branch_ids?.length) {
            for (const branchId of dto.branch_ids) {
                await this.branchUserRepo.save(
                    this.branchUserRepo.create({
                        branchId,
                        userId: user.id,
                        roleId,
                        brandId: targetBrandId,
                    }),
                );
            }
        }
        return this.findOne(user.id, tenantId);
    }

    async update(
        id: number,
        tenantId: number,
        dto: {
            name?: string;
            email?: string;
            password?: string;
            phone?: string;
            status?: string;
            role_id?: number | null;
        },
        allowedBrandIds?: number[] | null,
        actingUserId?: number | null,
    ) {
        await this.assertNotSelfUnlessOwner(
            actingUserId,
            id,
            tenantId,
            'modify',
        );
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
            relations: ['user', 'role'],
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        if (allowedBrandIds != null) {
            if (!(await this.userBelongsToBrands(id, allowedBrandIds))) {
                throw new NotFoundException('User not found');
            }
            if (dto.role_id != null) {
                await this.assertRoleAssignableByBrandAdmin(dto.role_id);
            }
        }
        const user = tenantUser.user;
        // Snapshot before the assignments. `password` is captured only so the
        // diff can say THAT it changed — the redaction layer replaces both
        // sides with [changed], so no hash is ever stored.
        const before = {
            name: user.name,
            email: user.email,
            phone: user.phone,
            status: user.status,
            password: user.password,
            role_id: tenantUser.roleId ?? null,
            role: tenantUser.role?.name ?? null,
        };
        if (dto.password) user.password = await bcrypt.hash(dto.password, 10);
        Object.assign(user, {
            ...(dto.name && { name: dto.name }),
            ...(dto.email && { email: dto.email }),
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(dto.status !== undefined && { status: dto.status }),
        });
        await this.repo.save(user);
        // role_id: undefined = unchanged; null = clear tenant role; number = set tenant role
        if (dto.role_id !== undefined) {
            tenantUser.roleId = dto.role_id;
            await this.tenantUserRepo.save(tenantUser);
        }
        const fresh = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
            relations: ['user', 'role'],
        });
        ActivityContext.recordChange(
            'user',
            id,
            before,
            {
                name: fresh?.user?.name ?? user.name,
                email: fresh?.user?.email ?? user.email,
                phone: fresh?.user?.phone ?? user.phone,
                status: fresh?.user?.status ?? user.status,
                password: user.password,
                role_id: fresh?.roleId ?? null,
                role: fresh?.role?.name ?? null,
            },
            user.name,
        );
        return this.findOne(id, tenantId);
    }

    async remove(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
        actingUserId?: number | null,
    ) {
        await this.assertNotSelfUnlessOwner(
            actingUserId,
            id,
            tenantId,
            'delete',
        );
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        if (
            allowedBrandIds != null &&
            !(await this.userBelongsToBrands(id, allowedBrandIds))
        ) {
            throw new NotFoundException('User not found');
        }
        // All three or none. Unwrapped, these ran as separate statements and a
        // failure on the last one — a rider held by rider_order_ratings, say —
        // left the users row behind with its tenant link already gone. That is
        // not a partial delete, it is an account belonging to no business, and
        // the whole system used to read that as the platform administrator.
        try {
            await this.dataSource.transaction(async (tx) => {
                await tx.delete(BranchUser, { userId: id });
                await tx.delete(TenantUser, { userId: id, tenantId });
                await tx.delete(User, { id });
            });
        } catch (e) {
            // Records that must outlive the person still point at them — a
            // customer's rating of a rider, say. Refusing is right; the caller
            // just needs to be told what to do instead of seeing a 500.
            if (
                e instanceof QueryFailedError &&
                (e as { code?: string }).code === '23503'
            ) {
                throw new ConflictException(
                    'This user has history that cannot be removed (e.g. customer ratings). ' +
                        'Deactivate the account instead — it keeps the records and blocks all access.',
                );
            }
            throw e;
        }
        return { message: 'User deleted successfully' };
    }

    /** Get role slug from branch_users for users in this tenant (for display when tenant_users.roleId is null). */
    private async getBranchRoleSlugByUserIds(
        userIds: number[],
        tenantId: number,
    ): Promise<Map<number, string>> {
        if (userIds.length === 0) return new Map();
        const rows = (await this.dataSource.query(
            `SELECT DISTINCT ON (bu.user_id) bu.user_id, r.slug
             FROM branch_users bu
             INNER JOIN roles r ON r.id = bu.role_id
             INNER JOIN branch_brands bb ON bb.branch_id = bu.branch_id
             INNER JOIN brands b ON b.id = bb.brand_id AND b.tenant_id = $1
             WHERE bu.user_id = ANY($2::int[])
             ORDER BY bu.user_id`,
            [tenantId, userIds],
        )) as unknown as Array<{ user_id: number; slug: string }>;
        return new Map(rows.map((r) => [r.user_id, r.slug]));
    }

    private toResponse(
        u: Partial<User>,
        tenantId?: number,
        roleSlug?: string | null,
        roleId?: number,
    ) {
        return {
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            status: u.status,
            tenant_id: tenantId ?? null,
            role: roleSlug ?? null,
            role_id: roleId ?? null,
            created_at: u.createdAt?.toISOString() ?? null,
            updated_at: u.updatedAt?.toISOString() ?? null,
        };
    }
}
