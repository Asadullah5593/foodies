import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InvoiceTemplate } from '../entities/invoice-template.entity';
import {
    INVOICE_LAYOUTS,
    InvoiceLayout,
    resolveInvoiceTemplateConfig,
    sanitizeInvoiceTemplateConfig,
    InvoiceTemplateConfig,
} from './invoice-template-config';

export interface InvoiceTemplateDto {
    name?: string;
    layout?: string;
    brand_id?: number | null;
    is_active?: boolean;
    is_default?: boolean;
    config?: unknown;
}

@Injectable()
export class InvoiceTemplatesService {
    constructor(
        @InjectRepository(InvoiceTemplate)
        private repo: Repository<InvoiceTemplate>,
    ) {}

    private assertManageable(
        t: Pick<InvoiceTemplate, 'brandId'>,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        if (allowedBrandIds == null) return; // owner/GM
        if (t.brandId == null || !allowedBrandIds.includes(Number(t.brandId))) {
            throw new ForbiddenException(
                'You can only manage invoice templates for your own brand',
            );
        }
    }

    private normalizeLayout(layout: string | undefined): InvoiceLayout {
        return INVOICE_LAYOUTS.includes(layout as InvoiceLayout)
            ? (layout as InvoiceLayout)
            : 'bill_bordered';
    }

    private toResponse(t: InvoiceTemplate) {
        return {
            id: t.id,
            tenant_id: t.tenantId,
            brand_id: t.brandId ?? null,
            name: t.name,
            layout: t.layout,
            is_active: t.isActive,
            is_default: t.isDefault,
            config: resolveInvoiceTemplateConfig(t.config),
        };
    }

