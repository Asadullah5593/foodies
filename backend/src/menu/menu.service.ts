import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Brand } from '../entities/brand.entity';
import { Branch } from '../entities/branch.entity';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { DealComponent } from '../entities/deal-component.entity';
import { MenuAddon } from '../entities/menu-addon.entity';
import { MenuCategory } from '../entities/menu-category.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { Discount } from '../entities/discount.entity';
import {
    previewItemOffers,
    PreviewOffer,
    OfferChannel,
} from '../discounts/offer-preview.util';
import { MenuVariant } from '../entities/menu-variant.entity';
import { ModifierGroup } from '../entities/modifier-group.entity';
import { Modifier } from '../entities/modifier.entity';
import { MenuItemModifierGroupPosition } from '../entities/menu-item-modifier-group-position.entity';
import { MediaStorageService } from '../media/media-storage.service';
import {
    effectiveMenuOrderChannels,
    isMenuItemAvailableForOrderType,
    parseMenuOrderChannelsInput,
} from '../utils/menu-order-type';
import {
    normalizePriceBySize,
    normalizeIncludedBySize,
    normalizePriceTiers,
} from './modifier-pricing';
import { restrictDealChoiceItemsForConsumer } from './deal-consumer-shaping';
import { getBranchClock, isWithinSchedule } from '../utils/branch-schedule';

const MENU_ITEM_GALLERY_MAX = 12;

/** Dedupe, trim, cap length; null means store no gallery in DB. */
function normalizeGalleryImageUrls(input: unknown): string[] | null {
    if (input == null) return null;
    const raw = Array.isArray(input) ? input : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
        if (typeof x !== 'string') continue;
        const u = x.trim();
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push(u);
        if (out.length >= MENU_ITEM_GALLERY_MAX) break;
    }
    return out.length ? out : null;
}

function galleryUrlsForApi(item: MenuItem): string[] {
    const n = normalizeGalleryImageUrls(item.galleryImageUrls);
    return n ?? [];
}

/** Trim a variant size key; empty/whitespace becomes null (no size semantics). */
function normalizeSizeKey(input: string | null | undefined): string | null {
    if (input == null) return null;
    const s = String(input).trim();
    return s ? s.slice(0, 32) : null;
}

/** Trim a short label/tag (max 40 chars); empty becomes null. */
function normalizeText40(input: string | null | undefined): string | null {
    if (input == null) return null;
    const s = String(input).trim();
    return s ? s.slice(0, 40) : null;
}

/** Dedupe + trim size keys (e.g. ["7","10"]); empty array becomes null. */
function normalizeSizeList(input: unknown): string[] | null {
    if (!Array.isArray(input)) return null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of input) {
        const s = String(x ?? '').trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s.slice(0, 32));
    }
    return out.length ? out : null;
}

/** Dedupe + trim allergen labels; empty array becomes null. */
function normalizeAllergens(input: unknown): string[] | null {
    if (!Array.isArray(input)) return null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of input) {
        if (typeof x !== 'string') continue;
        const s = x.trim();
        if (!s || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        out.push(s);
    }
    return out.length ? out : null;
}

/** Validate a non-negative integer calorie value; anything invalid becomes null. */
function normalizeCalories(input: unknown): number | null {
    if (input == null || input === '') return null;
    const n = Math.floor(Number(input));
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Accept 'HH:mm' or 'HH:mm:ss' (Postgres time); empty/invalid becomes null. */
function normalizeTimeOfDay(input: string | null | undefined): string | null {
    if (input == null) return null;
    const s = String(input).trim();
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s) ? s : null;
}

/** Days of week as ints 0-6 (0=Sun); dedupe + sort; empty/invalid becomes null. */
function normalizeDaysOfWeek(input: unknown): number[] | null {
    if (!Array.isArray(input)) return null;
    const set = new Set<number>();
    for (const x of input) {
        const n = Math.floor(Number(x));
        if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
    }
    return set.size ? [...set].sort((a, b) => a - b) : null;
}

/** Per-slot pricing/constraint metadata used by the order pipeline to price + validate deals. */
export type DealSlotMeta = {
    type: 'fixed' | 'choice_category' | 'choice_list';
    /** Units this slot holds (e.g. "choose 2 sides" = 2). */
    quantity: number;
    /** Optional slot: 0..quantity units are valid; required slots need exactly `quantity`. */
    optional: boolean;
    sourceMenuItemId: number | null;
    sourceCategoryId: number | null;
    sourceMenuItemIds: number[] | null;
    slotSizeKey: string | null;
    allowedSizeKeys: string[] | null;
    mirrorSlotIndex: number | null;
    mirrorMatchSize: boolean;
    mirrorMatchCategory: boolean;
};

/** Metadata + scheduling fields shared by every menu-item API response. */
function itemMetaForApi(i: {
    allergens?: string[] | null;
    calories?: number | null;
    label?: string | null;
    availableTimeStart?: string | null;
    availableTimeEnd?: string | null;
    availableDaysOfWeek?: number[] | null;
    dealPricingMode?: string | null;
    dealBogoGetPercent?: number | null;
}) {
    return {
        allergens: i.allergens ?? null,
        calories: i.calories ?? null,
        label: i.label ?? null,
        available_time_start: i.availableTimeStart ?? null,
        available_time_end: i.availableTimeEnd ?? null,
        available_days_of_week: i.availableDaysOfWeek ?? null,
        // Deal-root pricing mode so clients can recompute a dynamic (BOGO) deal's total.
        deal_pricing_mode: i.dealPricingMode ?? null,
        bogo_get_percent:
            i.dealBogoGetPercent != null ? Number(i.dealBogoGetPercent) : null,
    };
}

@Injectable()
export class MenuService {
    constructor(
        @InjectRepository(MenuCategory)
        private categoryRepo: Repository<MenuCategory>,
        @InjectRepository(MenuItem) private itemRepo: Repository<MenuItem>,
        @InjectRepository(MenuAddon) private addonRepo: Repository<MenuAddon>,
        @InjectRepository(MenuVariant)
        private variantRepo: Repository<MenuVariant>,
        @InjectRepository(Brand) private brandRepo: Repository<Brand>,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
        @InjectRepository(BranchMenuItem)
        private branchMenuItemRepo: Repository<BranchMenuItem>,
        @InjectRepository(DealComponent)
        private dealComponentRepo: Repository<DealComponent>,
        @InjectRepository(ModifierGroup)
        private modifierGroupRepo: Repository<ModifierGroup>,
        @InjectRepository(Modifier) private modifierRepo: Repository<Modifier>,
        @InjectRepository(MenuItemModifierGroupPosition)
        private positionRepo: Repository<MenuItemModifierGroupPosition>,
        @InjectRepository(Discount)
        private discountRepo: Repository<Discount>,
        private mediaStorage: MediaStorageService,
    ) {}

    /** Load active auto offers (product_promotion + discount) usable for the menu price preview. */
    private async loadPreviewOffers(
        tenantId: number | null,
    ): Promise<PreviewOffer[]> {
        if (tenantId == null) return [];
        const rows = await this.discountRepo.find({
            where: { tenantId, isActive: true, requiresCode: false },
        });
        return rows
            .filter((d) => {
                const k = (d as { offerKind?: string }).offerKind ?? 'discount';
                return k === 'discount' || k === 'product_promotion';
            })
            .map((d) => ({
                name: d.name,
                offerKind:
                    (d as { offerKind?: string }).offerKind ?? 'discount',
                type: d.type,
                value: Number(d.value),
                minOrderAmount:
                    d.minOrderAmount != null ? Number(d.minOrderAmount) : null,
                maxDiscountAmount:
                    d.maxDiscountAmount != null
                        ? Number(d.maxDiscountAmount)
                        : null,
                applicationScope: d.applicationScope ?? 'whole_order',
                applicationScopeIds: d.applicationScopeIds ?? null,
                eligibilityBranchIds: d.eligibilityBranchIds ?? null,
                eligibilityBrandIds: d.eligibilityBrandIds ?? null,
                audience: (d as { audience?: string | null }).audience ?? null,
                requiresCard: d.requiresCard ?? false,
                posOnly: d.posOnly ?? false,
                channels: d.channels ?? null,
                validFrom: d.validFrom ?? null,
                validUntil: d.validUntil ?? null,
                validTimeStart: d.validTimeStart ?? null,
                validTimeEnd: d.validTimeEnd ?? null,
                validDaysOfWeek: d.validDaysOfWeek ?? null,
            }));
    }

    /** Per-item preview fields for the consumer menu (safe: time-boxed offers excluded). */
    private previewFor(
        item: { id?: number; categoryId?: number; brandId?: number } | null,
        price: number,
        offers: PreviewOffer[],
        branchId: number | null,
        now: Date,
        channel: OfferChannel | null = null,
    ) {
        if (!item?.id || offers.length === 0)
            return {
                discounted_price: Math.round(price * 100) / 100,
                discount_amount: 0,
                discount_percent: 0,
                discount_label: null,
                has_cart_level_offer: false,
            };
        const p = previewItemOffers(
            {
                menuItemId: item.id,
                categoryId: item.categoryId ?? null,
                brandId: item.brandId ?? null,
                price,
            },
            offers,
            { branchId, allowTimeBoxed: false, now, channel },
        );
        return {
            discounted_price: p.discounted_price,
            discount_amount: p.discount_amount,
            discount_percent: p.discount_percent,
            discount_label: p.discount_label,
            has_cart_level_offer: p.has_cart_level_offer,
        };
    }

