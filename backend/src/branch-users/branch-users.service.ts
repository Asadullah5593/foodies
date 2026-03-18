import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { User } from '../entities/user.entity';
import { BranchUser } from '../entities/branch-user.entity';
import { Role } from '../entities/role.entity';

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
            .orderBy('b.name', 'ASC')
            .addOrderBy('u.name', 'ASC');
        if (branchIds != null && branchIds.length > 0) {
            qb.andWhere('bu.branchId IN (:...branchIds)', { branchIds });
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
        }> = [];
        for (const bu of filteredList) {
            const branch = (bu as BranchUser & { branch: Branch }).branch;
            const user = (bu as BranchUser & { user: User }).user;
            const role = (bu as BranchUser & { role?: Role | null }).role;
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
            });
        }
        return result;
    }

    async getUsers(branchId: number) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchUsers', 'branchUsers.user', 'branchUsers.role'],
        });
        if (!branch) throw new NotFoundException('Branch not found');
        return (branch.branchUsers || []).map((bu) => ({
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
        }));
    }

    async assignUsers(branchId: number, userIds: number[], roleId?: number) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');
        const resolvedRoleId = roleId ?? (await this.getDefaultCashierRoleId());
        await this.branchUserRepo.delete({ branchId });
        const users = await this.userRepo.find({ where: { id: In(userIds) } });
        for (const u of users) {
            await this.branchUserRepo.save(
                this.branchUserRepo.create({
                    branchId,
                    userId: u.id,
                    roleId: resolvedRoleId,
                }),
            );
        }
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
        assignments: { user_id: number; role_id: number }[],
    ) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
        });
        if (!branch) throw new NotFoundException('Branch not found');
        for (const { user_id, role_id } of assignments) {
            await this.branchUserRepo.save(
                this.branchUserRepo.create({
                    branchId,
                    userId: user_id,
                    roleId: role_id,
                }),
            );
        }
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

    async removeUser(branchId: number, userId: number) {
        await this.branchUserRepo.delete({ branchId, userId });
        return { message: 'User removed from branch successfully' };
    }
}
