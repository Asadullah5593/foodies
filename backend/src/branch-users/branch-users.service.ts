import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { User } from '../entities/user.entity';
import { BranchUser } from '../entities/branch-user.entity';
import { Role } from '../entities/role.entity';
import { normalizePakistaniPhone } from '../utils/phone';

@Injectable()
export class BranchUsersService {
    constructor(
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
        @InjectRepository(User) private userRepo: Repository<User>,
        @InjectRepository(BranchUser)
        private branchUserRepo: Repository<BranchUser>,
        @InjectRepository(Role) private roleRepo: Repository<Role>,
        private dataSource: DataSource,
    ) {}

    /**
     * Brand-locked admins may only assign roles that do not grant
     * tenant-wide access (e.g. cannot promote someone to owner / GM).
     */
    private async assertRolesAssignableByBrandAdmin(
        roleIds: number[],
    ): Promise<void> {
        if (roleIds.length === 0) return;
        const rows = await this.dataSource.query(
            `SELECT DISTINCT rp.role_id
             FROM role_permissions rp
             INNER JOIN permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = ANY($1::int[])
               AND p.name IN ('all-branches:access', 'roles:manage', 'branches:manage', 'business-settings:access')`,
            [roleIds],
        );
        if (rows.length > 0) {
            throw new ForbiddenException(
                'You cannot assign roles with tenant-wide access',
            );
        }
    }

    /**
     * When a rider-role assignment carries a brand_id, that brand "owns" the
     * rider: ensure an 'owned' rider_brands link exists (the single source of
     * truth for rider↔brand availability). Brand-locked assignments always
     * carry a brand_id; owner/GM assignments with null brand_id create no link
     * (the rider stays a Foodies-pool rider). Idempotent.
     */
    private async syncOwnedRiderLinks(
        assignments: Array<{
            userId: number;
            roleId: number;
            brandId: number | null;
        }>,
        actingUserId?: number | null,
    ): Promise<void> {
        const branded = assignments.filter((a) => a.brandId != null);
        if (branded.length === 0) return;
        const roleIds = [...new Set(branded.map((a) => a.roleId))];
        const roleResult: unknown = await this.dataSource.query(
            `SELECT id FROM roles WHERE slug = 'rider' AND id = ANY($1::int[])`,
            [roleIds],
        );
        const riderRoleRows = roleResult as Array<{ id: number }>;
        const riderRoleIds = new Set(riderRoleRows.map((r) => Number(r.id)));
        for (const a of branded) {
            if (!riderRoleIds.has(Number(a.roleId))) continue;
            await this.dataSource.query(
                `INSERT INTO rider_brands (rider_user_id, brand_id, tenant_id, source, created_by, created_at)
                 SELECT $1, $2, br.tenant_id, 'owned', $3, now()
                 FROM brands br WHERE br.id = $2
                 ON CONFLICT (rider_user_id, brand_id) DO NOTHING`,
                [a.userId, a.brandId, actingUserId ?? null],
            );
        }
    }

    /** The role ids in `roleIds` that are the rider role. */
    private async riderRoleIdsAmong(roleIds: number[]): Promise<Set<number>> {
        if (roleIds.length === 0) return new Set();
        const rows: Array<{ id: number }> = await this.dataSource.query(
            `SELECT id FROM roles WHERE slug = 'rider' AND id = ANY($1::int[])`,
            [roleIds],
        );
        return new Set(rows.map((r) => Number(r.id)));
    }

