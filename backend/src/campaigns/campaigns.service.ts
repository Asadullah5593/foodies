import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Campaign } from '../entities/campaign.entity';
import { CampaignItem } from '../entities/campaign-item.entity';
import { Discount } from '../entities/discount.entity';
import { CouponRealization } from '../entities/coupon-realization.entity';
import { Brand } from '../entities/brand.entity';
import {
    ManageScope,
    detachBrands,
    isVisibleToBrands,
    manageScopeFor,
} from '../discounts/offer-brand-scope.util';

function appBaseUrl(): string {
    const raw =
        process.env.CONSUMER_APP_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_DEEP_LINK ||
        'https://app.foodies-pakistan.com/';
    return raw.endsWith('/') ? raw : `${raw}/`;
}

@Injectable()
export class CampaignsService {
    constructor(
        @InjectRepository(Campaign)
        private campaignRepo: Repository<Campaign>,
        @InjectRepository(CampaignItem)
        private itemRepo: Repository<CampaignItem>,
        @InjectRepository(Discount)
        private discountRepo: Repository<Discount>,
        @InjectRepository(CouponRealization)
        private realizationRepo: Repository<CouponRealization>,
        @InjectRepository(Brand)
        private brandRepo: Repository<Brand>,
    ) {}

    // ---- Brand scoping -----------------------------------------------------

    /** Campaigns carry no product scope, so eligibility_brand_ids is the whole story. */
    private scopeOf(c: Campaign): { eligibilityBrandIds: number[] | null } {
        return { eligibilityBrandIds: c.eligibilityBrandIds ?? null };
    }

    private async tenantBrandIds(tenantId: number): Promise<number[]> {
        const brands = await this.brandRepo.find({
            where: { tenantId },
            select: { id: true },
        });
        return brands.map((b) => b.id);
    }

    /** Validate / default eligibility_brand_ids for a brand-locked user. */
    private resolveEligibilityBrandIds(
        requested: unknown,
        allowedBrandIds: number[] | null | undefined,
    ): number[] | null {
        const ids = Array.isArray(requested)
            ? (requested as unknown[]).map(Number).filter(Number.isFinite)
            : null;
        if (allowedBrandIds == null) return ids && ids.length ? ids : null;
        if (!ids || ids.length === 0) return [...allowedBrandIds];
        if (ids.some((id) => !allowedBrandIds.includes(id))) {
            throw new ForbiddenException(
                'You can only create campaigns for your own brand',
            );
        }
        return ids;
    }

    /**
     * A brand-locked user may change a campaign only when every brand it serves is
     * one of theirs; a campaign shared with other brands (or with all brands) is
     * theirs to opt out of, not to rewrite.
     */
    private assertCampaignManageable(
        c: Campaign,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        const scope = manageScopeFor(this.scopeOf(c), allowedBrandIds);
        if (scope === 'full') return;
        throw new ForbiddenException(
            scope === 'detach'
                ? 'This campaign also runs for other brands. Remove your brand from it instead of editing it.'
                : 'You can only manage campaigns that belong to your own brand',
        );
    }

    // ---- Campaigns ---------------------------------------------------------

    async findAll(tenantId: number | null, allowedBrandIds?: number[] | null) {
        if (tenantId == null) return [];
        const list = await this.campaignRepo.find({
            where: { tenantId },
            order: { sortOrder: 'ASC', createdAt: 'DESC' },
        });
        const visible = list.filter((c) =>
            isVisibleToBrands(this.scopeOf(c), allowedBrandIds),
        );
        return Promise.all(
            visible.map((c) =>
                this.campaignResponse(
                    c,
                    manageScopeFor(this.scopeOf(c), allowedBrandIds),
                ),
            ),
        );
    }

    async create(
        tenantId: number,
        dto: {
            name: string;
            description?: string | null;
            image_url?: string | null;
            is_active?: boolean;
            sort_order?: number;
            valid_from?: string | null;
            valid_until?: string | null;
            eligibility_brand_ids?: number[] | null;
        },
        allowedBrandIds?: number[] | null,
    ) {
        const name = String(dto.name ?? '').trim();
        if (!name) throw new BadRequestException('Name is required.');
        const c = await this.campaignRepo.save(
            this.campaignRepo.create({
                tenantId,
                name,
                description: dto.description ?? null,
                imageUrl: dto.image_url ?? null,
                isActive: dto.is_active ?? true,
                sortOrder: dto.sort_order ?? 0,
                validFrom: dto.valid_from ? new Date(dto.valid_from) : null,
                validUntil: dto.valid_until ? new Date(dto.valid_until) : null,
                eligibilityBrandIds: this.resolveEligibilityBrandIds(
                    dto.eligibility_brand_ids,
                    allowedBrandIds,
                ),
            }),
        );
        return this.campaignResponse(c);
    }

