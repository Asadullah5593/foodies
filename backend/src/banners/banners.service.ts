import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Banner } from '../entities/banner.entity';
import { MediaCleanupService } from '../media/media-cleanup.service';

@Injectable()
export class BannersService {
    constructor(
        @InjectRepository(Banner)
        private repo: Repository<Banner>,
        private mediaCleanup: MediaCleanupService,
    ) {}

    async findAll(tenantId: number) {
        const list = await this.repo.find({
            where: { tenantId },
            order: { sortOrder: 'ASC', createdAt: 'DESC' },
        });
        return list.map((b) => this.toResponse(b));
    }

    async findOne(id: number, tenantId: number) {
        const b = await this.repo.findOne({ where: { id, tenantId } });
        if (!b) throw new NotFoundException('Banner not found');
        return this.toResponse(b);
    }

    async create(
        tenantId: number,
        dto: {
            title: string;
            subtitle?: string;
            image_url: string;
            link_url?: string;
            is_active?: boolean;
            sort_order?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        const title = String(dto.title ?? '').trim();
        if (!title) throw new BadRequestException('Title is required');
        const imageUrl = String(dto.image_url ?? '').trim();
        if (!imageUrl) throw new BadRequestException('Image URL is required');

        const banner = await this.repo.save(
            this.repo.create({
                tenantId,
                title,
                subtitle: dto.subtitle?.trim() || null,
                imageUrl,
                linkUrl: dto.link_url?.trim() || null,
                isActive: dto.is_active ?? true,
                sortOrder: dto.sort_order ?? 0,
                validFrom: dto.valid_from ? new Date(dto.valid_from) : null,
                validUntil: dto.valid_until ? new Date(dto.valid_until) : null,
            }),
        );
        return this.toResponse(banner);
    }

    async update(
        id: number,
        tenantId: number,
        dto: {
            title?: string;
            subtitle?: string;
            image_url?: string;
            link_url?: string;
            is_active?: boolean;
            sort_order?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        const b = await this.repo.findOne({ where: { id, tenantId } });
        if (!b) throw new NotFoundException('Banner not found');
        const oldImageUrl = b.imageUrl;

        if (dto.title !== undefined) {
            const t = String(dto.title).trim();
            if (!t) throw new BadRequestException('Title cannot be empty');
            b.title = t;
        }
        if (dto.subtitle !== undefined)
            b.subtitle = dto.subtitle?.trim() || null;
        if (dto.image_url !== undefined) b.imageUrl = dto.image_url.trim();
        if (dto.link_url !== undefined)
            b.linkUrl = dto.link_url?.trim() || null;
        if (dto.is_active !== undefined) b.isActive = dto.is_active;
        if (dto.sort_order !== undefined) b.sortOrder = dto.sort_order;
        if (dto.valid_from !== undefined)
            b.validFrom = dto.valid_from ? new Date(dto.valid_from) : null;
        if (dto.valid_until !== undefined)
            b.validUntil = dto.valid_until ? new Date(dto.valid_until) : null;

        await this.repo.save(b);
        // Replaced image: drop the old object once nothing references it.
        if (oldImageUrl && oldImageUrl !== b.imageUrl) {
            await this.mediaCleanup.deleteIfUnreferenced(
                oldImageUrl,
                'banners',
            );
        }
        return this.toResponse(b);
    }

    async remove(id: number, tenantId: number) {
        const b = await this.repo.findOne({ where: { id, tenantId } });
        if (!b) throw new NotFoundException('Banner not found');
        const imageUrl = b.imageUrl;
        await this.repo.remove(b);
        await this.mediaCleanup.deleteIfUnreferenced(imageUrl, 'banners');
        return { message: 'Banner deleted successfully' };
    }

    /** Consumer API: active banners respecting date window */
    async findActiveForTenant(tenantId: number) {
        const now = new Date();
        const all = await this.repo.find({
            where: { tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'DESC' },
        });
        return all
            .filter(
                (b) =>
                    (b.validFrom == null || b.validFrom <= now) &&
                    (b.validUntil == null || b.validUntil >= now),
            )
            .map((b) => this.toResponse(b));
    }

    private toResponse(b: Banner) {
        return {
            id: b.id,
            tenant_id: b.tenantId,
            title: b.title,
            subtitle: b.subtitle,
            image_url: b.imageUrl,
            link_url: b.linkUrl,
            is_active: b.isActive,
            sort_order: b.sortOrder,
            valid_from: b.validFrom?.toISOString() ?? null,
            valid_until: b.validUntil?.toISOString() ?? null,
            created_at: b.createdAt?.toISOString() ?? null,
            updated_at: b.updatedAt?.toISOString() ?? null,
        };
    }
}