    /**
     * A phone is optional on a user until they are made a rider, at which point
     * it becomes their LOGIN CREDENTIAL — riders sign in to the rider app with
     * mobile number + password, not email. Assigning the rider role is therefore
     * the point that demands one: take the number supplied with the assignment,
     * else the one already on file, and refuse the assignment if there is
     * neither. A supplied number is written back to the user, so the assignment
     * screen doubles as the place to correct a stale one.
     *
     * Because it is a credential it must be a valid Pakistani mobile, stored in
     * the canonical 03XXXXXXXXX form, and unique across users — otherwise a
     * login could not resolve to one account.
     */
    private async requireRiderPhones(
        assignments: Array<{
            userId: number;
            roleId: number;
            phone?: string | null;
        }>,
    ): Promise<void> {
        const riderRoleIds = await this.riderRoleIdsAmong([
            ...new Set(assignments.map((a) => a.roleId)),
        ]);
        const riders = assignments.filter((a) =>
            riderRoleIds.has(Number(a.roleId)),
        );
        if (riders.length === 0) return;
        const users = await this.userRepo.find({
            where: { id: In(riders.map((r) => r.userId)) },
        });
        const byId = new Map(users.map((u) => [u.id, u]));
        // Check every rider before writing any of them, so a batch that fails
        // leaves no half-applied phone behind.
        const pending: Array<[number, string]> = [];
        for (const rider of riders) {
            const user = byId.get(rider.userId);
            if (!user)
                throw new NotFoundException(`User ${rider.userId} not found`);
            const supplied = (rider.phone ?? '').trim();
            const onFile = (user.phone ?? '').trim();
            if (!supplied && !onFile) {
                throw new BadRequestException(
                    `A phone number is required to make ${user.name} a rider — it is how they sign in to the rider app`,
                );
            }
            const normalized = normalizePakistaniPhone(supplied || onFile);
            if (!normalized) {
                throw new BadRequestException(
                    `${user.name}'s phone number is not a valid Pakistani mobile. Use format 03XXXXXXXXX`,
                );
            }
            // The number is a credential, so it has to identify one account.
            const clash = await this.userRepo.findOne({
                where: { phone: normalized },
            });
            if (clash && clash.id !== user.id) {
                throw new BadRequestException(
                    `${normalized} is already used by ${clash.name}. A rider's number must be unique — it is their login.`,
                );
            }
            if (normalized !== user.phone) pending.push([user.id, normalized]);
        }
        for (const [userId, phone] of pending) {
            await this.userRepo.update(userId, { phone });
        }
    }

    private async getDefaultCashierRoleId(): Promise<number> {
        const cashier = await this.roleRepo.findOne({
            where: { slug: 'cashier' },
        });
        if (!cashier)
            throw new NotFoundException('Default role "cashier" not found');
        return cashier.id;
    }

    /** All branch-user assignments for tenant (or all when tenantId is null). When allowedBranchIds is set, only those branches. */
    async findAllForAdmin(
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ): Promise<
        Array<{
            branch_id: number;
            branch_name: string;
            branch_code: string;
            id: number;
            name: string;
            email: string | null;
            phone: string | null;
            status: string;
            role_id: number;
            role_name?: string;
            role_slug?: string;
            brand_id: number | null;
            brand_name?: string | null;
        }>
    > {
        let branchIds: number[] | null = null;
        if (allowedBranchIds != null && Array.isArray(allowedBranchIds)) {
            branchIds = allowedBranchIds;
            if (branchIds.length === 0) return [];
        } else if (tenantId != null) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- query returns unknown
            const rows = (await this.dataSource.query(
                `SELECT DISTINCT bb.branch_id
                 FROM branch_brands bb
                 INNER JOIN brands br ON br.id = bb.brand_id
                 WHERE br.tenant_id = $1`,
                [tenantId],
            )) as { branch_id: number }[];
            branchIds = rows.map((r) => Number(r.branch_id));
            if (branchIds.length === 0) return [];
        }