    async update(
        id: number,
        tenantId: number,
        dto: Record<string, unknown>,
        allowedBrandIds?: number[] | null,
    ) {
        const c = await this.campaignRepo.findOne({ where: { id, tenantId } });
        if (!c) throw new NotFoundException('Campaign not found');
        this.assertCampaignManageable(c, allowedBrandIds);
        if (dto.name !== undefined) c.name = String(dto.name).trim();
        if (dto.description !== undefined)
            c.description = (dto.description as string | null) ?? null;
        if (dto.image_url !== undefined)
            c.imageUrl = (dto.image_url as string | null) ?? null;
        if (dto.is_active !== undefined) c.isActive = Boolean(dto.is_active);
        if (dto.sort_order !== undefined) c.sortOrder = Number(dto.sort_order);
        if (dto.valid_from !== undefined)
            c.validFrom = dto.valid_from
                ? new Date(dto.valid_from as string)
                : null;
        if (dto.valid_until !== undefined)
            c.validUntil = dto.valid_until
                ? new Date(dto.valid_until as string)
                : null;
        if (dto.eligibility_brand_ids !== undefined)
            c.eligibilityBrandIds = this.resolveEligibilityBrandIds(
                dto.eligibility_brand_ids,
                allowedBrandIds,
            );
        await this.campaignRepo.save(c);
        return this.campaignResponse(c);
    }

    /**
     * Deleting a campaign that also runs for other brands would pull their
     * advertising too, so a brand-locked caller only opts their own brands out.
     */
    async remove(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const c = await this.campaignRepo.findOne({ where: { id, tenantId } });
        if (!c) throw new NotFoundException('Campaign not found');
        const scope = manageScopeFor(this.scopeOf(c), allowedBrandIds);

        if (scope === 'read_only') {
            throw new ForbiddenException(
                'You can only manage campaigns that belong to your own brand',
            );
        }

        if (scope === 'detach' && allowedBrandIds != null) {
            const remaining = detachBrands(
                this.scopeOf(c),
                allowedBrandIds,
                await this.tenantBrandIds(tenantId),
            );
            // Nothing left to serve — drop the row rather than persist [], which
            // would read back as "all brands" and resurrect the campaign everywhere.
            if (remaining.length > 0) {
                c.eligibilityBrandIds = remaining;
                await this.campaignRepo.save(c);
                return {
                    message:
                        'Your brand was removed from this campaign. It keeps running for the other brands it serves.',
                    detached: true,
                    eligibility_brand_ids: remaining,
                };
            }
        }

        await this.campaignRepo.remove(c);
        return { message: 'Campaign deleted' };
    }

    // ---- Items -------------------------------------------------------------

    /**
     * Chokepoint for every item read/write. `requireManage` is set by the write
     * paths so a brand admin cannot edit the items of a campaign that is not
     * theirs — items inherit their campaign's brand scope.
     */
    private async loadCampaign(
        campaignId: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
        requireManage = false,
    ) {
        const c = await this.campaignRepo.findOne({
            where: { id: campaignId, tenantId },
        });
        if (!c) throw new NotFoundException('Campaign not found');
        if (!isVisibleToBrands(this.scopeOf(c), allowedBrandIds)) {
            throw new NotFoundException('Campaign not found');
        }
        if (requireManage) this.assertCampaignManageable(c, allowedBrandIds);
        return c;
    }

    private assertContained(
        campaign: Campaign,
        offer: Discount | null,
        from: Date | null,
        until: Date | null,
    ) {
        const bounds: Array<[Date | null, Date | null]> = [
            [campaign.validFrom ?? null, campaign.validUntil ?? null],
        ];
        if (offer)
            bounds.push([offer.validFrom ?? null, offer.validUntil ?? null]);
        for (const [lo, hi] of bounds) {
            if (lo && from && from < lo)
                throw new BadRequestException(
                    'Item start must be within the campaign/offer window.',
                );
            if (hi && until && until > hi)
                throw new BadRequestException(
                    'Item end must be within the campaign/offer window.',
                );
            if (hi && from && from > hi)
                throw new BadRequestException(
                    'Item start is after the campaign/offer end.',
                );
        }
    }

