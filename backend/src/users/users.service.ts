import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { TenantUser } from '../entities/tenant-user.entity';
import { BranchUser } from '../entities/branch-user.entity';
import { RolesService } from '../roles/roles.service';

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

    async findAll(tenantId: number) {
        const tenantUsers = await this.tenantUserRepo.find({
            where: { tenantId },
            relations: ['user', 'role'],
            order: { id: 'ASC' },
        });
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
    async findAllForAdmin(tenantId: number | null) {
        if (tenantId != null) return this.findAll(tenantId);
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
    async findOneForAdmin(id: number, tenantId: number | null) {
        if (tenantId != null) return this.findOne(id, tenantId);
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

    async findOne(id: number, tenantId: number) {
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
            relations: ['user', 'user.branchUsers', 'role'],
        });
        if (!tenantUser) throw new NotFoundException('User not found');
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
        },
        tenantId: number,
    ) {
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
        await this.tenantUserRepo.save(
            this.tenantUserRepo.create({
                tenantId,
                userId: user.id,
                roleId,
            }),
        );
        if (roleId != null && dto.branch_ids?.length) {
            for (const branchId of dto.branch_ids) {
                await this.branchUserRepo.save(
                    this.branchUserRepo.create({
                        branchId,
                        userId: user.id,
                        roleId,
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
    ) {
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
            relations: ['user', 'role'],
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        const user = tenantUser.user;
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
        return this.findOne(id, tenantId);
    }

    async remove(id: number, tenantId: number) {
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        await this.tenantUserRepo.remove(tenantUser);
        await this.branchUserRepo.delete({ userId: id });
        await this.repo.delete(id);
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