    async findAll(
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId == null) return [];
        const rows = await this.repo.find({
            where: { tenantId },
            order: { createdAt: 'DESC' },
        });
        const visible =
            allowedBrandIds == null
                ? rows
                : rows.filter(
                      (t) =>
                          t.brandId != null &&
                          allowedBrandIds.includes(Number(t.brandId)),
                  );
        return visible.map((t) => this.toResponse(t));
    }

    async findOne(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const t = await this.repo.findOne({ where: { id, tenantId } });
        if (!t) throw new NotFoundException('Invoice template not found');
        // Brand-locked users may only read their own brand's templates (parity
        // with findAll, which hides tenant-wide + other-brand rows from them).
        this.assertManageable(t, allowedBrandIds);
        return this.toResponse(t);
    }

    async create(
        dto: InvoiceTemplateDto,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const name = String(dto.name ?? '').trim();
        if (!name) throw new BadRequestException('Name is required.');
        const brandId = this.resolveBrandId(dto.brand_id, allowedBrandIds);
        const isDefault = dto.is_default ?? false;
        const saved = await this.repo.manager.transaction(async (m) => {
            if (isDefault)
                await this.clearDefault(m.getRepository(InvoiceTemplate), tenantId, brandId);
            return m.getRepository(InvoiceTemplate).save(
                m.getRepository(InvoiceTemplate).create({
                    tenantId,
                    brandId,
                    name,
                    layout: this.normalizeLayout(dto.layout),
                    isActive: dto.is_active ?? true,
                    isDefault,
                    config: sanitizeInvoiceTemplateConfig(dto.config),
                }),
            );
        });
        return this.toResponse(saved);
    }

    async update(
        id: number,
        tenantId: number,
        dto: InvoiceTemplateDto,
        allowedBrandIds?: number[] | null,
    ) {
        const t = await this.repo.findOne({ where: { id, tenantId } });
        if (!t) throw new NotFoundException('Invoice template not found');
        this.assertManageable(t, allowedBrandIds);
        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name cannot be empty.');
            t.name = name;
        }
        if (dto.layout !== undefined) t.layout = this.normalizeLayout(dto.layout);
        if (dto.brand_id !== undefined)
            t.brandId = this.resolveBrandId(dto.brand_id, allowedBrandIds);
        if (dto.is_active !== undefined) t.isActive = dto.is_active;
        if (dto.config !== undefined) {
            // Merge partial config so a PATCH of one toggle keeps the rest.
            t.config = {
                ...(t.config ?? {}),
                ...sanitizeInvoiceTemplateConfig(dto.config),
            };
        }
        if (dto.is_default === true) t.isDefault = true;
        else if (dto.is_default === false) t.isDefault = false;
        const saved = await this.repo.manager.transaction(async (m) => {
            const r = m.getRepository(InvoiceTemplate);
            // Whenever this row is (or stays) the default, clear any other default
            // in its CURRENT scope — covers both toggling default on and moving an
            // already-default template to a different brand scope (else the partial
            // unique index would 500).
            if (t.isDefault) await this.clearDefault(r, tenantId, t.brandId, t.id);
            return r.save(t);
        });
        return this.toResponse(saved);
    }

    async remove(id: number, tenantId: number, allowedBrandIds?: number[] | null) {
        const t = await this.repo.findOne({ where: { id, tenantId } });
        if (!t) throw new NotFoundException('Invoice template not found');
        this.assertManageable(t, allowedBrandIds);
        await this.repo.remove(t);
        return { success: true };
    }

    /** Make one template the default for its scope, clearing any prior default. */
    async activate(id: number, tenantId: number, allowedBrandIds?: number[] | null) {
        const t = await this.repo.findOne({ where: { id, tenantId } });
        if (!t) throw new NotFoundException('Invoice template not found');
        this.assertManageable(t, allowedBrandIds);
        const saved = await this.repo.manager.transaction(async (m) => {
            const r = m.getRepository(InvoiceTemplate);
            await this.clearDefault(r, tenantId, t.brandId);
            t.isActive = true;
            t.isDefault = true;
            return r.save(t);
        });
        return this.toResponse(saved);
    }

    /**
     * The active template config for an order: brand default → tenant default →
     * built-in default. Returns { layout, config } always (never throws) so the
     * invoice always renders.
     */
    async resolveActive(
        tenantId: number | null,
        brandId: number | null,
        allowedBrandIds?: number[] | null,
    ): Promise<{ id: number | null; layout: InvoiceLayout; config: InvoiceTemplateConfig }> {
        // A brand-locked caller may only preview a brand they own.
        if (
            allowedBrandIds != null &&
            brandId != null &&
            !allowedBrandIds.includes(Number(brandId))
        ) {
            throw new ForbiddenException(
                'You can only preview invoice templates for your own brand',
            );
        }
        const fallback = {
            id: null,
            layout: 'bill_bordered' as InvoiceLayout,
            config: resolveInvoiceTemplateConfig(null),
        };
        if (tenantId == null) return fallback;
        let chosen: InvoiceTemplate | null = null;
        if (brandId != null) {
            chosen = await this.repo.findOne({
                where: { tenantId, brandId, isDefault: true, isActive: true },
            });
        }
        if (!chosen) {
            chosen = await this.repo.findOne({
                where: {
                    tenantId,
                    brandId: IsNull(),
                    isDefault: true,
                    isActive: true,
                },
            });
        }
        if (!chosen) return fallback;
        return {
            id: chosen.id,
            layout: this.normalizeLayout(chosen.layout),
            config: resolveInvoiceTemplateConfig(chosen.config),
        };
    }

    private async clearDefault(
        repo: Repository<InvoiceTemplate>,
        tenantId: number,
        brandId: number | null,
        exceptId?: number,
    ) {
        const qb = repo
            .createQueryBuilder()
            .update(InvoiceTemplate)
            .set({ isDefault: false })
            .where('tenant_id = :tenantId', { tenantId })
            .andWhere('is_default = true')
            .andWhere(brandId == null ? 'brand_id IS NULL' : 'brand_id = :brandId', {
                brandId,
            });
        if (exceptId != null) qb.andWhere('id != :exceptId', { exceptId });
        await qb.execute();
    }

    /** A brand-locked user may only create/assign templates for their own brands. */
    private resolveBrandId(
        requested: number | null | undefined,
        allowedBrandIds: number[] | null | undefined,
    ): number | null {
        if (allowedBrandIds == null) {
            return requested == null ? null : Number(requested);
        }
        // Brand-locked: must target one of their brands (never tenant-wide).
        if (requested == null || !allowedBrandIds.includes(Number(requested))) {
            throw new ForbiddenException(
                'You can only create invoice templates for your own brand',
            );
        }
        return Number(requested);
    }
}
