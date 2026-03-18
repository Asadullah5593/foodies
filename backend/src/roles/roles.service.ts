import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
} from '@nestjs/common';
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

    /** Create a new permission (Super Admin only). Name must be unique (e.g. "resource:action"). */
    async createPermission(
        dto: {
            name: string;
            resource: string;
            action: string;
            description?: string | null;
        },
    ) {
        const trimmed = (dto.name || '').trim();
        if (!trimmed) throw new ForbiddenException('Permission name is required');
        const existing = await this.permissionRepo.findOne({
            where: { name: trimmed },
        });
        if (existing)
            throw new ConflictException(
                `Permission with name "${trimmed}" already exists`,
            );
        const perm = this.permissionRepo.create({
            name: trimmed,
            resource: (dto.resource || '').trim() || 'other',
            action: (dto.action || '').trim() || 'access',
            description:
                dto.description != null && dto.description !== ''
                    ? dto.description.trim()
                    : null,
        });
        return this.permissionRepo.save(perm);
    }

    /** Update a permission (Super Admin only). */
    async updatePermission(
        id: number,
        dto: {
            name?: string;
            resource?: string;
            action?: string;
            description?: string | null;
        },
    ) {
        const perm = await this.permissionRepo.findOne({ where: { id } });
        if (!perm) throw new NotFoundException('Permission not found');
        if (dto.name !== undefined) {
            const trimmed = dto.name.trim();
            if (!trimmed) throw new ForbiddenException('Permission name is required');
            const existing = await this.permissionRepo.findOne({
                where: { name: trimmed },
            });
            if (existing && existing.id !== id)
                throw new ConflictException(
                    `Permission with name "${trimmed}" already exists`,
                );
            perm.name = trimmed;
        }
        if (dto.resource !== undefined)
            perm.resource = (dto.resource || '').trim() || perm.resource;
        if (dto.action !== undefined)
            perm.action = (dto.action || '').trim() || perm.action;
        if (dto.description !== undefined)
            perm.description =
                dto.description != null && dto.description !== ''
                    ? dto.description.trim()
                    : null;
        return this.permissionRepo.save(perm);
    }

    /** Delete a permission (Super Admin only). Removes it from all roles. */
    async deletePermission(id: number) {
        const perm = await this.permissionRepo.findOne({ where: { id } });
        if (!perm) throw new NotFoundException('Permission not found');
        await this.permissionRepo.remove(perm);
        return { message: 'Permission deleted' };
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