    async createItem(
        campaignId: number,
        tenantId: number,
        dto: {
            kind: 'offer' | 'deal' | 'info';
            title?: string | null;
            subtitle?: string | null;
            image_url?: string | null;
            sort_order?: number;
            is_active?: boolean;
            valid_from?: string | null;
            valid_until?: string | null;
            offer_id?: number | null;
            deal_menu_item_id?: number | null;
            destination_type?: string | null;
            destination_id?: number | null;
        },
        allowedBrandIds?: number[] | null,
    ) {
        const campaign = await this.loadCampaign(
            campaignId,
            tenantId,
            allowedBrandIds,
            true,
        );
        const kind = dto.kind;
        if (!['offer', 'deal', 'info'].includes(kind))
            throw new BadRequestException('kind must be offer | deal | info');
        let offer: Discount | null = null;
        if (kind === 'offer') {
            if (dto.offer_id == null)
                throw new BadRequestException('offer_id required for kind=offer');
            offer = await this.discountRepo.findOne({
                where: { id: Number(dto.offer_id), tenantId },
            });
            if (!offer) throw new BadRequestException('Offer not found');
        }
        if (kind === 'deal' && dto.deal_menu_item_id == null)
            throw new BadRequestException(
                'deal_menu_item_id required for kind=deal',
            );
        const from = dto.valid_from ? new Date(dto.valid_from) : null;
        const until = dto.valid_until ? new Date(dto.valid_until) : null;
        this.assertContained(campaign, offer, from, until);

        const saved = await this.itemRepo.save(
            this.itemRepo.create({
                campaignId,
                kind,
                title: dto.title ?? null,
                subtitle: dto.subtitle ?? null,
                imageUrl: dto.image_url ?? null,
                sortOrder: dto.sort_order ?? 0,
                isActive: dto.is_active ?? true,
                validFrom: from,
                validUntil: until,
                offerId: kind === 'offer' ? Number(dto.offer_id) : null,
                dealMenuItemId:
                    kind === 'deal' ? Number(dto.deal_menu_item_id) : null,
                destinationType:
                    (dto.destination_type as CampaignItem['destinationType']) ??
                    (kind === 'deal' ? 'deal' : null),
                destinationId: dto.destination_id ?? null,
                deepLinkUrl: null,
            }),
        );
        // Deep link wraps the item id (destination params resolved via the item).
        if (
            saved.destinationType != null &&
            saved.destinationType !== 'none'
        ) {
            saved.deepLinkUrl = `${appBaseUrl()}promo/${saved.id}`;
            await this.itemRepo.save(saved);
        }
        return this.itemResponse(saved);
    }

    async updateItem(
        campaignId: number,
        itemId: number,
        tenantId: number,
        dto: Record<string, unknown>,
        allowedBrandIds?: number[] | null,
    ) {
        const campaign = await this.loadCampaign(
            campaignId,
            tenantId,
            allowedBrandIds,
            true,
        );
        const item = await this.itemRepo.findOne({
            where: { id: itemId, campaignId },
        });
        if (!item) throw new NotFoundException('Item not found');
        if (dto.title !== undefined) item.title = (dto.title as string) ?? null;
        if (dto.subtitle !== undefined)
            item.subtitle = (dto.subtitle as string) ?? null;
        if (dto.image_url !== undefined)
            item.imageUrl = (dto.image_url as string) ?? null;
        if (dto.sort_order !== undefined)
            item.sortOrder = Number(dto.sort_order);
        if (dto.is_active !== undefined)
            item.isActive = Boolean(dto.is_active);
        if (dto.valid_from !== undefined)
            item.validFrom = dto.valid_from
                ? new Date(dto.valid_from as string)
                : null;
        if (dto.valid_until !== undefined)
            item.validUntil = dto.valid_until
                ? new Date(dto.valid_until as string)
                : null;
        if (dto.destination_type !== undefined)
            item.destinationType =
                (dto.destination_type as CampaignItem['destinationType']) ??
                null;
        if (dto.destination_id !== undefined)
            item.destinationId = (dto.destination_id as number) ?? null;
        const offer =
            item.offerId != null
                ? await this.discountRepo.findOne({
                      where: { id: item.offerId, tenantId },
                  })
                : null;
        this.assertContained(campaign, offer, item.validFrom, item.validUntil);
        item.deepLinkUrl =
            item.destinationType != null && item.destinationType !== 'none'
                ? `${appBaseUrl()}promo/${item.id}`
                : null;
        await this.itemRepo.save(item);
        return this.itemResponse(item);
    }

    async removeItem(
        campaignId: number,
        itemId: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        await this.loadCampaign(campaignId, tenantId, allowedBrandIds, true);
        const item = await this.itemRepo.findOne({
            where: { id: itemId, campaignId },
        });
        if (!item) throw new NotFoundException('Item not found');
        await this.itemRepo.remove(item);
        return { message: 'Item deleted' };
    }