        const branchIdSet = branchIds != null ? new Set(branchIds) : null;
        const qb = this.branchUserRepo
            .createQueryBuilder('bu')
            .innerJoinAndSelect('bu.branch', 'b')
            .innerJoinAndSelect('bu.user', 'u')
            .leftJoinAndSelect('bu.role', 'r')
            .leftJoinAndSelect('bu.brand', 'brand')
            .orderBy('b.name', 'ASC')
            .addOrderBy('u.name', 'ASC');
        if (branchIds != null && branchIds.length > 0) {
            qb.andWhere('bu.branchId IN (:...branchIds)', { branchIds });
        }
        // Brand-locked admins manage only their own brand's staff.
        if (allowedBrandIds != null) {
            qb.andWhere('bu.brandId IN (:...allowedBrandIds)', {
                allowedBrandIds,
            });
        }
        const list = await qb.getMany();
        const filteredList =
            branchIdSet == null
                ? list
                : list.filter((bu) => branchIdSet.has(bu.branchId));
        const result: Array<{
            branch_id: number;
            branch_name: string;
            branch_code: string;
            id: number;
            name: string;
            email: string | null;
            phone: string | null;
            status: string;
            role_id: number;
            role_name?: string;
            role_slug?: string;
            brand_id: number | null;
            brand_name?: string | null;
        }> = [];
        for (const bu of filteredList) {
            const branch = (bu as BranchUser & { branch: Branch }).branch;
            const user = (bu as BranchUser & { user: User }).user;
            const role = (bu as BranchUser & { role?: Role | null }).role;
            const brand = (
                bu as BranchUser & { brand?: { name: string } | null }
            ).brand;
            result.push({
                branch_id: branch.id,
                branch_name: branch.name,
                branch_code: branch.code,
                id: user.id,
                name: user.name,
                email: user.email ?? null,
                phone: user.phone ?? null,
                status: user.status,
                role_id: bu.roleId,
                role_name: role?.name,
                role_slug: role?.slug,
                brand_id: bu.brandId ?? null,
                brand_name: brand?.name ?? null,
            });
        }
        return result;
    }

    async getUsers(branchId: number, allowedBrandIds?: number[] | null) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            relations: [
                'branchUsers',
                'branchUsers.user',
                'branchUsers.role',
                'branchUsers.brand',
            ],
        });
        if (!branch) throw new NotFoundException('Branch not found');
        const assignments = (branch.branchUsers || []).filter(
            (bu) =>
                allowedBrandIds == null ||
                (bu.brandId != null && allowedBrandIds.includes(bu.brandId)),
        );
        return assignments.map((bu) => ({
            id: bu.user.id,
            name: bu.user.name,
            email: bu.user.email,
            phone: bu.user.phone,
            status: bu.user.status,
            role_id: bu.roleId,
            role_name: (
                bu as BranchUser & { role?: { name: string; slug: string } }
            ).role?.name,
            role_slug: (
                bu as BranchUser & { role?: { name: string; slug: string } }
            ).role?.slug,
            brand_id: bu.brandId ?? null,
            brand_name:
                (bu as BranchUser & { brand?: { name: string } | null }).brand
                    ?.name ?? null,
        }));
    }

    async assignUsers(
        branchId: number,
        userIds: number[],
        roleId?: number,
        allowedBrandIds?: number[] | null,
    ) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');
        const resolvedRoleId = roleId ?? (await this.getDefaultCashierRoleId());
        // Brand-locked admins replace only their own brand's assignments
        // (and every row they create is locked to their brand).
        let lockedBrandId: number | null = null;
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length !== 1) {
                throw new ForbiddenException(
                    'Use per-user assignments with an explicit brand',
                );
            }
            lockedBrandId = allowedBrandIds[0];
            await this.assertRolesAssignableByBrandAdmin([resolvedRoleId]);
            await this.branchUserRepo.delete({
                branchId,
                brandId: lockedBrandId,
            });
        } else {
            await this.branchUserRepo.delete({ branchId });
        }
        const users = await this.userRepo.find({ where: { id: In(userIds) } });
        await this.requireRiderPhones(
            users.map((u) => ({ userId: u.id, roleId: resolvedRoleId })),
        );
        for (const u of users) {
            await this.branchUserRepo.save(
                this.branchUserRepo.create({
                    branchId,
                    userId: u.id,
                    roleId: resolvedRoleId,
                    brandId: lockedBrandId,
                }),
            );
        }
        await this.syncOwnedRiderLinks(
            users.map((u) => ({
                userId: u.id,
                roleId: resolvedRoleId,
                brandId: lockedBrandId,
            })),
        );
        return {
            message: 'Users assigned successfully',
            users: users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
            })),
        };
    }

    async assignUsersWithRoles(
        branchId: number,
        assignments: {
            user_id: number;
            role_id: number;
            /** Lock this user to a single brand at the branch (null/omitted = all brands). */
            brand_id?: number | null;
            /** Required when role_id is the rider role and the user has no phone on file; saved to the user. */
            phone?: string | null;
        }[],
        allowedBrandIds?: number[] | null,
    ) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');
        // Brand-locked admins assign only within their own brand. The brand
        // selector is hidden for them, so an omitted brand defaults to their
        // brand; only an explicit *different* brand is rejected.
        let lockedBrandId: number | null = null;
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length !== 1) {
                throw new ForbiddenException(
                    'Your account must be locked to a single brand to assign users',
                );
            }
            lockedBrandId = allowedBrandIds[0];
            for (const a of assignments) {
                if (
                    a.brand_id != null &&
                    Number(a.brand_id) !== lockedBrandId
                ) {
                    throw new ForbiddenException(
                        'You can only assign users to your own brand',
                    );
                }
            }
            await this.assertRolesAssignableByBrandAdmin([
                ...new Set(assignments.map((a) => a.role_id)),
            ]);
        }
        await this.requireRiderPhones(
            assignments.map((a) => ({
                userId: a.user_id,
                roleId: a.role_id,
                phone: a.phone,
            })),
        );
        const resolveBrandId = (
            brandId: number | null | undefined,
        ): number | null =>
            lockedBrandId != null ? lockedBrandId : (brandId ?? null);
        for (const { user_id, role_id, brand_id } of assignments) {
            await this.branchUserRepo.save(
                this.branchUserRepo.create({
                    branchId,
                    userId: user_id,
                    roleId: role_id,
                    brandId: resolveBrandId(brand_id),
                }),
            );
        }
        await this.syncOwnedRiderLinks(
            assignments.map((a) => ({
                userId: a.user_id,
                roleId: a.role_id,
                brandId: resolveBrandId(a.brand_id),
            })),
        );
        const users = await this.userRepo.find({
            where: { id: In(assignments.map((a) => a.user_id)) },
        });
        return {
            message: 'Users assigned successfully',
            users: users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
            })),
        };
    }

    async removeUser(
        branchId: number,
        userId: number,
        allowedBrandIds?: number[] | null,
    ) {
        if (allowedBrandIds != null) {
            // Brand-locked admins can only detach their own brand's rows.
            await this.branchUserRepo.delete({
                branchId,
                userId,
                brandId: In(allowedBrandIds),
            });
        } else {
            await this.branchUserRepo.delete({ branchId, userId });
        }
        return { message: 'User removed from branch successfully' };
    }

    async bulkAssignUserToBranches(
        dto: {
            user_id: number;
            branch_ids: number[];
            role_id: number;
            brand_id?: number | null;
            phone?: string | null;
        },
        allowedBrandIds?: number[] | null,
    ): Promise<{ message: string; assigned_count: number }> {
        if (!dto.branch_ids?.length) {
            throw new BadRequestException(
                'At least one branch must be selected',
            );
        }
        const assignment = {
            user_id: dto.user_id,
            role_id: dto.role_id,
            brand_id: dto.brand_id ?? null,
            phone: dto.phone ?? null,
        };
        for (const branchId of dto.branch_ids) {
            await this.assignUsersWithRoles(
                branchId,
                [assignment],
                allowedBrandIds,
            );
        }
        return {
            message: `User assigned to ${dto.branch_ids.length} branch(es)`,
            assigned_count: dto.branch_ids.length,
        };
    }
}
