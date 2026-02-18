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
import { MenuAddon } from '../entities/menu-addon.entity';
import { MenuCategory } from '../entities/menu-category.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuVariant } from '../entities/menu-variant.entity';

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
    async getItems(brandId: number | null, tenantId?: number | null) {
        const qb = this.itemRepo
            .createQueryBuilder('i')
            .leftJoinAndSelect('i.category', 'c')
            .leftJoinAndSelect('i.variants', 'v')
            .leftJoinAndSelect('i.addons', 'a')
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

        const items = await qb.getMany();
        return items.map((i) => ({
            id: i.id,
            brand_id: i.brandId,
            category_id: i.categoryId,
            name: i.name,
            slug: i.slug,
            description: i.description,
            base_price: Number(i.basePrice),
            is_active: i.isActive,
            category: i.category
                ? { id: i.category.id, name: i.category.name }
                : null,
            variants: (i.variants ?? []).map((v) => ({
                id: v.id,
                menu_item_id: v.menuItemId,
                name: v.name,
                price_modifier: Number(v.priceModifier),
                is_default: v.isDefault,
            })),
            addons: (i.addons ?? []).map((a) => ({
                id: a.id,
                name: a.name,
                price: Number(a.price),
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
                basePrice: dto.base_price,
                isActive: dto.is_active ?? true,
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
        },
    ) {
        const item = await this.itemRepo.findOne({ where: { id } });
        if (!item) throw new NotFoundException('Menu item not found');

        if (dto.brand_id !== undefined) item.brandId = dto.brand_id;
        if (dto.category_id !== undefined) item.categoryId = dto.category_id;
        if (dto.name !== undefined) {
            item.name = dto.name;
            item.slug = dto.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        }
        if (dto.description !== undefined) item.description = dto.description;
        if (dto.base_price !== undefined) item.basePrice = dto.base_price;
        if (dto.is_active !== undefined) item.isActive = dto.is_active;

        await this.itemRepo.save(item);

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

    /** List addons for a brand, or all addons for tenant when brandId is null. */
    async getAddons(
        brandId: number | null,
        categoryId?: number,
        tenantId?: number | null,
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
            order: { id: 'ASC' },
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
            .orderBy('v.id', 'ASC');
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
    }) {
        return this.variantRepo.save(
            this.variantRepo.create({
                menuItemId: dto.menu_item_id,
                name: dto.name,
                priceModifier: dto.price_modifier ?? 0,
                isDefault: dto.is_default ?? false,
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
        },
    ) {
        const v = await this.variantRepo.findOne({ where: { id } });
        if (!v) throw new NotFoundException('Variant not found');
        if (dto.menu_item_id !== undefined) v.menuItemId = dto.menu_item_id;
        if (dto.name !== undefined) v.name = dto.name;
        if (dto.price_modifier !== undefined)
            v.priceModifier = dto.price_modifier;
        if (dto.is_default !== undefined) v.isDefault = dto.is_default;
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
        options?: { includeHiddenOnline?: boolean },
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
            ],
        });
        type BranchWithBrands = Branch & { branchBrands?: unknown[] };
        if (!branch || !(branch as BranchWithBrands).branchBrands?.length)
            return [];
        if (!branch.menuEnabled) return [];

        const linked = (branch.branchMenuItems ?? [])
            .filter((bmi) => bmi.isAvailable !== false)
            .filter(
                (bmi) =>
                    options?.includeHiddenOnline !== false ||
                    !bmi.isHiddenOnline,
            )
            .sort(
                (a, b) =>
                    (a.menuItem?.sortOrder ?? 0) -
                        (b.menuItem?.sortOrder ?? 0) || a.id - b.id,
            );

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
                price,
                base_price: Number(item?.basePrice ?? 0),
                category: item?.category?.name,
                category_id: item?.categoryId ?? item?.category?.id ?? null,
                brand_id:
                    item?.brandId ??
                    (item?.brand as { id: number } | undefined)?.id ??
                    null,
                variants:
                    item?.variants?.map((v) => ({
                        id: v.id,
                        name: v.name,
                        price_modifier: Number(v.priceModifier),
                    })) ?? [],
                addons:
                    item?.addons?.map((a) => ({
                        id: a.id,
                        name: a.name,
                        price: Number(a.price),
                    })) ?? [],
            };
        });
    }

    async findMenuItem(id: number) {
        return this.itemRepo.findOne({
            where: { id },
            relations: ['variants', 'addons', 'brand'],
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

    /** Ensure brand belongs to tenant (for tenant users). */
    async assertBrandBelongsToTenant(brandId: number, tenantId: number) {
        const brand = await this.brandRepo.findOne({ where: { id: brandId } });
        if (!brand || brand.tenantId !== tenantId)
            throw new ForbiddenException(
                'Brand not found or does not belong to your tenant',
            );
    }
}
