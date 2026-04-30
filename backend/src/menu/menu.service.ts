import {
    Injectable,
    NotFoundException,
    ForbiddenException,
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
import { MenuVariant } from '../entities/menu-variant.entity';
import { ModifierGroup } from '../entities/modifier-group.entity';
import { Modifier } from '../entities/modifier.entity';
import { MediaStorageService } from '../media/media-storage.service';
import {
    effectiveMenuOrderChannels,
    isMenuItemAvailableForOrderType,
    parseMenuOrderChannelsInput,
} from '../utils/menu-order-type';

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
        private mediaStorage: MediaStorageService,
    ) {}

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
     * Consumer API: list unique category names across all active brands for a tenant.
     * Used to show a single "Milkshakes" category even if multiple brands define it.
     */
    async getConsumerCategoriesForTenant(tenantId: number) {
        const rows = await this.categoryRepo
            .createQueryBuilder('c')
            .innerJoin('c.brand', 'b')
            .where('b.tenantId = :tenantId', { tenantId })
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
     * Consumer API: for a given category key (normalized name), return ids of active brands that have this category.
     * The caller (e.g. BrandsService) is responsible for mapping ids to full brand responses.
     */
    async getConsumerBrandIdsForCategoryKey(
        tenantId: number,
        categoryKey: string,
    ): Promise<number[]> {
        const key = categoryKey.toLowerCase();
        const rawBrandIds = await this.categoryRepo
            .createQueryBuilder('c')
            .innerJoin('c.brand', 'b')
            .where('b.tenantId = :tenantId', { tenantId })
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
            base_price: Number(i.basePrice),
            is_active: i.isActive,
            deal_only: i.dealOnly ?? false,
            available_for_order_types: effectiveMenuOrderChannels(
                i.availableForOrderTypes,
            ),
            category: i.category
                ? { id: i.category.id, name: i.category.name }
                : null,
            variants: (i.variants ?? []).map((v) => ({
                id: v.id,
                menu_item_id: v.menuItemId,
                name: v.name,
                price_modifier: Number(v.priceModifier),
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
        deal_only?: boolean;
        /** Omit or null = available on all channels (delivery, pickup, dine_in). */
        available_for_order_types?: string[] | null;
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
                basePrice: dto.base_price,
                isActive: dto.is_active ?? true,
                dealOnly: dto.deal_only ?? false,
                availableForOrderTypes:
                    dto.available_for_order_types != null
                        ? parseMenuOrderChannelsInput(
                              dto.available_for_order_types,
                          )
                        : null,
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
            deal_only?: boolean;
            available_for_order_types?: string[] | null;
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
        if (dto.base_price !== undefined) item.basePrice = dto.base_price;
        if (dto.is_active !== undefined) item.isActive = dto.is_active;

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
    async getModifierGroups(brandId: number | null, tenantId?: number | null) {
        const qb = this.modifierGroupRepo
            .createQueryBuilder('mg')
            .leftJoinAndSelect('mg.modifiers', 'm')
            .orderBy('mg.id', 'ASC')
            .addOrderBy('m.id', 'ASC');
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
            modifiers: (mg.modifiers ?? []).map((m) => ({
                id: m.id,
                modifier_group_id: m.modifierGroupId,
                name: m.name,
                price: Number(m.price),
            })),
        }));
    }

    async createModifierGroup(dto: {
        brand_id: number;
        name: string;
        min_select?: number;
        max_select?: number;
    }) {
        const mg = await this.modifierGroupRepo.save(
            this.modifierGroupRepo.create({
                brandId: dto.brand_id,
                name: dto.name,
                minSelect: dto.min_select ?? 0,
                maxSelect: dto.max_select ?? 1,
            }),
        );
        return {
            id: mg.id,
            brand_id: mg.brandId,
            name: mg.name,
            min_select: mg.minSelect,
            max_select: mg.maxSelect,
            modifiers: [],
        };
    }

    async updateModifierGroup(
        id: number,
        dto: { name?: string; min_select?: number; max_select?: number },
    ) {
        const mg = await this.modifierGroupRepo.findOne({ where: { id } });
        if (!mg) throw new NotFoundException('Modifier group not found');
        if (dto.name !== undefined) mg.name = dto.name;
        if (dto.min_select !== undefined) mg.minSelect = dto.min_select;
        if (dto.max_select !== undefined) mg.maxSelect = dto.max_select;
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
            .orderBy('m.id', 'ASC');
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
            modifier_group_name: m.modifierGroup?.name,
        }));
    }

    async createModifier(dto: {
        modifier_group_id: number;
        name: string;
        price?: number;
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
            }),
        );
        return {
            id: m.id,
            modifier_group_id: m.modifierGroupId,
            name: m.name,
            price: Number(m.price),
        };
    }

    async updateModifier(id: number, dto: { name?: string; price?: number }) {
        const m = await this.modifierRepo.findOne({ where: { id } });
        if (!m) throw new NotFoundException('Modifier not found');
        if (dto.name !== undefined) m.name = dto.name;
        if (dto.price !== undefined) m.price = dto.price;
        await this.modifierRepo.save(m);
        return m;
    }

    async deleteModifier(id: number) {
        const m = await this.modifierRepo.findOne({ where: { id } });
        if (!m) throw new NotFoundException('Modifier not found');
        await this.modifierRepo.remove(m);
        return { message: 'Modifier deleted' };
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
    }) {
        return this.variantRepo.save(
            this.variantRepo.create({
                menuItemId: dto.menu_item_id,
                name: dto.name,
                priceModifier: dto.price_modifier ?? 0,
                isDefault: dto.is_default ?? false,
                sortOrder: dto.sort_order ?? 0,
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
        if (!branch.menuEnabled) return [];

        let linked = (branch.branchMenuItems ?? [])
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
                price,
                base_price: Number(item?.basePrice ?? 0),
                category: item?.category?.name,
                category_id: item?.categoryId ?? item?.category?.id ?? null,
                brand_id:
                    item?.brandId ??
                    (item?.brand as { id: number } | undefined)?.id ??
                    null,
                available_for_order_types: effectiveMenuOrderChannels(
                    item?.availableForOrderTypes ?? null,
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
                        is_default: v.isDefault,
                        sort_order: v.sortOrder ?? 0,
                    })),
                addons:
                    item?.addons?.map((a) => ({
                        id: a.id,
                        name: a.name,
                        price: Number(a.price),
                    })) ?? [],
                modifier_groups:
                    item?.modifierGroups?.map((mg) => ({
                        id: mg.id,
                        name: mg.name,
                        min_select: mg.minSelect,
                        max_select: mg.maxSelect,
                        modifiers: (mg.modifiers ?? []).map((m) => ({
                            id: m.id,
                            name: m.name,
                            price: Number(m.price),
                        })),
                    })) ?? [],
            };
        });
    }

    /**
     * Consumer web home/menu: return menu items for a brand scoped to a tenant,
     * independent of branch availability and order type.
     *
     * Pricing uses the menu item's base_price (no branch overrides).
     */
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
                        modifiers: (mg.modifiers ?? []).map((m) => ({
                            id: m.id,
                            name: m.name,
                            price: Number(m.price),
                        })),
                    })) ?? [],
            };
        });
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
            slot_count: countMap.get(i.id) ?? 0,
        }));
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
        return {
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            image_url: item.imageUrl ?? null,
            price,
            base_price: Number(item.basePrice ?? 0),
            category: item.category?.name ?? null,
            category_id: item.categoryId ?? item.category?.id ?? null,
            brand_id:
                item.brandId ??
                (item as { brand?: { id: number } }).brand?.id ??
                null,
            available_for_order_types: effectiveMenuOrderChannels(
                item.availableForOrderTypes,
            ),
            variants: [...(item.variants ?? [])]
                .sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )
                .map((v) => ({
                    id: v.id,
                    name: v.name,
                    price_modifier: Number(v.priceModifier),
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
                    modifiers: (mg.modifiers ?? []).map((m) => ({
                        id: m.id,
                        name: m.name,
                        price: Number(m.price),
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
    ): Promise<{
        deal_menu_item_id: number;
        name: string;
        price: number;
        slots: Array<{
            slot_index: number;
            type: string;
            quantity: number;
            allow_customization: boolean;
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
                }>;
                addons: Array<{ id: number; name: string; price: number }>;
                modifier_groups: Array<{
                    id: number;
                    name: string;
                    min_select: number;
                    max_select: number;
                    modifiers: Array<{
                        id: number;
                        name: string;
                        price: number;
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

        const slots = components.map((dc) => {
            const base = {
                slot_index: dc.slotIndex,
                type: dc.type,
                quantity: dc.quantity,
                allow_customization: dc.allowCustomization,
            };
            if (dc.type === 'fixed' && dc.sourceMenuItemId != null) {
                const slotItem = menuById.get(dc.sourceMenuItemId);
                const choiceItems = filterChoices(slotItem ? [slotItem] : []);
                return {
                    ...base,
                    source_menu_item_id: dc.sourceMenuItemId,
                    choice_items: choiceItems,
                };
            }
            if (dc.type === 'choice_category' && dc.sourceCategoryId != null) {
                const items = filterChoices(
                    menuByCategoryId.get(dc.sourceCategoryId) ?? [],
                );
                return { ...base, choice_items: items };
            }
            if (
                dc.type === 'choice_list' &&
                Array.isArray(dc.sourceMenuItemIds)
            ) {
                const items = filterChoices(
                    dc.sourceMenuItemIds
                        .map((id) => menuById.get(id))
                        .filter((x): x is NonNullable<typeof x> => x != null),
                );
                return { ...base, choice_items: items };
            }
            return { ...base, choice_items: [] as BranchMenuItemShape[] };
        });

        return {
            deal_menu_item_id: menuItemId,
            name: dealItem.name,
            price,
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
        const base = {
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            price,
            base_price: Number(item.basePrice ?? 0),
            image_url: item.imageUrl ?? null,
            category: item.category?.name ?? null,
            category_id: item.categoryId ?? item.category?.id ?? null,
            brand_id: item.brandId ?? null,
            available_for_order_types: effectiveMenuOrderChannels(
                item.availableForOrderTypes,
            ),
            variants: [...(item.variants ?? [])]
                .sort(
                    (a, b) =>
                        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id,
                )
                .map((v) => ({
                    id: v.id,
                    name: v.name,
                    price_modifier: Number(v.priceModifier),
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
                    modifiers: (mg.modifiers ?? []).map((m) => ({
                        id: m.id,
                        name: m.name,
                        price: Number(m.price),
                    })),
                })) ?? [],
        };
        const deal = await this.getDealByMenuItemId(
            menuItemId,
            branchId,
            orderType,
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
}
