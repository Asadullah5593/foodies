import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    ) {}

    async findAll(tenantId: number) {
        const tenantUsers = await this.tenantUserRepo.find({
            where: { tenantId },
            relations: ['user', 'role'],
            order: { id: 'ASC' },
        });
        return tenantUsers.map((tu) =>
            this.toResponse(
                tu.user,
                tu.tenantId,
                tu.role?.slug ?? null,
                tu.roleId,
            ),
        );
    }

    /** Super admin (tenantId null): all users with tenant/role; tenant user: same as findAll */
    async findAllForAdmin(tenantId: number | null) {
        if (tenantId != null) return this.findAll(tenantId);
        const tenantUsers = await this.tenantUserRepo.find({
            relations: ['user', 'role', 'tenant'],
            order: { id: 'ASC' },
        });
        return tenantUsers.map((tu) => {
            const out = this.toResponse(
                tu.user,
                tu.tenantId,
                tu.role?.slug ?? null,
                tu.roleId,
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
        const out = this.toResponse(
            tenantUser.user,
            tenantUser.tenantId,
            (tenantUser as TenantUser & { role?: { slug: string } }).role
                ?.slug ?? null,
            tenantUser.roleId,
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
        const out = this.toResponse(
            tenantUser.user,
            tenantId,
            (tenantUser as TenantUser & { role?: { slug: string } }).role
                ?.slug ?? null,
            tenantUser.roleId,
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
        const hashed = await bcrypt.hash(dto.password, 10);
        const user = await this.repo.save(
            this.repo.create({
                name: dto.name,
                email: dto.email,
                password: hashed,
                phone: dto.phone ?? null,
                status: 'active',
            }),
        );
        let roleId = dto.role_id;
        if (roleId == null && dto.role) {
            const role = await this.rolesService.getRoleBySlug(
                dto.role,
                tenantId,
            );
            roleId = role.id;
        }
        if (roleId == null) roleId = await this.getDefaultRoleId();
        await this.tenantUserRepo.save(
            this.tenantUserRepo.create({
                tenantId,
                userId: user.id,
                roleId,
            }),
        );
        if (dto.branch_ids?.length) {
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
            branch_ids?: number[];
            role_id?: number;
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
        if (dto.role_id !== undefined) {
            tenantUser.roleId = dto.role_id;
            await this.tenantUserRepo.save(tenantUser);
        }
        if (dto.branch_ids !== undefined) {
            await this.branchUserRepo.delete({ userId: id });
            const roleId = tenantUser.roleId;
            for (const branchId of dto.branch_ids) {
                await this.branchUserRepo.save(
                    this.branchUserRepo.create({
                        branchId,
                        userId: id,
                        roleId,
                    }),
                );
            }
        }
        return this.findOne(id, tenantId);
    }

    private async getDefaultRoleId(): Promise<number> {
        const role = await this.rolesService.getRoleBySlug('cashier', null);
        return role.id;
    }

    async remove(id: number, tenantId: number) {
        const tenantUser = await this.tenantUserRepo.findOne({
            where: { userId: id, tenantId },
        });
        if (!tenantUser) throw new NotFoundException('User not found');
        await this.tenantUserRepo.remove(tenantUser);
        await this.branchUserRepo.delete({ userId: id });
        return { message: 'User deleted successfully' };
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
            created_at: (u as User).createdAt?.toISOString() ?? null,
            updated_at: (u as User).updatedAt?.toISOString() ?? null,
        };
    }
}