    /** List categories for a brand, or all categories for tenant when brandId is null. */
    async getCategories(brandId: number | null, tenantId?: number | null) {
        if (brandId != null) {
            return this.categoryRepo.find({
                where: { brandId },
                order: { sortOrder: 'ASC', id: 'ASC' },
            });
        }
        if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const brandIds = brands.map((b) => b.id);
            if (brandIds.length === 0) return [];
            return this.categoryRepo.find({
                where: { brandId: In(brandIds) },
                order: { sortOrder: 'ASC', id: 'ASC' },
            });
        }
        return this.categoryRepo.find({
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
    }

    /**
     * Consumer API: list unique category names across a given set of active brands.
     * Dedupes by name so a category like "Milkshakes" appears once even if several of
     * the brands define it, and reports how many of them offer each one (brandCount).
     * Driven by brand ids directly so it works brand-first (consumer app) and across
     * multiple branches (e.g. brands available near a location).
     */
    async getConsumerCategoriesForBrandIds(brandIds: number[]) {
        if (brandIds.length === 0) return [];
        const rows = await this.categoryRepo
            .createQueryBuilder('c')
            .innerJoin('c.brand', 'b')
            .where('b.id IN (:...brandIds)', { brandIds })
            .andWhere('b.isActive = :active', { active: true })
            .andWhere('c.isActive = :cActive', { cActive: true })
            .select([
                'LOWER(c.name) AS key',
                'MIN(c.sortOrder) AS sort',
                'MIN(c.name) AS name',
                'COUNT(DISTINCT b.id) AS brand_count',
            ])
            .groupBy('LOWER(c.name)')
            .orderBy('sort', 'ASC')
            .addOrderBy('name', 'ASC')
            .getRawMany<{
                key: string;
                sort: string;
                name: string;
                brand_count: string;
            }>();

        return rows.map((r) => ({
            key: r.key,
            name: r.name,
            brandCount: Number(r.brand_count),
        }));
    }

    /**
     * Consumer API: from a given set of brand ids, return those that are active and define the
     * category. Driven by brand ids directly so it works brand-first (consumer app) and can
     * span multiple branches (e.g. brands available near a location). The caller (e.g.
     * BrandsService) maps the ids to full brand responses.
     */
    async getConsumerBrandIdsForCategoryKey(
        brandIds: number[],
        categoryKey: string,
    ): Promise<number[]> {
        if (brandIds.length === 0) return [];
        const key = categoryKey.toLowerCase();
        const rawBrandIds = await this.categoryRepo
            .createQueryBuilder('c')
            .innerJoin('c.brand', 'b')
            .where('b.id IN (:...brandIds)', { brandIds })
            .andWhere('b.isActive = :active', { active: true })
            .andWhere('c.isActive = :cActive', { cActive: true })
            .andWhere('LOWER(c.name) = :key', { key })
            .select('DISTINCT b.id', 'id')
            .getRawMany<{ id: string }>();

        return rawBrandIds.map((r) => Number(r.id));
    }

    async createCategory(dto: {
        brand_id: number;
        name: string;
        is_active?: boolean;
    }) {
        return this.categoryRepo.save(
            this.categoryRepo.create({
                brandId: dto.brand_id,
                name: dto.name,
                sortOrder: 0,
                isActive: dto.is_active ?? true,
            }),
        );
    }

    async updateCategory(
        id: number,
        dto: { name?: string; is_active?: boolean; sort_order?: number },
    ) {
        const cat = await this.categoryRepo.findOne({ where: { id } });
        if (!cat) throw new NotFoundException('Category not found');
        if (dto.name !== undefined) cat.name = dto.name;
        if (dto.is_active !== undefined) cat.isActive = dto.is_active;
        if (dto.sort_order !== undefined) cat.sortOrder = dto.sort_order;
        await this.categoryRepo.save(cat);
        return cat;
    }

    async deleteCategory(id: number) {
        const cat = await this.categoryRepo.findOne({ where: { id } });
        if (!cat) throw new NotFoundException('Category not found');
        await this.categoryRepo.remove(cat);
        return { message: 'Category deleted successfully' };
    }

    /** List menu items for a brand, or all items for tenant when brandId is null. */
    async getItems(
        brandId: number | null,
        tenantId?: number | null,
        opts?: { category_id?: number; is_active?: boolean; search?: string },
    ) {
        const qb = this.itemRepo
            .createQueryBuilder('i')
            .leftJoinAndSelect('i.category', 'c')
            .leftJoinAndSelect('i.variants', 'v')
            .leftJoinAndSelect('i.addons', 'a')
            .leftJoinAndSelect('i.modifierGroups', 'mg')
            .leftJoinAndSelect('mg.modifiers', 'mgm')
            .orderBy('i.sortOrder', 'ASC')
            .addOrderBy('i.id', 'ASC');

        if (brandId != null) {
            qb.where('i.brandId = :brandId', { brandId });
        } else if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const brandIds = brands.map((b) => b.id);
            if (brandIds.length === 0) return [];
            qb.where('i.brandId IN (:...brandIds)', { brandIds });
        }

        if (opts?.category_id != null) {
            qb.andWhere('i.categoryId = :categoryId', {
                categoryId: opts.category_id,
            });
        }
        if (opts?.is_active !== undefined) {
            qb.andWhere('i.isActive = :isActive', { isActive: opts.is_active });
        }
        if (opts?.search && opts.search.length > 0) {
            qb.andWhere(
                '(LOWER(i.name) LIKE LOWER(:search) OR LOWER(i.description) LIKE LOWER(:search))',
                {
                    search: `%${opts.search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`,
                },
            );
        }

        const items = await qb.getMany();
        return items.map((i) => ({
            id: i.id,
            brand_id: i.brandId,
            category_id: i.categoryId,
            name: i.name,
            slug: i.slug,
            description: i.description,
            image_url: i.imageUrl ?? null,
            gallery_image_urls: galleryUrlsForApi(i),
            base_price: Number(i.basePrice),
            is_active: i.isActive,
            deal_only: i.dealOnly ?? false,
            available_for_order_types: effectiveMenuOrderChannels(
                i.availableForOrderTypes,
            ),
            ...itemMetaForApi(i),
            category: i.category
                ? { id: i.category.id, name: i.category.name }
                : null,
            variants: (i.variants ?? []).map((v) => ({
                id: v.id,
                menu_item_id: v.menuItemId,
                name: v.name,
                price_modifier: Number(v.priceModifier),
                size_key: v.sizeKey ?? null,
                is_default: v.isDefault,
                sort_order: v.sortOrder ?? 0,
            })),
            addons: (i.addons ?? []).map((a) => ({
                id: a.id,
                name: a.name,
                price: Number(a.price),
            })),
            modifier_groups: (i.modifierGroups ?? []).map((mg) => ({
                id: mg.id,
                name: mg.name,
                modifier_count: mg.modifiers?.length ?? 0,
            })),
        }));
    }

    async createItem(dto: {
        brand_id: number;
        category_id: number;
        name: string;
        description?: string;
        base_price: number;
        is_active?: boolean;
        image_url?: string | null;
        gallery_image_urls?: string[] | null;
        deal_only?: boolean;
        /** Omit or null = available on all channels (delivery, pickup, dine_in). */
        available_for_order_types?: string[] | null;
        allergens?: string[] | null;
        calories?: number | null;
        label?: string | null;
        available_time_start?: string | null;
        available_time_end?: string | null;
        available_days_of_week?: number[] | null;
    }) {
        const slug = dto.name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        return this.itemRepo.save(
            this.itemRepo.create({
                brandId: dto.brand_id,
                categoryId: dto.category_id,
                name: dto.name,
                slug,
                description: dto.description ?? null,
                imageUrl: dto.image_url ?? null,
                galleryImageUrls: normalizeGalleryImageUrls(
                    dto.gallery_image_urls,
                ),
                basePrice: dto.base_price,
                isActive: dto.is_active ?? true,
                dealOnly: dto.deal_only ?? false,
                availableForOrderTypes:
                    dto.available_for_order_types != null
                        ? parseMenuOrderChannelsInput(
                              dto.available_for_order_types,
                          )
                        : null,
                allergens: normalizeAllergens(dto.allergens),
                calories: normalizeCalories(dto.calories),
                label: normalizeText40(dto.label),
                availableTimeStart: normalizeTimeOfDay(
                    dto.available_time_start,
                ),
                availableTimeEnd: normalizeTimeOfDay(dto.available_time_end),
                availableDaysOfWeek: normalizeDaysOfWeek(
                    dto.available_days_of_week,
                ),
            }),
        );
    }

