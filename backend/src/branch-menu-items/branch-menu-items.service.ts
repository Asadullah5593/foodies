import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { Branch } from '../entities/branch.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
import { MenuAddon } from '../entities/menu-addon.entity';
import { ActivityContext } from '../activity-log/activity-context';

@Injectable()
export class BranchMenuItemsService {
    constructor(
        @InjectRepository(BranchMenuItem)
        private repo: Repository<BranchMenuItem>,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
        @InjectRepository(MenuItem) private itemRepo: Repository<MenuItem>,
    ) {}

    /** Brand-locked admins only manage mappings for their own brand's items. */
    private filterByBrand<T extends { menuItem?: { brandId?: number } }>(
        list: T[],
        allowedBrandIds?: number[] | null,
    ): T[] {
        if (allowedBrandIds == null) return list;
        return list.filter(
            (x) =>
                x.menuItem?.brandId != null &&
                allowedBrandIds.includes(x.menuItem.brandId),
        );
    }

    private async assertMenuItemBrandAllowed(
        menuItemId: number,
        allowedBrandIds?: number[] | null,
    ): Promise<void> {
        if (allowedBrandIds == null) return;
        const item = await this.itemRepo.findOne({
            where: { id: menuItemId },
            select: ['brandId'],
        });
        if (!item || !allowedBrandIds.includes(item.brandId)) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
    }

    /** All branch menu items for tenant's branches (or all branches when tenantId is null). */
    async findAllForAdmin(
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        let branchIds: number[];
        if (tenantId != null) {
            const qb = this.branchRepo
                .createQueryBuilder('b')
                .innerJoin('b.branchBrands', 'bb')
                .innerJoin('bb.brand', 'brand', 'brand.tenantId = :tenantId', {
                    tenantId,
                })
                .select('b.id');
            const rows = await qb.getMany();
            branchIds = rows.map((b) => b.id);
        } else {
            const branches = await this.branchRepo.find({ select: ['id'] });
            branchIds = branches.map((b) => b.id);
        }
        if (branchIds.length === 0) return [];
        const list = await this.repo.find({
            where: { branchId: In(branchIds) },
            relations: [
                'menuItem',
                'menuItem.category',
                'menuItem.variants',
                'menuItem.addons',
                'branch',
            ],
            order: { branchId: 'ASC', id: 'ASC' },
        });
        return this.filterByBrand(list, allowedBrandIds).map((item) =>
            this.toItemResponse(item),
        );
    }

    private toItemResponse(
        item: BranchMenuItem & {
            menuItem?: MenuItem & {
                category?: { id: number; name: string };
                variants?: MenuVariant[];
                addons?: MenuAddon[];
            };
            branch?: { name: string; code: string };
        },
    ) {
        return {
            id: item.id,
            branch_id: item.branchId,
            menu_item_id: item.menuItemId,
            price_override:
                item.priceOverride != null ? Number(item.priceOverride) : null,
            is_enabled: item.isAvailable,
            is_hidden_online: item.isHiddenOnline,
            branch_name: item.branch?.name,
            branch_code: item.branch?.code,
            menu_item: item.menuItem
                ? {
                      id: item.menuItem.id,
                      name: item.menuItem.name,
                      base_price: Number(item.menuItem.basePrice),
                      category: item.menuItem.category
                          ? {
                                id: item.menuItem.category.id,
                                name: item.menuItem.category.name,
                            }
                          : null,
                      variants: [...(item.menuItem.variants ?? [])]
                          .sort(
                              (a, b) =>
                                  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
                                  a.id - b.id,
                          )
                          .map((v: MenuVariant) => ({
                              id: v.id,
                              name: v.name,
                              price_modifier: Number(v.priceModifier),
                              is_default: v.isDefault,
                              sort_order: v.sortOrder ?? 0,
                          })),
                      addons: (item.menuItem.addons ?? []).map(
                          (a: MenuAddon) => ({
                              id: a.id,
                              name: a.name,
                              price: Number(a.price),
                          }),
                      ),
                  }
                : null,
        };
    }

