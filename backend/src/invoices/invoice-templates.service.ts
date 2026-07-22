import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InvoiceTemplate } from '../entities/invoice-template.entity';
import { MediaCleanupService } from '../media/media-cleanup.service';
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
    is_default_kitchen?: boolean;
    config?: unknown;
}

/** Which print a template default applies to. */
export type InvoiceTemplatePurpose = 'customer' | 'kitchen';

const DEFAULT_COLUMN: Record<
    InvoiceTemplatePurpose,
    'isDefault' | 'isDefaultKitchen'
> = {
    customer: 'isDefault',
    kitchen: 'isDefaultKitchen',
};

@Injectable()
export class InvoiceTemplatesService {
    constructor(
        @InjectRepository(InvoiceTemplate)
        private repo: Repository<InvoiceTemplate>,
        private mediaCleanup: MediaCleanupService,
    ) {}

    /** The template's stored FBR-logo URL, if any (config is a partial). */
    private fbrLogoOf(t: InvoiceTemplate): string | null {
        const cfg = (t.config ?? {}) as { fbrLogoUrl?: unknown };
        const v =
            typeof cfg.fbrLogoUrl === 'string' ? cfg.fbrLogoUrl.trim() : '';
        return v || null;
    }

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
            is_default_kitchen: t.isDefaultKitchen,
            config: resolveInvoiceTemplateConfig(t.config),
        };
    }

    async findAll(tenantId: number | null, allowedBrandIds?: number[] | null) {
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
        const isDefaultKitchen = dto.is_default_kitchen ?? false;
        const saved = await this.repo.manager.transaction(async (m) => {
            const r = m.getRepository(InvoiceTemplate);
            if (isDefault)
                await this.clearDefault(r, tenantId, brandId, 'isDefault');
            if (isDefaultKitchen)
                await this.clearDefault(
                    r,
                    tenantId,
                    brandId,
                    'isDefaultKitchen',
                );
            return r.save(
                r.create({
                    tenantId,
                    brandId,
                    name,
                    layout: this.normalizeLayout(dto.layout),
                    isActive: dto.is_active ?? true,
                    isDefault,
                    isDefaultKitchen,
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
        const oldFbrLogoUrl = this.fbrLogoOf(t);
        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name cannot be empty.');
            t.name = name;
        }
        if (dto.layout !== undefined)
            t.layout = this.normalizeLayout(dto.layout);
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
        if (dto.is_default_kitchen === true) t.isDefaultKitchen = true;
        else if (dto.is_default_kitchen === false) t.isDefaultKitchen = false;
        const saved = await this.repo.manager.transaction(async (m) => {
            const r = m.getRepository(InvoiceTemplate);
            // Whenever this row is (or stays) a default, clear any other default
            // in its CURRENT scope — covers both toggling default on and moving an
            // already-default template to a different brand scope (else the partial
            // unique index would 500).
            if (t.isDefault)
                await this.clearDefault(
                    r,
                    tenantId,
                    t.brandId,
                    'isDefault',
                    t.id,
                );
            if (t.isDefaultKitchen)
                await this.clearDefault(
                    r,
                    tenantId,
                    t.brandId,
                    'isDefaultKitchen',
                    t.id,
                );
            return r.save(t);
        });
        // Replaced/cleared FBR logo (uploads land in 'misc'): drop the old
        // object once no other template references it.
        if (oldFbrLogoUrl && oldFbrLogoUrl !== this.fbrLogoOf(saved)) {
            await this.mediaCleanup.deleteIfUnreferenced(oldFbrLogoUrl, 'misc');
        }
        return this.toResponse(saved);
    }

    async remove(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const t = await this.repo.findOne({ where: { id, tenantId } });
        if (!t) throw new NotFoundException('Invoice template not found');
        this.assertManageable(t, allowedBrandIds);
        const fbrLogoUrl = this.fbrLogoOf(t);
        await this.repo.remove(t);
        await this.mediaCleanup.deleteIfUnreferenced(fbrLogoUrl, 'misc');
        return { success: true };
    }

    /** Make one template the default for its scope and purpose, clearing any prior default. */
    async activate(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
        purpose: InvoiceTemplatePurpose = 'customer',
    ) {
        const t = await this.repo.findOne({ where: { id, tenantId } });
        if (!t) throw new NotFoundException('Invoice template not found');
        this.assertManageable(t, allowedBrandIds);
        const column = DEFAULT_COLUMN[purpose];
        const saved = await this.repo.manager.transaction(async (m) => {
            const r = m.getRepository(InvoiceTemplate);
            await this.clearDefault(r, tenantId, t.brandId, column);
            t.isActive = true;
            t[column] = true;
            return r.save(t);
        });
        return this.toResponse(saved);
    }

    /**
     * The active template config for an order: brand default → tenant default →
     * built-in default, per purpose. The kitchen purpose falls back to the
     * customer chain when no kitchen default is set anywhere, so kitchen
     * printing matches the customer invoice until one is chosen. Returns
     * { layout, config } always (never throws) so the invoice always renders.
     */
    async resolveActive(
        tenantId: number | null,
        brandId: number | null,
        allowedBrandIds?: number[] | null,
        purpose: InvoiceTemplatePurpose = 'customer',
    ): Promise<{
        id: number | null;
        layout: InvoiceLayout;
        config: InvoiceTemplateConfig;
    }> {
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
        const findDefault = async (
            column: 'isDefault' | 'isDefaultKitchen',
        ): Promise<InvoiceTemplate | null> => {
            if (brandId != null) {
                const scoped = await this.repo.findOne({
                    where: {
                        tenantId,
                        brandId,
                        [column]: true,
                        isActive: true,
                    },
                });
                if (scoped) return scoped;
            }
            return this.repo.findOne({
                where: {
                    tenantId,
                    brandId: IsNull(),
                    [column]: true,
                    isActive: true,
                },
            });
        };
        let chosen: InvoiceTemplate | null = null;
        if (purpose === 'kitchen')
            chosen = await findDefault('isDefaultKitchen');
        if (!chosen) chosen = await findDefault('isDefault');
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
        column: 'isDefault' | 'isDefaultKitchen',
        exceptId?: number,
    ) {
        const dbColumn =
            column === 'isDefault' ? 'is_default' : 'is_default_kitchen';
        const qb = repo
            .createQueryBuilder()
            .update(InvoiceTemplate)
            .set({ [column]: false })
            .where('tenant_id = :tenantId', { tenantId })
            .andWhere(`${dbColumn} = true`)
            .andWhere(
                brandId == null ? 'brand_id IS NULL' : 'brand_id = :brandId',
                {
                    brandId,
                },
            );
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
