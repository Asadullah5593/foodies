import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';

@Injectable()
export class RolesService {
    constructor(
        @InjectRepository(Role)
        private roleRepo: Repository<Role>,
        @InjectRepository(Permission)
        private permissionRepo: Repository<Permission>,
    ) {}

    async listPermissions() {
        return this.permissionRepo.find({
            order: { resource: 'ASC', action: 'ASC' },
        });
    }

    async listRoles(tenantId?: number | null) {
        const qb = this.roleRepo
            .createQueryBuilder('r')
            .leftJoinAndSelect('r.permissions', 'p')
            .orderBy('r.name', 'ASC');
        if (tenantId !== undefined && tenantId !== null) {
            qb.andWhere('(r.tenantId IS NULL OR r.tenantId = :tenantId)', {
                tenantId,
            });
        } else {
            qb.andWhere('r.tenantId IS NULL');
        }
        return qb.getMany();
    }

    async getRoleBySlug(slug: string, tenantId?: number | null) {
        const qb = this.roleRepo
            .createQueryBuilder('r')
            .leftJoinAndSelect('r.permissions', 'p')
            .where('r.slug = :slug', { slug });
        if (tenantId !== undefined && tenantId !== null) {
            qb.andWhere('(r.tenantId IS NULL OR r.tenantId = :tenantId)', {
                tenantId,
            });
        } else {
            qb.andWhere('r.tenantId IS NULL');
        }
        const role = await qb.getOne();
        if (!role) throw new NotFoundException(`Role not found: ${slug}`);
        return role;
    }

    async getRoleById(id: number, tenantId: number | null) {
        const qb = this.roleRepo
            .createQueryBuilder('r')
            .leftJoinAndSelect('r.permissions', 'p')
            .where('r.id = :id', { id });
        if (tenantId !== undefined && tenantId !== null) {
            qb.andWhere('(r.tenantId IS NULL OR r.tenantId = :tenantId)', {
                tenantId,
            });
        }
        const role = await qb.getOne();
        if (!role) throw new NotFoundException('Role not found');
        return role;
    }

    async createRole(
        tenantId: number | null,
        dto: { name: string; slug: string; permission_ids?: number[] },
    ) {
        const slug = dto.slug
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const role = this.roleRepo.create({
            tenantId,
            name: dto.name,
            slug: slug || dto.slug,
        });
        if (dto.permission_ids?.length) {
            role.permissions = await this.permissionRepo.findBy({
                id: In(dto.permission_ids),
            });
        } else {
            role.permissions = [];
        }
        const saved = await this.roleRepo.save(role);
        return this.getRoleById(saved.id, tenantId);
    }

    async updateRole(
        id: number,
        tenantId: number | null,
        dto: { name?: string; slug?: string; permission_ids?: number[] },
    ) {
        const role = await this.getRoleById(id, tenantId);
        if (role.slug === 'super_admin') {
            throw new NotFoundException('Super Admin role cannot be edited');
        }
        if (dto.name !== undefined) role.name = dto.name;
        if (dto.slug !== undefined) {
            role.slug = dto.slug
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        }
        if (dto.permission_ids !== undefined) {
            role.permissions = dto.permission_ids.length
                ? await this.permissionRepo.findBy({
                      id: In(dto.permission_ids),
                  })
                : [];
        }
        await this.roleRepo.save(role);
        return this.getRoleById(id, tenantId);
    }

    async removeRole(id: number, tenantId: number | null) {
        const role = await this.getRoleById(id, tenantId);
        if (role.slug === 'super_admin') {
            throw new NotFoundException('Super Admin role cannot be deleted');
        }
        await this.roleRepo.remove(role);
        return { message: 'Role deleted' };
    }
}
