import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Designation } from '../entities/designation.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { DesignationDto } from './dto/hr-support.dto';
import { HrUser } from './employee-scope';

function slugify(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Job titles and the promotion ladder.
 *
 * Tenant-scoped and NOT branch-scoped: a "Cook" means the same thing at every
 * branch, and letting each branch invent its own titles would make the ladder —
 * and therefore promotions — incomparable across the business.
 */
@Injectable()
export class DesignationsService {
    constructor(
        @InjectRepository(Designation)
        private readonly repo: Repository<Designation>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
    ) {}

    async list(user: HrUser, includeInactive = false) {
        const qb = this.repo
            .createQueryBuilder('d')
            .leftJoin('d.defaultRole', 'r')
            .select([
                'd.id',
                'd.name',
                'd.slug',
                'd.level',
                'd.department',
                'd.defaultRoleId',
                'd.isActive',
                'r.name',
            ])
            .orderBy('d.department', 'ASC')
            .addOrderBy('d.level', 'DESC')
            .addOrderBy('d.name', 'ASC');

        if (user.tenantId != null) {
            qb.andWhere('d.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (!includeInactive) qb.andWhere('d.isActive = true');

        const rows = await qb.getMany();

        // One query for the whole list rather than N — the headcount column is
        // the main reason anyone opens this screen.
        const counts = await this.assignments
            .createQueryBuilder('a')
            .select('a.designationId', 'designation_id')
            .addSelect('COUNT(*)', 'count')
            .where('a.effectiveTo IS NULL')
            .groupBy('a.designationId')
            .getRawMany<{ designation_id: number; count: string }>();
        const byId = new Map(
            counts.map((c) => [Number(c.designation_id), Number(c.count)]),
        );

        return rows.map((d) => ({
            id: d.id,
            name: d.name,
            slug: d.slug,
            level: d.level,
            department: d.department,
            default_role_id: d.defaultRoleId,
            default_role_name: d.defaultRole?.name ?? null,
            is_active: d.isActive,
            employee_count: byId.get(d.id) ?? 0,
        }));
    }

    async create(user: HrUser, dto: DesignationDto) {
        const tenantId = this.requireTenant(user);
        const slug = slugify(dto.name);
        if (!slug) throw new BadRequestException('Name must contain letters');

        const clash = await this.repo.findOne({ where: { tenantId, slug } });
        if (clash) {
            throw new ConflictException(
                `A designation named "${dto.name}" already exists`,
            );
        }

        const created = await this.repo.save(
            this.repo.create({
                tenantId,
                name: dto.name.trim(),
                slug,
                level: dto.level ?? 0,
                department: dto.department ?? 'support',
                defaultRoleId: dto.default_role_id ?? null,
                isActive: dto.is_active ?? true,
            }),
        );
        return { id: created.id };
    }

    async update(user: HrUser, id: number, dto: DesignationDto) {
        const designation = await this.loadScoped(user, id);
        const patch: {
            name?: string;
            slug?: string;
            level?: number;
            department?: string;
            defaultRoleId?: number | null;
            isActive?: boolean;
        } = {};

        if (dto.name && dto.name.trim() !== designation.name) {
            const slug = slugify(dto.name);
            const clash = await this.repo.findOne({
                where: { tenantId: designation.tenantId, slug },
            });
            if (clash && clash.id !== id) {
                throw new ConflictException(
                    `A designation named "${dto.name}" already exists`,
                );
            }
            patch.name = dto.name.trim();
            patch.slug = slug;
        }
        if (dto.level !== undefined) patch.level = dto.level;
        if (dto.department !== undefined) patch.department = dto.department;
        if (dto.default_role_id !== undefined)
            patch.defaultRoleId = dto.default_role_id;
        if (dto.is_active !== undefined) patch.isActive = dto.is_active;

        if (Object.keys(patch).length === 0) return { id, updated: false };
        await this.repo.update({ id }, patch);
        return { id, updated: true };
    }

    /**
     * Deactivate rather than delete when anyone holds the title — past
     * assignments reference it, and removing it would break the employment
     * history the module exists to preserve.
     */
    async remove(user: HrUser, id: number) {
        await this.loadScoped(user, id);
        const inUse = await this.assignments.count({
            where: { designationId: id },
        });
        if (inUse > 0) {
            await this.repo.update({ id }, { isActive: false });
            return {
                deleted: false,
                deactivated: true,
                reason: `${inUse} assignment(s) reference this designation, so it was deactivated instead of deleted.`,
            };
        }
        await this.repo.delete({ id });
        return { deleted: true, deactivated: false };
    }

    private async loadScoped(user: HrUser, id: number): Promise<Designation> {
        const designation = await this.repo.findOne({ where: { id } });
        if (!designation) throw new NotFoundException('Designation not found');
        if (user.tenantId != null && designation.tenantId !== user.tenantId) {
            throw new NotFoundException('Designation not found');
        }
        return designation;
    }

    private requireTenant(user: HrUser): number {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant for HR operations',
            );
        }
        return user.tenantId;
    }
}