    async listItems(
        campaignId: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        await this.loadCampaign(campaignId, tenantId, allowedBrandIds, true);
        const items = await this.itemRepo.find({
            where: { campaignId },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
        return items.map((i) => this.itemResponse(i));
    }

    // ---- Consumer feed -----------------------------------------------------

    /** Active campaigns + their in-window active items, for the mobile app. */
    async feed(tenantId: number, now: Date, limit = 50, offset = 0) {
        const campaigns = await this.campaignRepo.find({
            where: { tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'DESC' },
        });
        const inWindow = (from: Date | null, until: Date | null) =>
            (!from || now >= from) && (!until || now <= until);
        const active = campaigns.filter((c) =>
            inWindow(c.validFrom ?? null, c.validUntil ?? null),
        );
        const ids = active.map((c) => c.id);
        const items = ids.length
            ? await this.itemRepo.find({
                  where: { campaignId: In(ids), isActive: true },
                  order: { sortOrder: 'ASC', id: 'ASC' },
              })
            : [];
        const activeItems = items.filter((i) =>
            inWindow(i.validFrom ?? null, i.validUntil ?? null),
        );
        const byCampaign = new Map<number, CampaignItem[]>();
        for (const i of activeItems) {
            const arr = byCampaign.get(i.campaignId) ?? [];
            arr.push(i);
            byCampaign.set(i.campaignId, arr);
        }
        const out = active
            .map((c) => ({
                id: c.id,
                name: c.name,
                image_url: c.imageUrl,
                items: (byCampaign.get(c.id) ?? []).map((i) =>
                    this.feedItem(i),
                ),
            }))
            .filter((c) => c.items.length > 0);
        return out.slice(offset, offset + limit);
    }

    async feedItemById(id: number, tenantId: number) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) throw new NotFoundException('Not found');
        const campaign = await this.campaignRepo.findOne({
            where: { id: item.campaignId, tenantId },
        });
        if (!campaign) throw new NotFoundException('Not found');
        return this.feedItem(item);
    }

    // ---- Report ------------------------------------------------------------

    /**
     * Requires manage scope, not just visibility: the figures aggregate every brand
     * the campaign serves, so a shared campaign's report is the owner's to read.
     */
    async report(
        campaignId: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        await this.loadCampaign(campaignId, tenantId, allowedBrandIds, true);
        const items = await this.itemRepo.find({ where: { campaignId } });
        const offerIds = items
            .map((i) => i.offerId)
            .filter((x): x is number => x != null);
        if (offerIds.length === 0)
            return {
                redemptions: 0,
                total_value: 0,
                merchant_funded: 0,
                bank_funded: 0,
            };
        const offers = await this.discountRepo.find({
            where: { id: In(offerIds) },
        });
        const fundingById = new Map(
            offers.map((o) => [
                o.id,
                (o as { funding?: string }).funding ?? 'merchant',
            ]),
        );
        const rows = await this.realizationRepo.find({
            where: { offerId: In(offerIds), tenantId },
        });
        const active = rows.filter((r) => r.reversedAt == null);
        let merchant = 0;
        let bank = 0;
        for (const r of active) {
            const amt = Number(r.amount);
            if (fundingById.get(r.offerId) === 'bank') bank += amt;
            else merchant += amt;
        }
        return {
            redemptions: active.length,
            total_value: merchant + bank,
            merchant_funded: merchant,
            bank_funded: bank,
        };
    }

    // ---- Serializers -------------------------------------------------------

    private async campaignResponse(
        c: Campaign,
        manageScope: ManageScope = 'full',
    ) {
        const count = await this.itemRepo.count({
            where: { campaignId: c.id },
        });
        return {
            id: c.id,
            tenant_id: c.tenantId,
            name: c.name,
            description: c.description,
            image_url: c.imageUrl,
            is_active: c.isActive,
            sort_order: c.sortOrder,
            valid_from: c.validFrom?.toISOString() ?? null,
            valid_until: c.validUntil?.toISOString() ?? null,
            eligibility_brand_ids: c.eligibilityBrandIds ?? [],
            /** null = every brand. The admin UI badges from this. */
            effective_brand_ids: c.eligibilityBrandIds ?? null,
            /** 'full' | 'detach' | 'read_only' for the requesting user. */
            manage_scope: manageScope,
            item_count: count,
        };
    }

    private itemResponse(i: CampaignItem) {
        return {
            id: i.id,
            campaign_id: i.campaignId,
            kind: i.kind,
            title: i.title,
            subtitle: i.subtitle,
            image_url: i.imageUrl,
            sort_order: i.sortOrder,
            is_active: i.isActive,
            valid_from: i.validFrom?.toISOString() ?? null,
            valid_until: i.validUntil?.toISOString() ?? null,
            offer_id: i.offerId,
            deal_menu_item_id: i.dealMenuItemId,
            destination_type: i.destinationType,
            destination_id: i.destinationId,
            deep_link_url: i.deepLinkUrl,
        };
    }

    private feedItem(i: CampaignItem) {
        return {
            id: i.id,
            kind: i.kind,
            title: i.title,
            subtitle: i.subtitle,
            image_url: i.imageUrl,
            destination_type: i.destinationType ?? 'none',
            destination_id: i.destinationId,
            deep_link_url: i.deepLinkUrl,
        };
    }
}
