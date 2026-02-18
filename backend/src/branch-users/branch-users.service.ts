import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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
    ) {}

    private async getDefaultCashierRoleId(): Promise<number> {
        const cashier = await this.roleRepo.findOne({
            where: { slug: 'cashier' },
        });
        if (!cashier)
            throw new NotFoundException('Default role "cashier" not found');
        return cashier.id;
    }

    /** All branch-user assignments for tenant (or all when tenantId is null). Returns flat list with branch_id, branch_name, branch_code. */
    async findAllForAdmin(tenantId: number | null): Promise<
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
        const qb = this.branchRepo
            .createQueryBuilder('b')
            .innerJoinAndSelect('b.branchUsers', 'bu')
            .innerJoinAndSelect('bu.user', 'u')
            .leftJoinAndSelect('bu.role', 'r')
            .orderBy('b.name', 'ASC')
            .addOrderBy('u.name', 'ASC');
        if (tenantId != null) {
            qb.innerJoin('b.branchBrands', 'bb').innerJoin(
                'bb.brand',
                'brand',
                'brand.tenantId = :tenantId',
                { tenantId },
            );
        }
        type BranchWithUsers = Branch & {
            branchUsers: Array<{
                user: User;
                role: Role | null;
                roleId: number;
            }>;
        };
        const branches = (await qb.getMany()) as BranchWithUsers[];
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
        for (const b of branches) {
            const branchUsers = b.branchUsers ?? [];
            for (const bu of branchUsers) {
                const user = bu.user;
                const role = bu.role;
                result.push({
                    branch_id: b.id,
                    branch_name: b.name,
                    branch_code: b.code,
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
        await this.branchUserRepo.delete({ branchId });
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