    async findAll(branchId: number, allowedBrandIds?: number[] | null) {
        const list = await this.repo.find({
            where: { branchId },
            relations: [
                'menuItem',
                'menuItem.category',
                'menuItem.variants',
                'menuItem.addons',
            ],
            order: { id: 'ASC' },
        });
        return this.filterByBrand(list, allowedBrandIds).map((item) =>
            this.toItemResponse(item),
        );
    }

    /**
     * Link a brand-owned menu item to a branch (mapping only: price/availability/visibility).
     * No copies; branch_menu_items points to the brand's menu_item_id.
     */
    async linkBrandMenuItem(
        dto: {
            branch_id: number;
            menu_item_id: number;
            price_override?: number;
            is_enabled?: boolean;
            is_hidden_online?: boolean;
        },
        allowedBrandIds?: number[] | null,
    ) {
        await this.assertMenuItemBrandAllowed(
            dto.menu_item_id,
            allowedBrandIds,
        );
        type BranchWithBrands = Branch & {
            branchBrands: Array<{ brandId: number }>;
        };
        const branch = (await this.branchRepo.findOne({
            where: { id: dto.branch_id },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as BranchWithBrands | null;
        if (!branch || !branch.branchBrands?.length)
            throw new NotFoundException('Branch not found');
        const brandIds = branch.branchBrands.map((bb) => bb.brandId);

        const item = await this.itemRepo.findOne({
            where: { id: dto.menu_item_id },
            relations: ['variants', 'addons'],
        });
        if (!item) throw new NotFoundException('Menu item not found');
        if (!brandIds.includes(item.brandId))
            throw new ForbiddenException(
                'Menu item does not belong to a brand at this branch',
            );

        let bmi = await this.repo.findOne({
            where: { branchId: dto.branch_id, menuItemId: dto.menu_item_id },
        });
        if (bmi) {
            bmi.priceOverride =
                dto.price_override !== undefined
                    ? dto.price_override
                    : bmi.priceOverride;
            bmi.isAvailable =
                dto.is_enabled !== undefined ? dto.is_enabled : bmi.isAvailable;
            bmi.isHiddenOnline =
                dto.is_hidden_online !== undefined
                    ? dto.is_hidden_online
                    : bmi.isHiddenOnline;
            await this.repo.save(bmi);
        } else {
            bmi = await this.repo.save(
                this.repo.create({
                    branchId: dto.branch_id,
                    menuItemId: dto.menu_item_id,
                    priceOverride: dto.price_override ?? null,
                    isAvailable: dto.is_enabled ?? true,
                    isHiddenOnline: dto.is_hidden_online ?? false,
                }),
            );
        }
        return this.findAll(dto.branch_id).then(
            (list) => list.find((x) => x.id === bmi.id) ?? bmi,
        );
    }

    /**
     * Sync branch's linked menu items (brand-level menu_item ids).
     * Adds missing mappings, removes mappings not in the list. No copy-on-link.
     */
    async sync(
        branchId: number,
        menuItemIds: number[],
        allowedBrandIds?: number[] | null,
    ) {
        const desired = new Set(
            (menuItemIds ?? [])
                .map((x) => +x)
                .filter((x) => Number.isFinite(x)),
        );
        // Ignore items whose brand is not (or no longer) linked to this branch.
        // The branch-edit UI can submit stale ids (e.g. after switching brands);
        // silently dropping them prevents a 403 and avoids re-creating orphans.
        if (desired.size) {
            const branch = (await this.branchRepo.findOne({
                where: { id: branchId },
                relations: ['branchBrands'],
            })) as
                | (Branch & { branchBrands?: Array<{ brandId: number }> })
                | null;
            const branchBrandIds = new Set(
                (branch?.branchBrands ?? []).map((bb) => bb.brandId),
            );
            const items = await this.itemRepo.find({
                where: { id: In([...desired]) },
                select: ['id', 'brandId'],
            });
            const itemBrand = new Map(items.map((i) => [i.id, i.brandId]));
            for (const menuItemId of [...desired]) {
                const brandId = itemBrand.get(menuItemId);
                if (brandId == null || !branchBrandIds.has(brandId)) {
                    desired.delete(menuItemId);
                }
            }
        }
        for (const menuItemId of desired) {
            await this.assertMenuItemBrandAllowed(menuItemId, allowedBrandIds);
        }
        const existingAll = await this.repo.find({
            where: { branchId },
            relations: ['menuItem'],
        });
        // Brand-locked admins only sync their own brand's mappings — other
        // brands' rows must survive untouched.
        const existing = this.filterByBrand(existingAll, allowedBrandIds);
        const existingByMenuItem = new Map(
            existing.map((e) => [e.menuItemId, e]),
        );

        const toRemove = existing.filter((e) => !desired.has(e.menuItemId));
        if (toRemove.length) await this.repo.remove(toRemove);

        for (const menuItemId of desired) {
            if (existingByMenuItem.has(menuItemId)) continue;
            await this.linkBrandMenuItem(
                {
                    branch_id: branchId,
                    menu_item_id: menuItemId,
                    is_enabled: true,
                },
                allowedBrandIds,
            );
        }

        return this.findAll(branchId, allowedBrandIds);
    }

    async update(
        id: number,
        dto: {
            price_override?: number | null;
            is_enabled?: boolean;
            is_hidden_online?: boolean;
        },
        allowedBrandIds?: number[] | null,
    ) {
        const item = await this.repo.findOne({
            where: { id },
            relations: [
                'menuItem',
                'menuItem.category',
                'menuItem.variants',
                'menuItem.addons',
            ],
        });
        if (!item) throw new NotFoundException('Branch menu item not found');
        if (
            allowedBrandIds != null &&
            (item.menuItem?.brandId == null ||
                !allowedBrandIds.includes(item.menuItem.brandId))
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        // Per-branch price overrides are where a till's prices actually come
        // from, so a change here matters as much as the brand-level price.
        const auditBefore = {
            price_override: item.priceOverride,
            // The column is isAvailable; the API calls it is_enabled.
            is_enabled: item.isAvailable,
            is_hidden_online: item.isHiddenOnline,
        };
        if (dto.price_override !== undefined)
            item.priceOverride =
                dto.price_override != null ? Number(dto.price_override) : null;
        if (dto.is_enabled !== undefined) item.isAvailable = dto.is_enabled;
        if (dto.is_hidden_online !== undefined)
            item.isHiddenOnline = dto.is_hidden_online;
        await this.repo.save(item);
        ActivityContext.recordChange(
            'branch_menu_item',
            item.id,
            auditBefore,
            {
                price_override: item.priceOverride,
                is_enabled: item.isAvailable,
                is_hidden_online: item.isHiddenOnline,
            },
            item.menuItem?.name ?? null,
        );
        return {
            id: item.id,
            branch_id: item.branchId,
            menu_item_id: item.menuItemId,
            price_override:
                item.priceOverride != null ? Number(item.priceOverride) : null,
            is_enabled: item.isAvailable,
            is_hidden_online: item.isHiddenOnline,
            menu_item: item.menuItem
                ? {
                      id: item.menuItem.id,
                      name: item.menuItem.name,
                      base_price: Number(item.menuItem.basePrice),
                      category: item.menuItem.category
                          ? {
                                id: item.menuItem.category.id,
                                name: item.menuItem.category.name,
                            }
                          : null,
                      variants: [...(item.menuItem.variants ?? [])]
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
                      addons: (item.menuItem.addons ?? []).map((a) => ({
                          id: a.id,
                          name: a.name,
                          price: Number(a.price),
                      })),
                  }
                : null,
        };
    }

    async remove(id: number, allowedBrandIds?: number[] | null) {
        const item = await this.repo.findOne({
            where: { id },
            relations: ['menuItem'],
        });
        if (!item) throw new NotFoundException('Branch menu item not found');
        if (
            allowedBrandIds != null &&
            (item.menuItem?.brandId == null ||
                !allowedBrandIds.includes(item.menuItem.brandId))
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        await this.repo.remove(item);
        return { message: 'Branch menu item deleted successfully' };
    }
}