    async updateItem(
        id: number,
        dto: {
            name?: string;
            description?: string;
            base_price?: number;
            is_active?: boolean;
            brand_id?: number;
            category_id?: number;
            image_url?: string | null;
            gallery_image_urls?: string[] | null;
            deal_only?: boolean;
            available_for_order_types?: string[] | null;
            allergens?: string[] | null;
            calories?: number | null;
            label?: string | null;
            available_time_start?: string | null;
            available_time_end?: string | null;
            available_days_of_week?: number[] | null;
        },
    ) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) throw new NotFoundException('Menu item not found');
        const oldImageUrl = item.imageUrl ?? null;

        if (dto.brand_id !== undefined) item.brandId = dto.brand_id;
        if (dto.category_id !== undefined) item.categoryId = dto.category_id;
        if (dto.deal_only !== undefined) item.dealOnly = dto.deal_only;
        if (dto.available_for_order_types !== undefined) {
            item.availableForOrderTypes =
                dto.available_for_order_types === null
                    ? null
                    : parseMenuOrderChannelsInput(
                          dto.available_for_order_types,
                      );
        }
        if (dto.name !== undefined) {
            item.name = dto.name;
            item.slug = dto.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        }
        if (dto.description !== undefined) item.description = dto.description;
        if (dto.image_url !== undefined) item.imageUrl = dto.image_url;
        if (dto.gallery_image_urls !== undefined) {
            const oldG = Array.isArray(item.galleryImageUrls)
                ? [...item.galleryImageUrls]
                : [];
            const normalized = normalizeGalleryImageUrls(
                dto.gallery_image_urls,
            );
            item.galleryImageUrls = normalized;
            const keep = new Set(normalized ?? []);
            for (const url of oldG) {
                if (!keep.has(url)) {
                    await this.mediaStorage.deleteManagedObjectByUrl(
                        url,
                        'menu-items',
                    );
                }
            }
        }
        if (dto.base_price !== undefined) item.basePrice = dto.base_price;
        if (dto.is_active !== undefined) item.isActive = dto.is_active;
        if (dto.allergens !== undefined)
            item.allergens = normalizeAllergens(dto.allergens);
        if (dto.calories !== undefined)
            item.calories = normalizeCalories(dto.calories);
        if (dto.label !== undefined) item.label = normalizeText40(dto.label);
        if (dto.available_time_start !== undefined)
            item.availableTimeStart = normalizeTimeOfDay(
                dto.available_time_start,
            );
        if (dto.available_time_end !== undefined)
            item.availableTimeEnd = normalizeTimeOfDay(dto.available_time_end);
        if (dto.available_days_of_week !== undefined)
            item.availableDaysOfWeek = normalizeDaysOfWeek(
                dto.available_days_of_week,
            );

        await this.itemRepo.save(item);
        if (
            dto.image_url !== undefined &&
            oldImageUrl &&
            oldImageUrl !== item.imageUrl
        ) {
            await this.mediaStorage.deleteManagedObjectByUrl(
                oldImageUrl,
                'menu-items',
            );
        }

        // When menu item's brand is changed, revoke addons that belong to other brands
        if (dto.brand_id !== undefined) {
            const itemWithAddons = await this.itemRepo.findOne({
                where: { id },
                relations: ['addons'],
            });
            if (itemWithAddons?.addons?.length) {
                const sameBrandAddons = itemWithAddons.addons.filter(
                    (a) => a.brandId === item.brandId,
                );
                if (sameBrandAddons.length !== itemWithAddons.addons.length) {
                    itemWithAddons.addons = sameBrandAddons;
                    await this.itemRepo.save(itemWithAddons);
                }
            }
        }

        return item;
    }

    async deleteItem(id: number) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) throw new NotFoundException('Menu item not found');
        await this.itemRepo.remove(item);
        return { message: 'Menu item deleted successfully' };
    }

    async linkAddons(menuItemId: number, addonIds: number[]) {
        const item = await this.itemRepo.findOne({
            where: { id: menuItemId },
            relations: ['addons'],
        });
        if (!item) throw new NotFoundException('Menu item not found');
        const addons = await this.addonRepo.find({
            where: { id: In(addonIds) },
        });
        item.addons = addons;
        await this.itemRepo.save(item);
        return item;
    }

    /** List modifier groups for a brand, or all for tenant when brandId is null. */
    async getModifierGroups(
        brandId: number | null,
        tenantId?: number | null,
        menuItemId?: number | null,
    ) {
        const qb = this.modifierGroupRepo
            .createQueryBuilder('mg')
            .leftJoinAndSelect('mg.modifiers', 'm')
            .leftJoinAndSelect('mg.menuItems', 'mi')
            .addOrderBy('m.sortOrder', 'ASC')
            .addOrderBy('m.id', 'ASC');

        if (menuItemId != null) {
            // Filter to groups linked to this item and sort by per-item positions
            qb.innerJoin(
                'mg.menuItems',
                'miFilter',
                'miFilter.id = :menuItemId',
                { menuItemId },
            )
                .leftJoin(
                    'menu_item_modifier_group_positions',
                    'pos',
                    'pos.modifier_group_id = mg.id AND pos.menu_item_id = :menuItemId',
                    { menuItemId },
                )
                .orderBy('COALESCE(pos.sort_order, mg.sort_order)', 'ASC')
                .addOrderBy('mg.id', 'ASC');
        } else {
            qb.orderBy('mg.sortOrder', 'ASC').addOrderBy('mg.id', 'ASC');
        }

        if (brandId != null) {
            qb.where('mg.brandId = :brandId', { brandId });
        } else if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const ids = brands.map((b) => b.id);
            if (ids.length === 0) return [];
            qb.where('mg.brandId IN (:...ids)', { ids });
        }
        const groups = await qb.getMany();
        return groups.map((mg) => ({
            id: mg.id,
            brand_id: mg.brandId,
            name: mg.name,
            min_select: mg.minSelect,
            max_select: mg.maxSelect,
            min_select_by_size: mg.minSelectBySize ?? null,
            max_select_by_size: mg.maxSelectBySize ?? null,
            included_quantity: mg.includedQuantity ?? 0,
            included_by_size: mg.includedBySize ?? null,
            allow_quantity: mg.allowQuantity ?? false,
            price_tiers: mg.priceTiers ?? null,
            hide_in_deals: mg.hideInDeals ?? false,
            visible_when_modifier_ids: mg.visibleWhenModifierIds ?? null,
            sort_order: mg.sortOrder ?? 0,
            linked_menu_items: (mg.menuItems ?? []).map((mi) => ({
                id: mi.id,
                name: mi.name,
            })),
            modifiers: (mg.modifiers ?? [])
                .sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )
                .map((m) => ({
                    id: m.id,
                    modifier_group_id: m.modifierGroupId,
                    name: m.name,
                    price: Number(m.price),
                    price_by_size: m.priceBySize ?? null,
                    available_for_sizes: m.availableForSizes ?? null,
                    sort_order: m.sortOrder ?? 0,
                })),
        }));
    }

    async createModifierGroup(dto: {
        brand_id: number;
        name: string;
        min_select?: number;
        max_select?: number;
        min_select_by_size?: Record<string, number> | null;
        max_select_by_size?: Record<string, number> | null;
        included_quantity?: number;
        included_by_size?: Record<string, number> | null;
        allow_quantity?: boolean;
        price_tiers?: Record<string, number> | null;
        hide_in_deals?: boolean;
    }) {
        const mg = await this.modifierGroupRepo.save(
            this.modifierGroupRepo.create({
                brandId: dto.brand_id,
                name: dto.name,
                minSelect: dto.min_select ?? 0,
                maxSelect: dto.max_select ?? 1,
                minSelectBySize: normalizeIncludedBySize(
                    dto.min_select_by_size,
                ),
                maxSelectBySize: normalizeIncludedBySize(
                    dto.max_select_by_size,
                ),
                includedQuantity: Math.max(0, dto.included_quantity ?? 0),
                includedBySize: normalizeIncludedBySize(dto.included_by_size),
                allowQuantity: dto.allow_quantity ?? false,
                priceTiers: normalizePriceTiers(dto.price_tiers),
                hideInDeals: dto.hide_in_deals ?? false,
            }),
        );
        return {
            id: mg.id,
            brand_id: mg.brandId,
            name: mg.name,
            min_select: mg.minSelect,
            max_select: mg.maxSelect,
            min_select_by_size: mg.minSelectBySize ?? null,
            max_select_by_size: mg.maxSelectBySize ?? null,
            included_quantity: mg.includedQuantity,
            included_by_size: mg.includedBySize ?? null,
            allow_quantity: mg.allowQuantity ?? false,
            price_tiers: mg.priceTiers ?? null,
            hide_in_deals: mg.hideInDeals ?? false,
            visible_when_modifier_ids: mg.visibleWhenModifierIds ?? null,
            modifiers: [],
        };
    }

    async updateModifierGroup(
        id: number,
        dto: {
            name?: string;
            min_select?: number;
            max_select?: number;
            min_select_by_size?: Record<string, number> | null;
            max_select_by_size?: Record<string, number> | null;
            included_quantity?: number;
            included_by_size?: Record<string, number> | null;
            allow_quantity?: boolean;
            price_tiers?: Record<string, number> | null;
            hide_in_deals?: boolean;
        },
    ) {
        const mg = await this.modifierGroupRepo.findOne({ where: { id } });
        if (!mg) throw new NotFoundException('Modifier group not found');
        if (dto.name !== undefined) mg.name = dto.name;
        if (dto.min_select !== undefined) mg.minSelect = dto.min_select;
        if (dto.max_select !== undefined) mg.maxSelect = dto.max_select;
        if (dto.min_select_by_size !== undefined)
            mg.minSelectBySize = normalizeIncludedBySize(
                dto.min_select_by_size,
            );
        if (dto.max_select_by_size !== undefined)
            mg.maxSelectBySize = normalizeIncludedBySize(
                dto.max_select_by_size,
            );
        if (dto.included_quantity !== undefined)
            mg.includedQuantity = Math.max(0, dto.included_quantity);
        if (dto.included_by_size !== undefined)
            mg.includedBySize = normalizeIncludedBySize(dto.included_by_size);
        if (dto.allow_quantity !== undefined)
            mg.allowQuantity = dto.allow_quantity;
        if (dto.price_tiers !== undefined)
            mg.priceTiers = normalizePriceTiers(dto.price_tiers);
        if (dto.hide_in_deals !== undefined) mg.hideInDeals = dto.hide_in_deals;
        await this.modifierGroupRepo.save(mg);
        return mg;
    }

    async deleteModifierGroup(id: number) {
        const mg = await this.modifierGroupRepo.findOne({ where: { id } });
        if (!mg) throw new NotFoundException('Modifier group not found');
        await this.modifierGroupRepo.remove(mg);
        return { message: 'Modifier group deleted' };
    }

    /** List modifiers, optionally filtered by modifier_group_id or brand_id. */
    async getModifiers(
        modifierGroupId?: number | null,
        brandId?: number | null,
        tenantId?: number | null,
    ) {
        const qb = this.modifierRepo
            .createQueryBuilder('m')
            .leftJoinAndSelect('m.modifierGroup', 'mg')
            .orderBy('m.sortOrder', 'ASC')
            .addOrderBy('m.id', 'ASC');
        if (modifierGroupId != null) {
            qb.where('m.modifierGroupId = :modifierGroupId', {
                modifierGroupId,
            });
        } else if (brandId != null) {
            qb.where('mg.brandId = :brandId', { brandId });
        } else if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const ids = brands.map((b) => b.id);
            if (ids.length === 0) return [];
            qb.where('mg.brandId IN (:...ids)', { ids });
        }
        const list = await qb.getMany();
        return list.map((m) => ({
            id: m.id,
            modifier_group_id: m.modifierGroupId,
            name: m.name,
            price: Number(m.price),
            price_by_size: m.priceBySize ?? null,
            available_for_sizes: m.availableForSizes ?? null,
            sort_order: m.sortOrder ?? 0,
            modifier_group_name: m.modifierGroup?.name,
        }));
    }

    async createModifier(dto: {
        modifier_group_id: number;
        name: string;
        price?: number;
        price_by_size?: Record<string, number> | null;
        available_for_sizes?: string[] | null;
    }) {
        const group = await this.modifierGroupRepo.findOne({
            where: { id: dto.modifier_group_id },
        });
        if (!group) throw new NotFoundException('Modifier group not found');
        const m = await this.modifierRepo.save(
            this.modifierRepo.create({
                modifierGroupId: dto.modifier_group_id,
                name: dto.name,
                price: dto.price ?? 0,
                priceBySize: normalizePriceBySize(dto.price_by_size),
                availableForSizes: normalizeSizeList(dto.available_for_sizes),
            }),
        );
        return {
            id: m.id,
            modifier_group_id: m.modifierGroupId,
            name: m.name,
            price: Number(m.price),
            price_by_size: m.priceBySize ?? null,
            available_for_sizes: m.availableForSizes ?? null,
        };
    }

    async updateModifier(
        id: number,
        dto: {
            name?: string;
            price?: number;
            price_by_size?: Record<string, number> | null;
            available_for_sizes?: string[] | null;
        },
    ) {
        const m = await this.modifierRepo.findOne({ where: { id } });
        if (!m) throw new NotFoundException('Modifier not found');
        if (dto.name !== undefined) m.name = dto.name;
        if (dto.price !== undefined) m.price = dto.price;
        if (dto.price_by_size !== undefined)
            m.priceBySize = normalizePriceBySize(dto.price_by_size);
        if (dto.available_for_sizes !== undefined)
            m.availableForSizes = normalizeSizeList(dto.available_for_sizes);
        await this.modifierRepo.save(m);
        return m;
    }

    async deleteModifier(id: number) {
        const m = await this.modifierRepo.findOne({ where: { id } });
        if (!m) throw new NotFoundException('Modifier not found');
        await this.modifierRepo.remove(m);
        return { message: 'Modifier deleted' };
    }

    /** Load per-item group positions for a set of item IDs in one query. */
    private async buildPositionsMap(
        itemIds: number[],
    ): Promise<Map<number, Map<number, number>>> {
        if (!itemIds.length) return new Map();
        const rows = await this.positionRepo.find({
            where: { menuItemId: In(itemIds) },
        });
        const map = new Map<number, Map<number, number>>();
        for (const row of rows) {
            let g = map.get(row.menuItemId);
            if (!g) {
                g = new Map();
                map.set(row.menuItemId, g);
            }
            g.set(row.modifierGroupId, row.sortOrder);
        }
        return map;
    }

    /** Sort modifier groups using per-item positions; falls back to global sort_order. */
    private sortGroupsForItem(
        itemId: number,
        groups: ModifierGroup[],
        posMap: Map<number, Map<number, number>>,
    ): ModifierGroup[] {
        const gp = posMap.get(itemId);
        return [...groups].sort((a, b) => {
            const aPos = gp?.get(a.id) ?? a.sortOrder ?? 999;
            const bPos = gp?.get(b.id) ?? b.sortOrder ?? 999;
            return (
                aPos - bPos ||
                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                a.id - b.id
            );
        });
    }

    async reorderItemModifierGroups(
        menuItemId: number,
        orderedGroupIds: number[],
        allowedBrandIds: number[] | null,
    ): Promise<{ message: string }> {
        if (allowedBrandIds !== null) {
            const item = await this.itemRepo.findOne({
                where: { id: menuItemId },
                select: ['id', 'brandId'],
            });
            if (!item || !allowedBrandIds.includes(item.brandId)) {
                throw new ForbiddenException(
                    'You do not have access to this menu item',
                );
            }
        }
        for (let i = 0; i < orderedGroupIds.length; i++) {
            await this.positionRepo.upsert(
                {
                    menuItemId,
                    modifierGroupId: orderedGroupIds[i],
                    sortOrder: i,
                },
                ['menuItemId', 'modifierGroupId'],
            );
        }
        return { message: 'Item modifier group order updated' };
    }

    async reorderModifiers(
        modifierGroupId: number,
        orderedIds: number[],
    ): Promise<{ message: string }> {
        for (let i = 0; i < orderedIds.length; i++) {
            await this.modifierRepo.update(
                { id: orderedIds[i], modifierGroupId },
                { sortOrder: i },
            );
        }
        return { message: 'Modifier order updated' };
    }

    async reorderModifierGroups(
        brandId: number,
        orderedIds: number[],
    ): Promise<{ message: string }> {
        for (let i = 0; i < orderedIds.length; i++) {
            await this.modifierGroupRepo.update(
                { id: orderedIds[i], brandId },
                { sortOrder: i },
            );
        }
        return { message: 'Modifier group order updated' };
    }

    async linkModifierGroups(menuItemId: number, modifierGroupIds: number[]) {
        const item = await this.itemRepo.findOne({
            where: { id: menuItemId },
            relations: ['modifierGroups'],
        });
        if (!item) throw new NotFoundException('Menu item not found');
        const groups = await this.modifierGroupRepo.find({
            where: { id: In(modifierGroupIds) },
        });
        item.modifierGroups = groups;
        await this.itemRepo.save(item);
        return item;
    }

    /** List addons for a brand, or all addons for tenant when brandId is null. Optional search filters by addon name (ILIKE). */
    async getAddons(
        brandId: number | null,
        categoryId?: number,
        tenantId?: number | null,
        search?: string,
        isActive?: boolean,
    ) {
        const qb = this.addonRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.category', 'c')
            .orderBy('a.sortOrder', 'ASC')
            .addOrderBy('a.id', 'ASC');

        if (brandId != null) {
            qb.where('a.brandId = :brandId', { brandId });
        } else if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const brandIds = brands.map((b) => b.id);
            if (brandIds.length === 0) return [];
            qb.where('a.brandId IN (:...brandIds)', { brandIds });
        }
        if (categoryId != null)
            qb.andWhere('a.categoryId = :categoryId', { categoryId });
        if (search?.trim()) {
            qb.andWhere('LOWER(a.name) LIKE LOWER(:search)', {
                search: `%${search.trim()}%`,
            });
        }
        if (isActive !== undefined)
            qb.andWhere('a.isActive = :isActive', { isActive });

        const list = await qb.getMany();
        return list.map((a) => ({
            id: a.id,
            brand_id: a.brandId,
            categoryId: a.categoryId,
            category_id: a.categoryId,
            name: a.name,
            price: Number(a.price),
            isActive: a.isActive,
            is_active: a.isActive,
            sortOrder: a.sortOrder,
            sort_order: a.sortOrder,
            category: a.category
                ? { id: a.category.id, name: a.category.name }
                : null,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
        }));
    }

    async createAddon(dto: {
        brand_id: number;
        category_id?: number;
        name: string;
        price: number;
        is_active?: boolean;
    }) {
        return this.addonRepo.save(
            this.addonRepo.create({
                brandId: dto.brand_id,
                categoryId: dto.category_id ?? null,
                name: dto.name,
                price: dto.price,
                isActive: dto.is_active ?? true,
            }),
        );
    }

    async updateAddon(
        id: number,
        dto: {
            name?: string;
            price?: number;
            is_active?: boolean;
            category_id?: number | null;
            brand_id?: number;
        },
    ) {
        const addon = await this.addonRepo.findOne({ where: { id } });
        if (!addon) throw new NotFoundException('Addon not found');

        // When addon is moved to another brand, revoke its link from menu items of other brands
        if (dto.brand_id !== undefined && dto.brand_id != null) {
            const newBrandId = dto.brand_id;
            const menuItemsWithThisAddon = await this.itemRepo
                .createQueryBuilder('i')
                .innerJoin('i.addons', 'a', 'a.id = :addonId', { addonId: id })
                .where('i.brandId != :newBrandId', { newBrandId })
                .getMany();
            for (const menuItem of menuItemsWithThisAddon) {
                const itemWithAddons = await this.itemRepo.findOne({
                    where: { id: menuItem.id },
                    relations: ['addons'],
                });
                if (itemWithAddons?.addons?.length) {
                    itemWithAddons.addons = itemWithAddons.addons.filter(
                        (a) => a.id !== id,
                    );
                    await this.itemRepo.save(itemWithAddons);
                }
            }
        }

        if (dto.brand_id !== undefined) {
            if (dto.brand_id != null) addon.brandId = dto.brand_id;
        }
        if (dto.name !== undefined) addon.name = dto.name;
        if (dto.price !== undefined) addon.price = dto.price;
        if (dto.is_active !== undefined) addon.isActive = dto.is_active;
        if (dto.category_id !== undefined) addon.categoryId = dto.category_id;
        await this.addonRepo.save(addon);
        return addon;
    }

    async deleteAddon(id: number) {
        const addon = await this.addonRepo.findOne({ where: { id } });
        if (!addon) throw new NotFoundException('Addon not found');
        await this.addonRepo.remove(addon);
        return { message: 'Addon deleted successfully' };
    }

    async getVariants(menuItemId: number) {
        return this.variantRepo.find({
            where: { menuItemId },
            order: { sortOrder: 'ASC', id: 'ASC' },
            relations: ['menuItem'],
        });
    }

    /** Return all variants for a brand, or all variants for tenant when brandId is null. */
    async getVariantsForBrand(
        brandId: number | null,
        tenantId?: number | null,
    ) {
        const qb = this.variantRepo
            .createQueryBuilder('v')
            .leftJoinAndSelect('v.menuItem', 'i')
            .orderBy('v.sortOrder', 'ASC')
            .addOrderBy('v.id', 'ASC');
        if (brandId != null) {
            qb.where('i.brandId = :brandId', { brandId });
        } else if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const brandIds = brands.map((b) => b.id);
            if (brandIds.length === 0) return [];
            qb.where('i.brandId IN (:...brandIds)', { brandIds });
        }
        return qb.getMany();
    }

    async createVariant(dto: {
        menu_item_id: number;
        name: string;
        price_modifier?: number;
        is_default?: boolean;
        sort_order?: number;
        size_key?: string | null;
    }) {
        return this.variantRepo.save(
            this.variantRepo.create({
                menuItemId: dto.menu_item_id,
                name: dto.name,
                priceModifier: dto.price_modifier ?? 0,
                isDefault: dto.is_default ?? false,
                sortOrder: dto.sort_order ?? 0,
                sizeKey: normalizeSizeKey(dto.size_key),
            }),
        );
    }

    async updateVariant(
        id: number,
        dto: {
            name?: string;
            price_modifier?: number;
            is_default?: boolean;
            menu_item_id?: number;
            sort_order?: number;
            size_key?: string | null;
        },
    ) {
        const v = await this.variantRepo.findOne({ where: { id } });
        if (!v) throw new NotFoundException('Variant not found');
        if (dto.menu_item_id !== undefined) v.menuItemId = dto.menu_item_id;
        if (dto.name !== undefined) v.name = dto.name;
        if (dto.price_modifier !== undefined)
            v.priceModifier = dto.price_modifier;
        if (dto.is_default !== undefined) v.isDefault = dto.is_default;
        if (dto.sort_order !== undefined) v.sortOrder = dto.sort_order;
        if (dto.size_key !== undefined)
            v.sizeKey = normalizeSizeKey(dto.size_key);
        await this.variantRepo.save(v);
        return v;
    }

    async deleteVariant(id: number) {
        const v = await this.variantRepo.findOne({ where: { id } });
        if (!v) throw new NotFoundException('Variant not found');
        await this.variantRepo.remove(v);
        return { message: 'Variant deleted successfully' };
    }

    /**
     * Get menu for a branch: brands at branch → brand menu items → LEFT JOIN branch_menu_items for overrides.
     * Applies price_override ?? base_price, is_available, and excludes is_hidden_online when requested.
     */
    async getBranchMenu(
        branchId: number,
        options?: {
            includeHiddenOnline?: boolean;
            brandId?: number;
            search?: string;
            /** When set, only items that support this order channel are returned (delivery, pickup, dine_in; takeaway → pickup). */
            orderType?: string;
            /** Sale channel the menu is rendered for (price preview); null = only channel-unrestricted offers show. */
            channel?: OfferChannel | null;
        },
    ) {
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            relations: [
                'branchBrands',
                'branchBrands.brand',
                'branchMenuItems',
                'branchMenuItems.menuItem',
                'branchMenuItems.menuItem.category',
                'branchMenuItems.menuItem.variants',
                'branchMenuItems.menuItem.addons',
                'branchMenuItems.menuItem.modifierGroups',
                'branchMenuItems.menuItem.modifierGroups.modifiers',
            ],
        });
        type BranchWithBrands = Branch & { branchBrands?: unknown[] };
        if (!branch || !(branch as BranchWithBrands).branchBrands?.length)
            return [];
        // No menu for an inactive branch.
        if (!branch.isActive) return [];

        // Branch wall-clock for time/day-restricted items (e.g. lunch deals): availability
        // is evaluated in the BRANCH timezone, not the requesting device's.
        const branchClock = getBranchClock(
            (branch as { timezone?: string }).timezone,
        );

        // Only items whose brand is still linked to this branch AND active may be
        // sold. Guards against orphaned branch_menu_items left behind when a brand
        // is unlinked, and mirrors the branch-level switch: an inactive brand is
        // fully off everywhere — hidden from customers and not sellable at POS.
        const linkedBrandIds = new Set(
            (
                (
                    branch as BranchWithBrands & {
                        branchBrands?: Array<{
                            brandId?: number;
                            brand?: { isActive?: boolean };
                        }>;
                    }
                ).branchBrands ?? []
            )
                .filter((bb) => bb.brand?.isActive !== false)
                .map((bb) => bb.brandId)
                .filter((id): id is number => id != null),
        );

        let linked = (branch.branchMenuItems ?? [])
            .filter(
                (bmi) =>
                    bmi.menuItem?.brandId != null &&
                    linkedBrandIds.has(bmi.menuItem.brandId),
            )
            .filter((bmi) => bmi.isAvailable !== false)
            .filter(
                (bmi) =>
                    options?.includeHiddenOnline !== false ||
                    !bmi.isHiddenOnline,
            )
            .filter(
                (bmi) => !(bmi.menuItem as { dealOnly?: boolean })?.dealOnly,
            );
        if (options?.brandId != null && Number.isFinite(options.brandId)) {
            linked = linked.filter(
                (bmi) => bmi.menuItem?.brandId === options.brandId,
            );
        }
        linked.sort(
            (a, b) =>
                (a.menuItem?.sortOrder ?? 0) - (b.menuItem?.sortOrder ?? 0) ||
                a.id - b.id,
        );

        const searchQ = options?.search?.trim()?.toLowerCase();
        if (searchQ) {
            linked = linked.filter((bmi) => {
                const name = (bmi.menuItem?.name ?? '').toLowerCase();
                const desc = (bmi.menuItem?.description ?? '').toLowerCase();
                const cat = (bmi.menuItem?.category?.name ?? '').toLowerCase();
                return (
                    name.includes(searchQ) ||
                    desc.includes(searchQ) ||
                    cat.includes(searchQ)
                );
            });
        }

        const orderTypeFilter = options?.orderType?.trim();
        if (orderTypeFilter) {
            linked = linked.filter((bmi) =>
                isMenuItemAvailableForOrderType(
                    bmi.menuItem?.availableForOrderTypes ?? null,
                    orderTypeFilter,
                ),
            );
        }

        const itemIds = linked
            .map((bmi) => bmi.menuItem?.id)
            .filter((id): id is number => id != null);
        const posMap = await this.buildPositionsMap(itemIds);

        const previewTenantId =
            ((
                branch as {
                    branchBrands?: Array<{ brand?: { tenantId?: number } }>;
                }
            ).branchBrands ?? [])[0]?.brand?.tenantId ?? null;
        const previewOffers = await this.loadPreviewOffers(previewTenantId);
        const previewNow = new Date();

        return linked.map((bmi) => {
            const item = bmi.menuItem;
            const price =
                bmi.priceOverride != null
                    ? Number(bmi.priceOverride)
                    : Number(item?.basePrice ?? 0);
            return {
                id: item?.id,
                name: item?.name,
                description: item?.description,
                image_url: item?.imageUrl ?? null,
                gallery_image_urls: item ? galleryUrlsForApi(item) : [],
                price,
                base_price: Number(item?.basePrice ?? 0),
                ...this.previewFor(
                    item
                        ? {
                              id: item.id,
                              categoryId: item.categoryId ?? item.category?.id,
                              brandId: item.brandId,
                          }
                        : null,
                    price,
                    previewOffers,
                    branchId,
                    previewNow,
                    options?.channel ?? null,
                ),
                category: item?.category?.name,
                category_id: item?.categoryId ?? item?.category?.id ?? null,
                brand_id:
                    item?.brandId ??
                    (item?.brand as { id: number } | undefined)?.id ??
                    null,
                available_for_order_types: effectiveMenuOrderChannels(
                    item?.availableForOrderTypes ?? null,
                ),
                ...itemMetaForApi(item ?? {}),
                // tz-correct "is this orderable right now" (lunch deals, etc.).
                available_now: isWithinSchedule(
                    {
                        timeStart: item?.availableTimeStart,
                        timeEnd: item?.availableTimeEnd,
                        daysOfWeek: item?.availableDaysOfWeek,
                    },
                    branchClock,
                ),
                variants: [...(item?.variants ?? [])]
                    .sort(
                        (a, b) =>
                            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                            a.id - b.id,
                    )
                    .map((v) => ({
                        id: v.id,
                        name: v.name,
                        price_modifier: Number(v.priceModifier),
                        size_key: v.sizeKey ?? null,
                        is_default: v.isDefault,
                        sort_order: v.sortOrder ?? 0,
                    })),
                addons:
                    item?.addons?.map((a) => ({
                        id: a.id,
                        name: a.name,
                        price: Number(a.price),
                    })) ?? [],
                modifier_groups: this.sortGroupsForItem(
                    item?.id ?? 0,
                    item?.modifierGroups ?? [],
                    posMap,
                ).map((mg) => ({
                    id: mg.id,
                    name: mg.name,
                    min_select: mg.minSelect,
                    max_select: mg.maxSelect,
                    min_select_by_size: mg.minSelectBySize ?? null,
                    max_select_by_size: mg.maxSelectBySize ?? null,
                    included_quantity: mg.includedQuantity ?? 0,
                    included_by_size: mg.includedBySize ?? null,
                    allow_quantity: mg.allowQuantity ?? false,
                    price_tiers: mg.priceTiers ?? null,
                    hide_in_deals: mg.hideInDeals ?? false,
                    visible_when_modifier_ids:
                        mg.visibleWhenModifierIds ?? null,
                    modifiers: [...(mg.modifiers ?? [])]
                        .sort(
                            (a, b) =>
                                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                                a.id - b.id,
                        )
                        .map((m) => ({
                            id: m.id,
                            name: m.name,
                            price: Number(m.price),
                            price_by_size: m.priceBySize ?? null,
                            available_for_sizes: m.availableForSizes ?? null,
                            sort_order: m.sortOrder ?? 0,
                        })),
                })),
            };
        });
    }

    /**
     * Consumer web home/menu: return menu items for a brand scoped to a tenant,
     * independent of branch availability and order type.
     *
     * Pricing uses the menu item's base_price (no branch overrides).
     */
    /**
     * Tenant-wide menu search across all of the tenant's brands — powers the
     * consumer header search/autocomplete. Returns lightweight suggestions
     * (name matches ranked first), capped at `limit`.
     */
    async searchTenantMenu(tenantId: number, query: string, limit = 8) {
        const q = query.trim();
        if (!q) return [];
        const brands = await this.brandRepo.find({
            where: { tenantId },
            select: ['id', 'name'],
        });
        if (!brands.length) return [];
        const brandNameById = new Map(brands.map((b) => [b.id, b.name]));
        const brandIds = brands.map((b) => b.id);
        const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const like = `%${escaped}%`;
        const prefix = `${escaped}%`;

        // Rank via an aliased select column (not a raw orderBy expression):
        // a dotted CASE in orderBy() collides with TypeORM's join+take
        // pagination rewrite and throws at runtime.
        const items = await this.itemRepo
            .createQueryBuilder('i')
            .leftJoinAndSelect('i.category', 'c')
            .addSelect(
                'CASE WHEN LOWER(i.name) LIKE LOWER(:prefix) THEN 0 WHEN LOWER(i.name) LIKE LOWER(:like) THEN 1 ELSE 2 END',
                'rank',
            )
            .where('i.brandId IN (:...brandIds)', { brandIds })
            .andWhere('i.isActive = :active', { active: true })
            .andWhere('(i.dealOnly IS NULL OR i.dealOnly = false)')
            .andWhere(
                '(LOWER(i.name) LIKE LOWER(:like) OR LOWER(i.description) LIKE LOWER(:like) OR LOWER(c.name) LIKE LOWER(:like))',
                { like },
            )
            .setParameter('prefix', prefix)
            .orderBy('rank', 'ASC')
            .addOrderBy('i.name', 'ASC')
            .take(limit)
            .getMany();

        return items.map((item) => {
            const base = Number(item.basePrice ?? 0);
            return {
                id: item.id,
                name: item.name,
                description: item.description ?? null,
                image_url: item.imageUrl ?? null,
                price: base,
                category: item.category?.name ?? null,
                brand_id: item.brandId ?? null,
                brand_name:
                    item.brandId != null
                        ? (brandNameById.get(item.brandId) ?? null)
                        : null,
            };
        });
    }

    async getTenantBrandMenu(
        tenantId: number,
        brandId: number,
        opts?: { search?: string },
    ) {
        await this.assertBrandBelongsToTenant(brandId, tenantId);

        const qb = this.itemRepo
            .createQueryBuilder('i')
            .leftJoinAndSelect('i.category', 'c')
            .leftJoinAndSelect('i.variants', 'v')
            .leftJoinAndSelect('i.addons', 'a')
            .leftJoinAndSelect('i.modifierGroups', 'mg')
            .leftJoinAndSelect('mg.modifiers', 'm')
            .where('i.brandId = :brandId', { brandId })
            .andWhere('i.isActive = :active', { active: true })
            .andWhere('(i.dealOnly IS NULL OR i.dealOnly = false)')
            .orderBy('i.sortOrder', 'ASC')
            .addOrderBy('i.id', 'ASC');

        const searchQ = opts?.search?.trim();
        if (searchQ) {
            qb.andWhere(
                '(LOWER(i.name) LIKE LOWER(:search) OR LOWER(i.description) LIKE LOWER(:search) OR LOWER(c.name) LIKE LOWER(:search))',
                {
                    search: `%${searchQ.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`,
                },
            );
        }

        const items = await qb.getMany();

        const posMap = await this.buildPositionsMap(items.map((i) => i.id));

        return items.map((item) => {
            const base = Number(item.basePrice ?? 0);
            return {
                id: item.id,
                name: item.name,
                description: item.description,
                image_url: item.imageUrl ?? null,
                price: base,
                base_price: base,
                category: item.category?.name ?? null,
                category_id: item.categoryId ?? item.category?.id ?? null,
                brand_id: item.brandId ?? null,
                available_for_order_types: effectiveMenuOrderChannels(
                    item.availableForOrderTypes ?? null,
                ),
                ...itemMetaForApi(item),
                variants: [...(item.variants ?? [])]
                    .sort(
                        (a, b) =>
                            (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                            a.id - b.id,
                    )
                    .map((v) => ({
                        id: v.id,
                        name: v.name,
                        price_modifier: Number(v.priceModifier),
                        size_key: v.sizeKey ?? null,
                        is_default: v.isDefault,
                        sort_order: v.sortOrder ?? 0,
                    })),
                addons:
                    item.addons?.map((a) => ({
                        id: a.id,
                        name: a.name,
                        price: Number(a.price),
                    })) ?? [],
                modifier_groups: this.sortGroupsForItem(
                    item.id,
                    item.modifierGroups ?? [],
                    posMap,
                ).map((mg) => ({
                    id: mg.id,
                    name: mg.name,
                    min_select: mg.minSelect,
                    max_select: mg.maxSelect,
                    min_select_by_size: mg.minSelectBySize ?? null,
                    max_select_by_size: mg.maxSelectBySize ?? null,
                    included_quantity: mg.includedQuantity ?? 0,
                    included_by_size: mg.includedBySize ?? null,
                    allow_quantity: mg.allowQuantity ?? false,
                    price_tiers: mg.priceTiers ?? null,
                    hide_in_deals: mg.hideInDeals ?? false,
                    visible_when_modifier_ids:
                        mg.visibleWhenModifierIds ?? null,
                    modifiers: [...(mg.modifiers ?? [])]
                        .sort(
                            (a, b) =>
                                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                                a.id - b.id,
                        )
                        .map((m) => ({
                            id: m.id,
                            name: m.name,
                            price: Number(m.price),
                            price_by_size: m.priceBySize ?? null,
                            available_for_sizes: m.availableForSizes ?? null,
                            sort_order: m.sortOrder ?? 0,
                        })),
                })),
            };
        });
    }

    /** Single tenant-brand menu item (includes gallery for consumer PDP). */
    async getTenantMenuItem(
        tenantId: number,
        brandId: number,
        menuItemId: number,
    ) {
        await this.assertBrandBelongsToTenant(brandId, tenantId);

        const item = await this.itemRepo.findOne({
            where: { id: menuItemId, brandId, isActive: true },
            relations: [
                'category',
                'variants',
                'addons',
                'modifierGroups',
                'modifierGroups.modifiers',
            ],
        });
        if (!item || item.dealOnly) {
            throw new NotFoundException('Menu item not found');
        }

        const base = Number(item.basePrice ?? 0);
        return {
            id: item.id,
            name: item.name,
            description: item.description,
            image_url: item.imageUrl ?? null,
            gallery_image_urls: galleryUrlsForApi(item),
            price: base,
            base_price: base,
            category: item.category?.name ?? null,
            category_id: item.categoryId ?? item.category?.id ?? null,
            brand_id: item.brandId ?? null,
            available_for_order_types: effectiveMenuOrderChannels(
                item.availableForOrderTypes ?? null,
            ),
            ...itemMetaForApi(item),
            variants: [...(item.variants ?? [])]
                .sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )
                .map((v) => ({
                    id: v.id,
                    name: v.name,
                    price_modifier: Number(v.priceModifier),
                    size_key: v.sizeKey ?? null,
                    is_default: v.isDefault,
                    sort_order: v.sortOrder ?? 0,
                })),
            addons:
                item.addons?.map((a) => ({
                    id: a.id,
                    name: a.name,
                    price: Number(a.price),
                })) ?? [],
            modifier_groups: await this.buildPositionsMap([item.id]).then(
                (pm) =>
                    this.sortGroupsForItem(
                        item.id,
                        item.modifierGroups ?? [],
                        pm,
                    ).map((mg) => ({
                        id: mg.id,
                        name: mg.name,
                        min_select: mg.minSelect,
                        max_select: mg.maxSelect,
                        min_select_by_size: mg.minSelectBySize ?? null,
                        max_select_by_size: mg.maxSelectBySize ?? null,
                        included_quantity: mg.includedQuantity ?? 0,
                        included_by_size: mg.includedBySize ?? null,
                        allow_quantity: mg.allowQuantity ?? false,
                        price_tiers: mg.priceTiers ?? null,
                        hide_in_deals: mg.hideInDeals ?? false,
                        visible_when_modifier_ids:
                            mg.visibleWhenModifierIds ?? null,
                        modifiers: [...(mg.modifiers ?? [])]
                            .sort(
                                (a, b) =>
                                    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                                    a.id - b.id,
                            )
                            .map((m) => ({
                                id: m.id,
                                name: m.name,
                                price: Number(m.price),
                                price_by_size: m.priceBySize ?? null,
                                available_for_sizes:
                                    m.availableForSizes ?? null,
                                sort_order: m.sortOrder ?? 0,
                            })),
                    })),
            ),
        };
    }

    async findMenuItem(id: number) {
        return this.itemRepo.findOne({
            where: { id },
            relations: [
                'variants',
                'addons',
                'brand',
                'modifierGroups',
                'modifierGroups.modifiers',
            ],
        });
    }

    /**
     * Effective unit price for a menu item at a branch: branch price_override if set, else base price.
     * Used by POS quote/order so branch pricing is applied.
     */
    /**
     * Re-validate at order-commit time that a branch has not just 86'd the item
     * (branch_menu_items.is_available=false), or hidden it online for online
     * channels. The branch menu is filtered for DISPLAY, but that read happens in an
     * earlier request; without this check a sold-out item placed after the menu was
     * loaded would still be accepted (TOCTOU). A missing branch override row means
     * the item is orderable by default (parity with the flat menu).
     */
    async assertBranchItemOrderable(
        branchId: number,
        menuItemId: number,
        source: string,
        itemName?: string,
    ): Promise<void> {
        const bmi = await this.branchMenuItemRepo.findOne({
            where: { branchId, menuItemId },
            select: { id: true, isAvailable: true, isHiddenOnline: true },
        });
        if (!bmi) return;
        const label = itemName ?? 'This item';
        if (bmi.isAvailable === false) {
            throw new BadRequestException(
                `"${label}" is currently unavailable at this branch.`,
            );
        }
        const online =
            source === 'consumer_app' ||
            source === 'consumer_web' ||
            source === 'kiosk';
        if (online && bmi.isHiddenOnline) {
            throw new BadRequestException(
                `"${label}" is not available for online ordering.`,
            );
        }
    }

    async getEffectiveUnitPrice(
        branchId: number,
        menuItemId: number,
    ): Promise<number> {
        const bmi = await this.branchMenuItemRepo.findOne({
            where: { branchId, menuItemId },
            relations: ['menuItem'],
        });
        if (bmi?.priceOverride != null) return Number(bmi.priceOverride);
        const item = await this.itemRepo.findOne({
            where: { id: menuItemId },
            select: ['basePrice'],
        });
        return item ? Number(item.basePrice) : 0;
    }

    /** List menu items that have deal_components (for admin Deals list). */
    async listDeals(brandId: number | null, tenantId?: number | null) {
        const qb = this.dealComponentRepo
            .createQueryBuilder('dc')
            .select('DISTINCT dc.menuItemId', 'menuItemId')
            .orderBy('dc.menuItemId', 'ASC');
        if (brandId != null) {
            qb.innerJoin('dc.menuItem', 'mi').andWhere(
                'mi.brandId = :brandId',
                { brandId },
            );
        } else if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { tenantId },
                select: ['id'],
            });
            const brandIds = brands.map((b) => b.id);
            if (brandIds.length === 0) return [];
            qb.innerJoin('dc.menuItem', 'mi').andWhere(
                'mi.brandId IN (:...brandIds)',
                { brandIds },
            );
        }
        const rows = await qb.getRawMany<{ menuItemId: string }>();
        const menuItemIds = rows
            .map((r) => parseInt(r.menuItemId, 10))
            .filter((id) => Number.isFinite(id));
        if (menuItemIds.length === 0) return [];
        const items = await this.itemRepo.find({
            where: menuItemIds.map((id) => ({ id })),
            relations: ['category', 'brand'],
            order: { name: 'ASC' },
        });
        const componentCounts = await this.dealComponentRepo
            .createQueryBuilder('dc')
            .select('dc.menuItemId', 'menuItemId')
            .addSelect('COUNT(*)', 'count')
            .where('dc.menuItemId IN (:...ids)', { ids: menuItemIds })
            .groupBy('dc.menuItemId')
            .getRawMany<{ menuItemId: number; count: string }>();
        const countMap = new Map(
            componentCounts.map((c) => [c.menuItemId, parseInt(c.count, 10)]),
        );
        return items.map((i) => ({
            id: i.id,
            name: i.name,
            base_price: Number(i.basePrice),
            is_active: i.isActive,
            brand_id: i.brandId,
            brand: i.brand ? { id: i.brand.id, name: i.brand.name } : null,
            category_id: i.categoryId,
            category: i.category
                ? { id: i.category.id, name: i.category.name }
                : null,
            available_for_order_types: effectiveMenuOrderChannels(
                i.availableForOrderTypes,
            ),
            ...itemMetaForApi(i),
            slot_count: countMap.get(i.id) ?? 0,
        }));
    }

    /**
     * Per-slot upsell surcharges for a deal, keyed by slot_index → { sourceMenuItemId: extraPrice }.
     * Used at order time to add "upgrade to X (+Rs N)" charges within a deal slot.
     */
    async getDealSlotSurcharges(
        menuItemId: number,
    ): Promise<Map<number, Record<string, number>>> {
        const comps = await this.dealComponentRepo.find({
            where: { menuItemId },
            select: ['slotIndex', 'slotSurcharges'],
        });
        const out = new Map<number, Record<string, number>>();
        for (const c of comps) {
            if (c.slotSurcharges && Object.keys(c.slotSurcharges).length > 0) {
                out.set(c.slotIndex, c.slotSurcharges);
            }
        }
        return out;
    }

    /**
     * Per-slot pricing/constraint metadata for a deal, keyed by slot_index. Used by the
     * order pipeline (expandDealItems) to enforce BOGO size/category constraints and to
     * resolve per-slot allowed sizes server-side.
     */
    async getDealComponentMeta(
        menuItemId: number,
    ): Promise<Map<number, DealSlotMeta>> {
        const comps = await this.dealComponentRepo.find({
            where: { menuItemId },
            select: [
                'slotIndex',
                'type',
                'quantity',
                'optional',
                'sourceMenuItemId',
                'sourceCategoryId',
                'sourceMenuItemIds',
                'slotSizeKey',
                'allowedSizeKeys',
                'mirrorSlotIndex',
                'mirrorMatchSize',
                'mirrorMatchCategory',
            ],
        });
        const out = new Map<number, DealSlotMeta>();
        for (const c of comps) {
            out.set(c.slotIndex, {
                type: c.type,
                quantity: Math.max(1, Number(c.quantity) || 1),
                optional: !!c.optional,
                sourceMenuItemId: c.sourceMenuItemId ?? null,
                sourceCategoryId: c.sourceCategoryId ?? null,
                sourceMenuItemIds: c.sourceMenuItemIds ?? null,
                slotSizeKey: c.slotSizeKey ?? null,
                allowedSizeKeys: c.allowedSizeKeys ?? null,
                mirrorSlotIndex: c.mirrorSlotIndex ?? null,
                mirrorMatchSize: !!c.mirrorMatchSize,
                mirrorMatchCategory: !!c.mirrorMatchCategory,
            });
        }
        return out;
    }

    /** Get deal components for admin (edit form). Returns null if not a deal. */
    async getDealForAdmin(menuItemId: number) {
        const item = await this.itemRepo.findOne({
            where: { id: menuItemId },
            relations: ['category', 'brand'],
        });
        if (!item) return null;
        const components = await this.dealComponentRepo.find({
            where: { menuItemId },
            order: { slotIndex: 'ASC' },
            relations: ['sourceMenuItem', 'sourceCategory'],
        });
        if (!components.length) return null;
        return {
            menu_item_id: item.id,
            brand_id: item.brandId,
            brand: item.brand
                ? { id: item.brand.id, name: item.brand.name }
                : null,
            name: item.name,
            base_price: Number(item.basePrice),
            category: item.category
                ? { id: item.category.id, name: item.category.name }
                : null,
            slots: components.map((dc) => ({
                id: dc.id,
                slot_index: dc.slotIndex,
                type: dc.type,
                source_menu_item_id: dc.sourceMenuItemId ?? null,
                source_category_id: dc.sourceCategoryId ?? null,
                source_menu_item_ids: dc.sourceMenuItemIds ?? null,
                quantity: dc.quantity,
                allow_customization: dc.allowCustomization,
                slot_surcharges: dc.slotSurcharges ?? null,
                slot_size_key: dc.slotSizeKey ?? null,
                allowed_size_keys: dc.allowedSizeKeys ?? null,
                mirror_slot_index: dc.mirrorSlotIndex ?? null,
                mirror_match_size: !!dc.mirrorMatchSize,
                mirror_match_category: !!dc.mirrorMatchCategory,
                source_menu_item_name:
                    (dc.sourceMenuItem as { name?: string } | null)?.name ??
                    null,
                source_category_name:
                    (dc.sourceCategory as { name?: string } | null)?.name ??
                    null,
            })),
        };
    }

    /** Replace all deal components for a menu item. */
    async saveDealComponents(
        menuItemId: number,
        slots: Array<{
            slot_index: number;
            type: 'fixed' | 'choice_category' | 'choice_list';
            source_menu_item_id?: number | null;
            source_category_id?: number | null;
            source_menu_item_ids?: number[] | null;
            quantity: number;
            allow_customization: boolean;
            slot_surcharges?: Record<string, number> | null;
            slot_size_key?: string | null;
            allowed_size_keys?: string[] | null;
            mirror_slot_index?: number | null;
            mirror_match_size?: boolean;
            mirror_match_category?: boolean;
        }>,
    ) {
        const item = await this.itemRepo.findOne({ where: { id: menuItemId } });
        if (!item) throw new NotFoundException('Menu item not found');
        await this.dealComponentRepo.delete({ menuItemId });
        for (const s of slots) {
            await this.dealComponentRepo.save(
                this.dealComponentRepo.create({
                    menuItemId,
                    slotIndex: s.slot_index,
                    type: s.type,
                    sourceMenuItemId: s.source_menu_item_id ?? null,
                    sourceCategoryId: s.source_category_id ?? null,
                    sourceMenuItemIds: s.source_menu_item_ids ?? null,
                    quantity: s.quantity ?? 1,
                    allowCustomization: s.allow_customization ?? true,
                    slotSurcharges: normalizePriceBySize(s.slot_surcharges),
                    slotSizeKey: normalizeSizeKey(s.slot_size_key),
                    allowedSizeKeys: Array.isArray(s.allowed_size_keys)
                        ? s.allowed_size_keys.map((k) => String(k))
                        : null,
                    mirrorSlotIndex:
                        s.mirror_slot_index != null
                            ? Number(s.mirror_slot_index)
                            : null,
                    mirrorMatchSize: !!s.mirror_match_size,
                    mirrorMatchCategory: !!s.mirror_match_category,
                }),
            );
        }
        return this.getDealForAdmin(menuItemId);
    }

    /** Remove all deal components for a menu item (item becomes a normal menu item). */
    async deleteDealComponents(menuItemId: number) {
        const item = await this.itemRepo.findOne({ where: { id: menuItemId } });
        if (!item) throw new NotFoundException('Menu item not found');
        await this.dealComponentRepo.delete({ menuItemId });
        return { message: 'Deal components removed' };
    }

    /**
     * Build a single menu item in the same shape as getBranchMenu, for deal resolution.
     * Uses branch_menu_items when present; otherwise falls back to the menu item if its brand
     * is served at the branch (so deal-only items show in deal slot pickers even when not
     * explicitly linked to the branch).
     */
    private async getMenuItemForDealResolution(
        itemId: number,
        branchId: number,
        channel: OfferChannel | null = null,
    ): Promise<Awaited<ReturnType<MenuService['getBranchMenu']>>[0] | null> {
        const bmi = await this.branchMenuItemRepo.findOne({
            where: { branchId, menuItemId: itemId },
            relations: [
                'menuItem',
                'menuItem.category',
                'menuItem.variants',
                'menuItem.addons',
                'menuItem.modifierGroups',
                'menuItem.modifierGroups.modifiers',
            ],
        });
        let item: MenuItem | null = bmi?.menuItem ?? null;
        if (bmi?.isAvailable === false) return null;

        if (!item) {
            item = await this.itemRepo.findOne({
                where: { id: itemId },
                relations: [
                    'category',
                    'variants',
                    'addons',
                    'modifierGroups',
                    'modifierGroups.modifiers',
                ],
            });
            if (!item) return null;
            const branch = await this.branchRepo.findOne({
                where: { id: branchId },
                relations: ['branchBrands', 'branchBrands.brand'],
            });
            const branchBrandIds = new Set(
                (
                    (
                        branch as {
                            branchBrands?: Array<{
                                brandId?: number;
                                brand?: { id: number };
                            }>;
                        }
                    )?.branchBrands ?? []
                )
                    .map((bb) => bb.brandId ?? bb.brand?.id)
                    .filter((id): id is number => Number.isFinite(id)),
            );
            const itemBrandId =
                item.brandId ?? (item as { brand?: { id: number } }).brand?.id;
            if (
                !Number.isFinite(itemBrandId) ||
                !branchBrandIds.has(itemBrandId)
            )
                return null;
        }

        const price =
            bmi?.priceOverride != null
                ? Number(bmi.priceOverride)
                : await this.getEffectiveUnitPrice(branchId, itemId);
        const detailOffers = await this.loadPreviewOffers(
            item.brandId != null
                ? ((
                      (await this.brandRepo.findOne({
                          where: { id: item.brandId },
                      })) as { tenantId?: number } | null
                  )?.tenantId ?? null)
                : null,
        );
        return {
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            image_url: item.imageUrl ?? null,
            gallery_image_urls: galleryUrlsForApi(item),
            price,
            base_price: Number(item.basePrice ?? 0),
            ...this.previewFor(
                {
                    id: item.id,
                    categoryId: item.categoryId ?? item.category?.id,
                    brandId: item.brandId,
                },
                price,
                detailOffers,
                branchId,
                new Date(),
                channel,
            ),
            category: item.category?.name ?? null,
            category_id: item.categoryId ?? item.category?.id ?? null,
            brand_id:
                item.brandId ??
                (item as { brand?: { id: number } }).brand?.id ??
                null,
            available_for_order_types: effectiveMenuOrderChannels(
                item.availableForOrderTypes,
            ),
            ...itemMetaForApi(item),
            // Slot choices aren't individually time-gated; the deal root's window gates the deal.
            available_now: true,
            variants: [...(item.variants ?? [])]
                .sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )
                .map((v) => ({
                    id: v.id,
                    name: v.name,
                    price_modifier: Number(v.priceModifier),
                    size_key: v.sizeKey ?? null,
                    is_default: v.isDefault,
                    sort_order: v.sortOrder ?? 0,
                })),
            addons:
                item.addons?.map((a) => ({
                    id: a.id,
                    name: a.name,
                    price: Number(a.price),
                })) ?? [],
            modifier_groups:
                item.modifierGroups?.map((mg) => ({
                    id: mg.id,
                    name: mg.name,
                    min_select: mg.minSelect,
                    max_select: mg.maxSelect,
                    min_select_by_size: mg.minSelectBySize ?? null,
                    max_select_by_size: mg.maxSelectBySize ?? null,
                    included_quantity: mg.includedQuantity ?? 0,
                    included_by_size: mg.includedBySize ?? null,
                    allow_quantity: mg.allowQuantity ?? false,
                    price_tiers: mg.priceTiers ?? null,
                    hide_in_deals: mg.hideInDeals ?? false,
                    visible_when_modifier_ids:
                        mg.visibleWhenModifierIds ?? null,
                    modifiers: [...(mg.modifiers ?? [])]
                        .sort(
                            (a, b) =>
                                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                                a.id - b.id,
                        )
                        .map((m) => ({
                            id: m.id,
                            name: m.name,
                            price: Number(m.price),
                            price_by_size: m.priceBySize ?? null,
                            available_for_sizes: m.availableForSizes ?? null,
                            sort_order: m.sortOrder ?? 0,
                        })),
                })) ?? [],
        };
    }

    /**
     * Get deal definition by deal menu item id for POS. Returns null if not a deal.
     * Resolves choice slots to actual menu items available at the branch (same shape as getBranchMenu items).
     * Includes deal_only items so they appear in slot pickers and fixed slots show the correct name.
     */
    async getDealByMenuItemId(
        menuItemId: number,
        branchId: number,
        orderType?: string,
        channel: OfferChannel | null = null,
    ): Promise<{
        deal_menu_item_id: number;
        name: string;
        price: number;
        pricing_mode?: string | null;
        bogo_get_percent?: number | null;
        slots: Array<{
            slot_index: number;
            type: string;
            quantity: number;
            allow_customization: boolean;
            slot_surcharges?: Record<string, number> | null;
            slot_size_key?: string | null;
            allowed_size_keys?: string[] | null;
            mirror_slot_index?: number | null;
            mirror_match_size?: boolean;
            mirror_match_category?: boolean;
            source_menu_item_id?: number | null;
            choice_items?: Array<{
                id: number;
                name: string;
                price: number;
                base_price: number;
                category_id: number | null;
                brand_id: number | null;
                variants: Array<{
                    id: number;
                    name: string;
                    price_modifier: number;
                    size_key: string | null;
                }>;
                addons: Array<{ id: number; name: string; price: number }>;
                modifier_groups: Array<{
                    id: number;
                    name: string;
                    min_select: number;
                    max_select: number;
                    min_select_by_size: Record<string, number> | null;
                    max_select_by_size: Record<string, number> | null;
                    included_quantity: number;
                    included_by_size: Record<string, number> | null;
                    allow_quantity: boolean;
                    price_tiers: Record<string, number> | null;
                    hide_in_deals: boolean;
                    visible_when_modifier_ids: number[] | null;
                    modifiers: Array<{
                        id: number;
                        name: string;
                        price: number;
                        price_by_size: Record<string, number> | null;
                        available_for_sizes: string[] | null;
                    }>;
                }>;
            }>;
        }>;
    } | null> {
        const components = await this.dealComponentRepo.find({
            where: { menuItemId },
            order: { slotIndex: 'ASC' },
        });
        if (!components.length) return null;

        const dealItem = await this.itemRepo.findOne({
            where: { id: menuItemId },
            relations: [
                'variants',
                'addons',
                'modifierGroups',
                'modifierGroups.modifiers',
            ],
        });
        if (!dealItem) return null;

        const price = await this.getEffectiveUnitPrice(branchId, menuItemId);
        const branchMenu = await this.getBranchMenu(branchId);
        type BranchMenuItemShape = (typeof branchMenu)[0];
        const menuById = new Map<number, BranchMenuItemShape>();
        for (const it of branchMenu) {
            menuById.set(it.id, it);
        }

        // Include deal_only items referenced by this deal (fixed or choice_list) so they appear in POS
        const needIds = new Set<number>();
        for (const dc of components) {
            if (dc.type === 'fixed' && dc.sourceMenuItemId != null)
                needIds.add(dc.sourceMenuItemId);
            if (
                dc.type === 'choice_list' &&
                Array.isArray(dc.sourceMenuItemIds)
            )
                dc.sourceMenuItemIds.forEach((id) => needIds.add(id));
        }
        for (const id of needIds) {
            if (menuById.has(id)) continue;
            const resolved = await this.getMenuItemForDealResolution(
                id,
                branchId,
                channel,
            );
            if (resolved) menuById.set(id, resolved);
        }

        // Include deal_only items in choice_category: linked to branch and/or same brand as branch
        const branch = await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        const branchBrandIds = new Set(
            (
                (
                    branch as {
                        branchBrands?: Array<{
                            brandId?: number;
                            brand?: { id: number };
                        }>;
                    }
                )?.branchBrands ?? []
            )
                .map((bb) => bb.brandId ?? bb.brand?.id)
                .filter((id): id is number => Number.isFinite(id)),
        );
        for (const dc of components) {
            if (dc.type !== 'choice_category' || dc.sourceCategoryId == null)
                continue;
            const linkedInCategory = await this.branchMenuItemRepo.find({
                where: { branchId },
                relations: ['menuItem'],
            });
            for (const bmi of linkedInCategory) {
                const mi = bmi.menuItem;
                if (
                    !mi ||
                    mi.categoryId !== dc.sourceCategoryId ||
                    menuById.has(mi.id)
                )
                    continue;
                const resolved = await this.getMenuItemForDealResolution(
                    mi.id,
                    branchId,
                    channel,
                );
                if (resolved) menuById.set(mi.id, resolved);
            }
            if (branchBrandIds.size === 0) continue;
            const categoryItems = await this.itemRepo.find({
                where: {
                    categoryId: dc.sourceCategoryId,
                    brandId: In([...branchBrandIds]),
                },
                select: ['id'],
            });
            for (const mi of categoryItems) {
                if (menuById.has(mi.id)) continue;
                const resolved = await this.getMenuItemForDealResolution(
                    mi.id,
                    branchId,
                    channel,
                );
                if (resolved) menuById.set(mi.id, resolved);
            }
        }

        const menuByCategoryId = new Map<number, BranchMenuItemShape[]>();
        for (const it of menuById.values()) {
            const cid = it.category_id ?? 0;
            if (!menuByCategoryId.has(cid)) menuByCategoryId.set(cid, []);
            menuByCategoryId.get(cid)!.push(it);
        }

        const ot = orderType?.trim();
        const filterChoices = (items: BranchMenuItemShape[]) =>
            ot
                ? items.filter((it) =>
                      isMenuItemAvailableForOrderType(
                          it.available_for_order_types ?? null,
                          ot,
                      ),
                  )
                : items;

        // The consumer app renders the deal exactly as returned, so pre-apply POS's in-deal
        // restrictions (locked-size variants, no `hide_in_deals` cross-sell groups, no add-ons).
        // POS ('pos') receives the full shape and restricts client-side, so it is unaffected.
        const restrictForConsumer = channel === 'app';

        const slots = components.map((dc) => {
            const base = {
                slot_index: dc.slotIndex,
                type: dc.type,
                quantity: dc.quantity,
                optional: !!dc.optional,
                allow_customization: dc.allowCustomization,
                slot_surcharges: dc.slotSurcharges ?? null,
                slot_size_key: dc.slotSizeKey ?? null,
                allowed_size_keys: dc.allowedSizeKeys ?? null,
                mirror_slot_index: dc.mirrorSlotIndex ?? null,
                mirror_match_size: !!dc.mirrorMatchSize,
                mirror_match_category: !!dc.mirrorMatchCategory,
            };
            // Shape a slot's choices for the consumer channel (no-op for POS). Uses this slot's
            // size lock/whitelist so a 5-piece slot can't leak the 10-piece variant, etc.
            const shape = (
                items: BranchMenuItemShape[],
            ): BranchMenuItemShape[] =>
                restrictForConsumer
                    ? restrictDealChoiceItemsForConsumer(
                          items,
                          base.slot_size_key,
                          base.allowed_size_keys,
                      )
                    : items;
            if (dc.type === 'fixed' && dc.sourceMenuItemId != null) {
                const slotItem = menuById.get(dc.sourceMenuItemId);
                const choiceItems = shape(
                    filterChoices(slotItem ? [slotItem] : []),
                );
                return {
                    ...base,
                    source_menu_item_id: dc.sourceMenuItemId,
                    choice_items: choiceItems,
                };
            }
            if (dc.type === 'choice_category' && dc.sourceCategoryId != null) {
                const items = shape(
                    filterChoices(
                        menuByCategoryId.get(dc.sourceCategoryId) ?? [],
                    ),
                );
                return { ...base, choice_items: items };
            }
            if (
                dc.type === 'choice_list' &&
                Array.isArray(dc.sourceMenuItemIds)
            ) {
                const items = shape(
                    filterChoices(
                        dc.sourceMenuItemIds
                            .map((id) => menuById.get(id))
                            .filter(
                                (x): x is NonNullable<typeof x> => x != null,
                            ),
                    ),
                );
                return { ...base, choice_items: items };
            }
            return { ...base, choice_items: [] as BranchMenuItemShape[] };
        });

        return {
            deal_menu_item_id: menuItemId,
            name: dealItem.name,
            price,
            pricing_mode:
                (dealItem as { dealPricingMode?: string | null })
                    .dealPricingMode ?? null,
            bogo_get_percent:
                (dealItem as { dealBogoGetPercent?: number | null })
                    .dealBogoGetPercent != null
                    ? Number(
                          (dealItem as { dealBogoGetPercent?: number | null })
                              .dealBogoGetPercent,
                      )
                    : null,
            slots,
        };
    }

    /** Public: single menu item detail for a branch (consumer app). Includes deal structure when the item is a deal. */
    async getPublicMenuItemDetail(
        menuItemId: number,
        branchId: number,
        orderType?: string,
    ) {
        const bmi = await this.branchMenuItemRepo.findOne({
            where: { branchId, menuItemId },
            relations: [
                'menuItem',
                'menuItem.category',
                'menuItem.variants',
                'menuItem.addons',
                'menuItem.modifierGroups',
                'menuItem.modifierGroups.modifiers',
            ],
        });
        if (!bmi?.menuItem || bmi.isAvailable === false || bmi.isHiddenOnline)
            throw new NotFoundException('Menu item not found');
        const item = bmi.menuItem;
        if (
            orderType?.trim() &&
            !isMenuItemAvailableForOrderType(
                item.availableForOrderTypes,
                orderType,
            )
        ) {
            throw new NotFoundException('Menu item not found');
        }
        const price =
            bmi.priceOverride != null
                ? Number(bmi.priceOverride)
                : Number(item.basePrice ?? 0);
        const detailOffers = await this.loadPreviewOffers(
            item.brandId != null
                ? ((
                      (await this.brandRepo.findOne({
                          where: { id: item.brandId },
                      })) as { tenantId?: number } | null
                  )?.tenantId ?? null)
                : null,
        );
        const base = {
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            price,
            base_price: Number(item.basePrice ?? 0),
            ...this.previewFor(
                {
                    id: item.id,
                    categoryId: item.categoryId ?? item.category?.id,
                    brandId: item.brandId,
                },
                price,
                detailOffers,
                branchId,
                new Date(),
                'app',
            ),
            image_url: item.imageUrl ?? null,
            gallery_image_urls: galleryUrlsForApi(item),
            category: item.category?.name ?? null,
            category_id: item.categoryId ?? item.category?.id ?? null,
            brand_id: item.brandId ?? null,
            available_for_order_types: effectiveMenuOrderChannels(
                item.availableForOrderTypes,
            ),
            ...itemMetaForApi(item),
            // Slot choices aren't individually time-gated; the deal root's window gates the deal.
            available_now: true,
            variants: [...(item.variants ?? [])]
                .sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )
                .map((v) => ({
                    id: v.id,
                    name: v.name,
                    price_modifier: Number(v.priceModifier),
                    size_key: v.sizeKey ?? null,
                    is_default: v.isDefault,
                    sort_order: v.sortOrder ?? 0,
                })),
            addons:
                item.addons?.map((a) => ({
                    id: a.id,
                    name: a.name,
                    price: Number(a.price),
                })) ?? [],
            modifier_groups:
                item.modifierGroups?.map((mg) => ({
                    id: mg.id,
                    name: mg.name,
                    min_select: mg.minSelect,
                    max_select: mg.maxSelect,
                    min_select_by_size: mg.minSelectBySize ?? null,
                    max_select_by_size: mg.maxSelectBySize ?? null,
                    included_quantity: mg.includedQuantity ?? 0,
                    included_by_size: mg.includedBySize ?? null,
                    allow_quantity: mg.allowQuantity ?? false,
                    price_tiers: mg.priceTiers ?? null,
                    hide_in_deals: mg.hideInDeals ?? false,
                    visible_when_modifier_ids:
                        mg.visibleWhenModifierIds ?? null,
                    modifiers: [...(mg.modifiers ?? [])]
                        .sort(
                            (a, b) =>
                                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                                a.id - b.id,
                        )
                        .map((m) => ({
                            id: m.id,
                            name: m.name,
                            price: Number(m.price),
                            price_by_size: m.priceBySize ?? null,
                            available_for_sizes: m.availableForSizes ?? null,
                            sort_order: m.sortOrder ?? 0,
                        })),
                })) ?? [],
        };
        const deal = await this.getDealByMenuItemId(
            menuItemId,
            branchId,
            orderType,
            'app',
        );
        return { ...base, ...(deal ? { deal } : {}) };
    }

    /** Ensure brand belongs to tenant (for tenant users). */
    async assertBrandBelongsToTenant(brandId: number, tenantId: number) {
        const brand = await this.brandRepo.findOne({ where: { id: brandId } });
        if (!brand || brand.tenantId !== tenantId)
            throw new ForbiddenException(
                'Brand not found or does not belong to your tenant',
            );
    }

    async assertModifierGroupBelongsToTenant(
        modifierGroupId: number,
        tenantId: number,
    ) {
        const mg = await this.modifierGroupRepo.findOne({
            where: { id: modifierGroupId },
            select: ['brandId'],
        });
        if (!mg) throw new NotFoundException('Modifier group not found');
        await this.assertBrandBelongsToTenant(mg.brandId, tenantId);
    }

    /**
     * Brand that owns the given menu entity (variants and modifiers resolve
     * through their parent item / group). Null when the entity is missing.
     */
    async getEntityBrandId(
        kind:
            | 'category'
            | 'item'
            | 'addon'
            | 'variant'
            | 'modifier-group'
            | 'modifier',
        id: number,
    ): Promise<number | null> {
        switch (kind) {
            case 'category': {
                const row = await this.categoryRepo.findOne({
                    where: { id },
                    select: ['brandId'],
                });
                return row?.brandId ?? null;
            }
            case 'item': {
                const row = await this.itemRepo.findOne({
                    where: { id },
                    select: ['brandId'],
                });
                return row?.brandId ?? null;
            }
            case 'addon': {
                const row = await this.addonRepo.findOne({
                    where: { id },
                    select: ['brandId'],
                });
                return row?.brandId ?? null;
            }
            case 'variant': {
                const variant = await this.variantRepo.findOne({
                    where: { id },
                    select: ['menuItemId'],
                });
                if (!variant) return null;
                return this.getEntityBrandId('item', variant.menuItemId);
            }
            case 'modifier-group': {
                const row = await this.modifierGroupRepo.findOne({
                    where: { id },
                    select: ['brandId'],
                });
                return row?.brandId ?? null;
            }
            case 'modifier': {
                const mod = await this.modifierRepo.findOne({
                    where: { id },
                    select: ['modifierGroupId'],
                });
                if (!mod) return null;
                return this.getEntityBrandId(
                    'modifier-group',
                    mod.modifierGroupId,
                );
            }
        }
    }
}
