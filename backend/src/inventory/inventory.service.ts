import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BranchesService } from '../branches/branches.service';
import { Uom } from '../entities/uom.entity';
import { Vendor } from '../entities/vendor.entity';
import { InventoryItem } from '../entities/inventory-item.entity';
import { InventoryItemBranchSetting } from '../entities/inventory-item-branch-setting.entity';
import { InventoryLocation } from '../entities/inventory-location.entity';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { InventoryOnHand } from '../entities/inventory-on-hand.entity';
import { InventoryBatchOnHand } from '../entities/inventory-batch-on-hand.entity';
import { InventoryLedgerEntry } from '../entities/inventory-ledger-entry.entity';
import { WastageEvent } from '../entities/wastage-event.entity';
import { InventoryItemCost } from '../entities/inventory-item-cost.entity';
import { Stocktake } from '../entities/stocktake.entity';
import { StocktakeLine } from '../entities/stocktake-line.entity';
import { BranchBrand } from '../entities/branch-brand.entity';

type TenantContextUser = {
    id: number;
    tenantId: number | null;
    isSuperAdmin?: boolean;
};

@Injectable()
export class InventoryService {
    constructor(
        private dataSource: DataSource,
        private branchesService: BranchesService,
        @InjectRepository(Uom) private uomsRepo: Repository<Uom>,
        @InjectRepository(Vendor) private vendorsRepo: Repository<Vendor>,
        @InjectRepository(InventoryItem)
        private itemsRepo: Repository<InventoryItem>,
        @InjectRepository(InventoryItemBranchSetting)
        private itemBranchSettingsRepo: Repository<InventoryItemBranchSetting>,
        @InjectRepository(InventoryLocation)
        private locationsRepo: Repository<InventoryLocation>,
        @InjectRepository(InventoryBatch)
        private batchesRepo: Repository<InventoryBatch>,
        @InjectRepository(InventoryOnHand)
        private onHandRepo: Repository<InventoryOnHand>,
        @InjectRepository(InventoryBatchOnHand)
        private batchOnHandRepo: Repository<InventoryBatchOnHand>,
        @InjectRepository(InventoryLedgerEntry)
        private ledgerRepo: Repository<InventoryLedgerEntry>,
        @InjectRepository(WastageEvent)
        private wastageRepo: Repository<WastageEvent>,
        @InjectRepository(InventoryItemCost)
        private itemCostsRepo: Repository<InventoryItemCost>,
        @InjectRepository(Stocktake)
        private stocktakesRepo: Repository<Stocktake>,
        @InjectRepository(StocktakeLine)
        private stocktakeLinesRepo: Repository<StocktakeLine>,
        @InjectRepository(BranchBrand)
        private branchBrandsRepo: Repository<BranchBrand>,
    ) {}

    async resolveTenantId(user: TenantContextUser, branchId?: number) {
        if (user.tenantId != null) return user.tenantId;
        if (user.isSuperAdmin === true) {
            if (branchId == null) {
                throw new ForbiddenException(
                    'Branch context required for super admin',
                );
            }
            const tenantId =
                await this.branchesService.getPrimaryTenantId(branchId);
            if (tenantId == null)
                throw new NotFoundException('No tenant found');
            return tenantId;
        }
        throw new ForbiddenException('Tenant context required');
    }

    /** Resolve tenant for a brand-scoped read (tenant user → own tenant; super admin → brand's tenant). */
    async resolveTenantIdForBrand(
        user: TenantContextUser,
        brandId: number,
    ): Promise<number> {
        if (user.tenantId != null) return user.tenantId;
        if (user.isSuperAdmin === true) {
            const rows: Array<{ tenant_id: number }> =
                await this.dataSource.query(
                    `SELECT tenant_id FROM brands WHERE id = $1`,
                    [brandId],
                );
            if (!rows.length) throw new NotFoundException('Brand not found');
            return Number(rows[0].tenant_id);
        }
        throw new ForbiddenException('Tenant context required');
    }

    // ---------------- UOMs ----------------
    listUoms(tenantId: number) {
        return this.uomsRepo.find({
            where: { tenantId, isActive: true },
            order: { code: 'ASC' },
        });
    }

    async createUom(
        tenantId: number,
        dto: {
            name: string;
            code: string;
            kind?: string;
            base_uom_id?: number | null;
            multiplier_to_base?: number | null;
        },
    ) {
        const name = String(dto.name ?? '').trim();
        const code = String(dto.code ?? '').trim();
        if (!name) throw new BadRequestException('Name is required');
        if (!code) throw new BadRequestException('Code is required');
        const kind = this.normalizeUomKind(dto.kind);
        const cfg = await this.normalizeUomConversionConfig({
            tenantId,
            kind,
            baseUomIdRaw: dto.base_uom_id,
            multiplierRaw: dto.multiplier_to_base,
        });
        const uom = this.uomsRepo.create({
            tenantId,
            name,
            code,
            kind,
            baseUomId: cfg.baseUomId,
            multiplierToBase: cfg.multiplierToBase,
            isActive: true,
        });
        return this.uomsRepo.save(uom);
    }

    async updateUom(
        tenantId: number,
        uomId: number,
        dto: {
            name?: string;
            code?: string;
            kind?: string;
            base_uom_id?: number | null;
            multiplier_to_base?: number | null;
        },
    ) {
        const uom = await this.uomsRepo.findOne({
            where: { tenantId, id: uomId, isActive: true },
        });
        if (!uom) throw new NotFoundException('Unit of measure not found');
        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name is required');
            uom.name = name;
        }
        if (dto.code !== undefined) {
            const code = String(dto.code).trim();
            if (!code) throw new BadRequestException('Code is required');
            uom.code = code;
        }
        const nextKind = this.normalizeUomKind(dto.kind ?? uom.kind);
        const shouldUpdateConversion =
            dto.kind !== undefined ||
            dto.base_uom_id !== undefined ||
            dto.multiplier_to_base !== undefined;
        if (shouldUpdateConversion) {
            const cfg = await this.normalizeUomConversionConfig({
                tenantId,
                kind: nextKind,
                baseUomIdRaw:
                    dto.base_uom_id !== undefined
                        ? dto.base_uom_id
                        : uom.baseUomId,
                multiplierRaw:
                    dto.multiplier_to_base !== undefined
                        ? dto.multiplier_to_base
                        : uom.multiplierToBase,
                currentUomId: uom.id,
            });
            uom.kind = nextKind;
            uom.baseUomId = cfg.baseUomId;
            uom.multiplierToBase = cfg.multiplierToBase;
        } else {
            uom.kind = nextKind;
        }
        return this.uomsRepo.save(uom);
    }

    private normalizeUomKind(kindRaw?: string): string {
        const kind = String(kindRaw ?? 'count')
            .trim()
            .toLowerCase();
        const allowed = new Set([
            'count',
            'mass',
            'volume',
            'length',
            'area',
            'time',
            'energy',
            'pressure',
            'power',
            'frequency',
            'speed',
            'flow',
        ]);
        if (!allowed.has(kind)) {
            throw new BadRequestException(`Unsupported UOM kind: ${kind}`);
        }
        return kind;
    }

    private async normalizeUomConversionConfig(args: {
        tenantId: number;
        kind: string;
        baseUomIdRaw?: number | null;
        multiplierRaw?: number | null;
        currentUomId?: number;
    }): Promise<{ baseUomId: number | null; multiplierToBase: number | null }> {
        const hasBase =
            args.baseUomIdRaw !== undefined &&
            args.baseUomIdRaw !== null &&
            String(args.baseUomIdRaw).trim() !== '';
        if (!hasBase) {
            return { baseUomId: null, multiplierToBase: null };
        }
        const baseUomId = Number(args.baseUomIdRaw);
        if (!Number.isInteger(baseUomId) || baseUomId <= 0) {
            throw new BadRequestException(
                'base_uom_id must be a valid unit id',
            );
        }
        if (
            args.currentUomId != null &&
            Number(baseUomId) === Number(args.currentUomId)
        ) {
            throw new BadRequestException(
                'A unit cannot reference itself as base',
            );
        }
        const baseUom = await this.uomsRepo.findOne({
            where: { tenantId: args.tenantId, id: baseUomId, isActive: true },
        });
        if (!baseUom) {
            throw new NotFoundException('Base unit not found');
        }
        if (String(baseUom.kind) !== String(args.kind)) {
            throw new BadRequestException(
                'Base unit kind must match selected kind',
            );
        }
        const multiplier = Number(args.multiplierRaw);
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            throw new BadRequestException(
                'multiplier_to_base must be a number greater than 0 when base_uom_id is set',
            );
        }
        return { baseUomId, multiplierToBase: multiplier };
    }

    async deactivateUom(tenantId: number, uomId: number) {
        const uom = await this.uomsRepo.findOne({
            where: { tenantId, id: uomId, isActive: true },
        });
        if (!uom) throw new NotFoundException('Unit of measure not found');
        uom.isActive = false;
        return this.uomsRepo.save(uom);
    }

    // ---------------- Vendors ----------------
    listVendors(tenantId: number) {
        return this.vendorsRepo.find({
            where: { tenantId, isActive: true },
            order: { type: 'ASC', name: 'ASC' },
        });
    }

    createVendor(
        tenantId: number,
        dto: {
            name: string;
            type?: string;
            linked_branch_id?: number | null;
            email?: string | null;
            phone?: string | null;
            address?: string | null;
        },
    ) {
        const vendor = this.vendorsRepo.create({
            tenantId,
            name: dto.name,
            type: dto.type ?? 'supplier',
            linkedBranchId: dto.linked_branch_id ?? null,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            address: dto.address ?? null,
            isActive: true,
        });
        return this.vendorsRepo.save(vendor);
    }

    async updateVendor(
        tenantId: number,
        vendorId: number,
        dto: {
            name?: string;
            type?: string;
            linked_branch_id?: number | null;
            email?: string | null;
            phone?: string | null;
            address?: string | null;
        },
    ) {
        const vendor = await this.vendorsRepo.findOne({
            where: { tenantId, id: vendorId, isActive: true },
        });
        if (!vendor) throw new NotFoundException('Vendor not found');

        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name is required');
            vendor.name = name;
        }
        if (dto.type !== undefined) {
            vendor.type = String(dto.type || 'supplier').trim() || 'supplier';
        }
        if (dto.linked_branch_id !== undefined) {
            vendor.linkedBranchId = dto.linked_branch_id ?? null;
        }
        if (dto.email !== undefined) vendor.email = dto.email ?? null;
        if (dto.phone !== undefined) vendor.phone = dto.phone ?? null;
        if (dto.address !== undefined) vendor.address = dto.address ?? null;

        return this.vendorsRepo.save(vendor);
    }

    async deactivateVendor(tenantId: number, vendorId: number) {
        const vendor = await this.vendorsRepo.findOne({
            where: { tenantId, id: vendorId, isActive: true },
        });
        if (!vendor) throw new NotFoundException('Vendor not found');
        vendor.isActive = false;
        return this.vendorsRepo.save(vendor);
    }

    // ---------------- Inventory items ----------------
    listItems(tenantId: number) {
        return this.itemsRepo.find({
            where: { tenantId, isActive: true },
            order: { type: 'ASC', name: 'ASC' },
        });
    }

    async createItem(
        tenantId: number,
        dto: {
            name: string;
            code: string;
            type?: string;
            base_uom_id: number;
            base_uom_ids?: number[];
            track_expiry?: boolean;
            track_lot?: boolean;
            default_reorder_point?: number | null;
            default_near_expiry_days?: number | null;
            default_buy_price: number;
        },
    ) {
        const name = String(dto.name ?? '').trim();
        const code = String(dto.code ?? '').trim();
        const normalizedBaseUomId = Number(dto.base_uom_id);
        const baseUomId = Number.isInteger(normalizedBaseUomId)
            ? normalizedBaseUomId
            : 0;
        if (!name) throw new BadRequestException('Name is required');
        if (!code) throw new BadRequestException('Code is required');
        if (!baseUomId) throw new BadRequestException('Base unit is required');
        const buyPrice = Number(dto.default_buy_price);
        if (!Number.isFinite(buyPrice) || buyPrice < 0) {
            throw new BadRequestException(
                'default_buy_price is required and must be a valid number >= 0',
            );
        }
        await this.ensureUniqueItemCode(tenantId, code);
        const validatedBaseUoms = await this.normalizeAndValidateItemBaseUoms(
            tenantId,
            baseUomId,
            dto.base_uom_ids,
        );

        const item = this.itemsRepo.create({
            tenantId,
            name,
            code,
            type: dto.type ?? 'ingredient',
            baseUomId: validatedBaseUoms.baseUomId,
            baseUomIds: validatedBaseUoms.baseUomIds,
            trackExpiry: dto.track_expiry ?? true,
            trackLot: dto.track_lot ?? true,
            defaultReorderPoint: dto.default_reorder_point ?? null,
            defaultNearExpiryDays: dto.default_near_expiry_days ?? null,
            defaultBuyPrice: buyPrice,
            isActive: true,
        });
        return this.itemsRepo.save(item);
    }

    async updateItem(
        tenantId: number,
        itemId: number,
        dto: {
            name?: string;
            code?: string;
            type?: string;
            base_uom_id?: number;
            base_uom_ids?: number[];
            track_expiry?: boolean;
            track_lot?: boolean;
            default_reorder_point?: number | null;
            default_near_expiry_days?: number | null;
            default_buy_price: number;
        },
    ) {
        const item = await this.itemsRepo.findOne({
            where: { tenantId, id: itemId, isActive: true },
        });
        if (!item) throw new NotFoundException('Inventory item not found');

        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name is required');
            item.name = name;
        }
        if (dto.code !== undefined) {
            const code = String(dto.code).trim();
            if (!code) throw new BadRequestException('Code is required');
            await this.ensureUniqueItemCode(tenantId, code, item.id);
            item.code = code;
        }
        if (dto.type !== undefined)
            item.type = String(dto.type || 'ingredient').trim() || 'ingredient';
        if (dto.base_uom_id !== undefined) {
            if (!dto.base_uom_id)
                throw new BadRequestException('Base unit is required');
            const validatedBaseUoms =
                await this.normalizeAndValidateItemBaseUoms(
                    tenantId,
                    Number(dto.base_uom_id),
                    [Number(dto.base_uom_id)],
                );
            item.baseUomId = validatedBaseUoms.baseUomId;
            item.baseUomIds = validatedBaseUoms.baseUomIds;
        }
        if (dto.base_uom_ids !== undefined) {
            const canonicalBaseUomId =
                dto.base_uom_id !== undefined
                    ? Number(dto.base_uom_id)
                    : Number(
                          dto.base_uom_ids.find((id) => Number(id) > 0) ??
                              item.baseUomId,
                      );
            const validatedBaseUoms =
                await this.normalizeAndValidateItemBaseUoms(
                    tenantId,
                    canonicalBaseUomId,
                    dto.base_uom_ids,
                );
            item.baseUomIds = validatedBaseUoms.baseUomIds;
            item.baseUomId = validatedBaseUoms.baseUomId;
        }
        if (dto.track_expiry !== undefined)
            item.trackExpiry = !!dto.track_expiry;
        if (dto.track_lot !== undefined) item.trackLot = !!dto.track_lot;
        if (dto.default_reorder_point !== undefined)
            item.defaultReorderPoint = dto.default_reorder_point ?? null;
        if (dto.default_near_expiry_days !== undefined)
            item.defaultNearExpiryDays = dto.default_near_expiry_days ?? null;
        if (
            dto.default_buy_price === undefined ||
            dto.default_buy_price === null
        ) {
            throw new BadRequestException('default_buy_price is required');
        }
        const next = Number(dto.default_buy_price);
        if (!Number.isFinite(next) || next < 0) {
            throw new BadRequestException(
                'default_buy_price is required and must be a valid number >= 0',
            );
        }
        item.defaultBuyPrice = next;

        return this.itemsRepo.save(item);
    }

    private async ensureUniqueItemCode(
        tenantId: number,
        code: string,
        excludeItemId?: number,
    ) {
        const qb = this.itemsRepo
            .createQueryBuilder('item')
            .where('item.tenant_id = :tenantId', { tenantId })
            .andWhere('LOWER(item.code) = LOWER(:code)', { code });
        if (excludeItemId != null) {
            qb.andWhere('item.id != :excludeItemId', { excludeItemId });
        }
        const existing = await qb.getOne();
        if (existing) {
            throw new BadRequestException(
                'Code / SKU already exists. Please use a unique value.',
            );
        }
    }

    async deactivateItem(tenantId: number, itemId: number) {
        const item = await this.itemsRepo.findOne({
            where: { tenantId, id: itemId, isActive: true },
        });
        if (!item) throw new NotFoundException('Inventory item not found');
        item.isActive = false;
        return this.itemsRepo.save(item);
    }

    async upsertBranchItemSettings(
        tenantId: number,
        branchId: number,
        inventoryItemId: number,
        dto: {
            reorder_point?: number | null;
            near_expiry_days?: number | null;
        },
    ) {
        const existing = await this.itemBranchSettingsRepo.findOne({
            where: { tenantId, branchId, inventoryItemId },
        });
        if (existing) {
            existing.reorderPoint =
                dto.reorder_point === undefined
                    ? existing.reorderPoint
                    : dto.reorder_point;
            existing.nearExpiryDays =
                dto.near_expiry_days === undefined
                    ? existing.nearExpiryDays
                    : dto.near_expiry_days;
            return this.itemBranchSettingsRepo.save(existing);
        }
        return this.itemBranchSettingsRepo.save(
            this.itemBranchSettingsRepo.create({
                tenantId,
                branchId,
                inventoryItemId,
                reorderPoint: dto.reorder_point ?? null,
                nearExpiryDays: dto.near_expiry_days ?? null,
                isActive: true,
            }),
        );
    }

    // ---------------- Locations ----------------
    listLocations(tenantId: number, branchId: number) {
        return this.locationsRepo.find({
            where: { tenantId, branchId },
            order: { code: 'ASC' },
        });
    }

    createLocation(
        tenantId: number,
        branchId: number,
        dto: { name: string; code: string },
    ) {
        return this.locationsRepo.save(
            this.locationsRepo.create({
                tenantId,
                branchId,
                name: dto.name,
                code: dto.code,
                isActive: true,
            }),
        );
    }

    // ---------------- Read models ----------------
    listOnHand(
        tenantId: number,
        branchId: number,
        opts?: {
            // undefined = all brands + pool; null = pool only; number = that brand.
            brandId?: number | null;
            flaggedOnly?: boolean;
            // When set, a brand-locked user only sees these brand buckets.
            allowedBrandIds?: number[] | null;
        },
    ) {
        const qb = this.onHandRepo
            .createQueryBuilder('oh')
            .where('oh.tenantId = :tenantId', { tenantId })
            .andWhere('oh.branchId = :branchId', { branchId });

        if (opts && opts.brandId !== undefined) {
            if (opts.brandId === null) {
                qb.andWhere('oh.brandId IS NULL');
            } else {
                qb.andWhere('oh.brandId = :brandId', { brandId: opts.brandId });
            }
        }
        if (opts?.allowedBrandIds && opts.allowedBrandIds.length > 0) {
            qb.andWhere('oh.brandId IN (:...allowedBrandIds)', {
                allowedBrandIds: opts.allowedBrandIds,
            });
        }
        if (opts?.flaggedOnly) {
            qb.andWhere('oh.qty < 0').andWhere(
                'oh.negativeFlaggedAt IS NOT NULL',
            );
        }
        return qb
            .orderBy('oh.inventoryItemId', 'ASC')
            .addOrderBy('oh.brandId', 'ASC')
            .getMany();
    }

    async listLedger(
        tenantId: number,
        branchId: number,
        opts?: {
            eventType?: string;
            inventoryItemId?: number;
            eventRefType?: string;
            eventRefId?: number;
            from?: string;
            to?: string;
            page?: number;
            pageSize?: number;
        },
    ) {
        const page = Math.max(Number(opts?.page ?? 1), 1);
        const pageSize = Math.min(
            Math.max(Number(opts?.pageSize ?? 50), 1),
            200,
        );
        const qb = this.ledgerRepo
            .createQueryBuilder('l')
            .leftJoinAndSelect('l.inventoryBatch', 'batch')
            .leftJoinAndSelect('l.location', 'location')
            .leftJoinAndSelect('l.creator', 'creator')
            .where('l.tenant_id = :tenantId', { tenantId })
            .andWhere('l.branch_id = :branchId', { branchId });

        if (opts?.eventType) {
            qb.andWhere('l.event_type = :eventType', {
                eventType: opts.eventType,
            });
        }
        if (opts?.inventoryItemId != null) {
            qb.andWhere('l.inventory_item_id = :inventoryItemId', {
                inventoryItemId: opts.inventoryItemId,
            });
        }
        if (opts?.eventRefType) {
            qb.andWhere('l.event_ref_type = :eventRefType', {
                eventRefType: opts.eventRefType,
            });
        }
        if (opts?.eventRefId != null) {
            qb.andWhere('l.event_ref_id = :eventRefId', {
                eventRefId: opts.eventRefId,
            });
        }
        if (opts?.from) {
            qb.andWhere('l.createdAt >= :fromDate', { fromDate: opts.from });
        }
        if (opts?.to) {
            qb.andWhere(
                "l.createdAt < (:toDate::timestamp + interval '1 day')",
                {
                    toDate: opts.to,
                },
            );
        }

        qb.orderBy('l.createdAt', 'DESC')
            .skip((page - 1) * pageSize)
            .take(pageSize);
        const [items, total] = await qb.getManyAndCount();
        return { items, total, page, pageSize };
    }

    async getBrandLedgerSummary(args: {
        tenantId: number;
        brandId: number;
        from?: string;
        to?: string;
    }) {
        const scopedBranches = await this.branchBrandsRepo.find({
            where: { brandId: args.brandId },
        });
        const branchIds = scopedBranches.map((b) => b.branchId);
        if (branchIds.length === 0) {
            return {
                brandId: args.brandId,
                from: args.from,
                to: args.to,
                rows: [],
            };
        }

        const params: unknown[] = [args.tenantId, branchIds];
        let whereDate = '';
        if (args.from) {
            params.push(args.from);
            whereDate += ` AND l.created_at >= $${params.length}`;
        }
        if (args.to) {
            params.push(args.to);
            whereDate += ` AND l.created_at < ($${params.length}::timestamp + interval '1 day')`;
        }

        const rows: Array<{
            inventory_item_id: number | string;
            on_hand_qty: number | string;
        }> = await this.dataSource.query(
            `
            SELECT l.branch_id,
                   l.inventory_item_id,
                   l.event_type,
                   SUM(l.qty_delta)::numeric AS qty_delta
            FROM inventory_ledger_entries l
            WHERE l.tenant_id = $1
              AND l.branch_id = ANY($2)
              ${whereDate}
            GROUP BY l.branch_id, l.inventory_item_id, l.event_type
            ORDER BY l.branch_id, l.inventory_item_id
            `,
            params,
        );
        return { brandId: args.brandId, from: args.from, to: args.to, rows };
    }

    /**
     * Cross-branch on-hand for a single brand bucket — the "see my brand's stock
     * across my branches" view for brand admins. Branches are the brand's
     * branch_brands links, intersected with the caller's allowedBranchIds (null =
     * all). Returns the brand bucket only (pool is intentionally excluded, matching
     * brand-lock). Result is pivoted to one row per item with a per-branch qty map.
     */
    async getBrandOnHand(args: {
        tenantId: number;
        brandId: number;
        allowedBranchIds?: number[] | null;
    }) {
        const links = await this.branchBrandsRepo.find({
            where: { brandId: args.brandId },
        });
        let branchIds = [...new Set(links.map((l) => l.branchId))];
        if (Array.isArray(args.allowedBranchIds)) {
            const allowed = new Set(args.allowedBranchIds);
            branchIds = branchIds.filter((id) => allowed.has(id));
        }
        if (branchIds.length === 0) {
            return { brandId: args.brandId, branches: [], items: [] };
        }

        const branchRows: Array<{ id: number; name: string }> =
            await this.dataSource.query(
                `SELECT id, name FROM branches WHERE id = ANY($1) ORDER BY name ASC`,
                [branchIds],
            );

        const rows: Array<{
            inventory_item_id: number | string;
            item_code: string;
            item_name: string;
            base_uom_id: number | string | null;
            branch_id: number | string;
            qty: number | string;
        }> = await this.dataSource.query(
            `
            SELECT oh.inventory_item_id,
                   i.code AS item_code,
                   i.name AS item_name,
                   i.base_uom_id,
                   oh.branch_id,
                   SUM(oh.qty)::numeric AS qty
            FROM inventory_on_hand oh
            INNER JOIN inventory_items i ON i.id = oh.inventory_item_id
            WHERE oh.tenant_id = $1
              AND oh.branch_id = ANY($2)
              AND oh.brand_id = $3
            GROUP BY oh.inventory_item_id, i.code, i.name, i.base_uom_id, oh.branch_id
            HAVING SUM(oh.qty) <> 0
            ORDER BY i.name ASC
            `,
            [args.tenantId, branchIds, args.brandId],
        );

        const itemsMap = new Map<
            number,
            {
                inventory_item_id: number;
                item_code: string;
                item_name: string;
                base_uom_id: number | null;
                total_qty: number;
                by_branch: Record<number, number>;
            }
        >();
        for (const r of rows) {
            const itemId = Number(r.inventory_item_id);
            const qty = Number(r.qty);
            let entry = itemsMap.get(itemId);
            if (!entry) {
                entry = {
                    inventory_item_id: itemId,
                    item_code: r.item_code,
                    item_name: r.item_name,
                    base_uom_id:
                        r.base_uom_id == null ? null : Number(r.base_uom_id),
                    total_qty: 0,
                    by_branch: {},
                };
                itemsMap.set(itemId, entry);
            }
            entry.by_branch[Number(r.branch_id)] = qty;
            entry.total_qty += qty;
        }

        return {
            brandId: args.brandId,
            branches: branchRows.map((b) => ({
                branch_id: b.id,
                branch_name: b.name,
            })),
            items: [...itemsMap.values()],
        };
    }

    // ---------------- Posting helpers (ledger-first) ----------------
    async convertToItemBaseQty(
        tenantId: number,
        itemId: number,
        qty: number,
        qtyUomId: number,
    ): Promise<number> {
        const item = await this.itemsRepo.findOne({
            where: { id: itemId, tenantId },
        });
        if (!item) throw new NotFoundException('Inventory item not found');
        const itemBaseUomId = item.baseUomId;
        const allowedUomIds = this.resolveItemAllowedBaseUomIds(item);

        if (!allowedUomIds.includes(qtyUomId)) {
            throw new BadRequestException(
                `Selected unit is not configured for ${item.code}. Use a configured comparable unit or create a separate item for a different measurement type.`,
            );
        }

        if (qtyUomId === itemBaseUomId) return qty;

        const uom = await this.uomsRepo.findOne({
            where: { id: qtyUomId, tenantId },
        });
        if (!uom) throw new NotFoundException('UOM not found');

        // Only allow conversion when the uom ultimately converts to item's base uom
        const multiplier = await this.resolveMultiplierToBaseUom(
            tenantId,
            qtyUomId,
            itemBaseUomId,
        );
        if (multiplier == null) {
            throw new BadRequestException(
                `Selected unit is not comparable with this item's primary unit. Use a compatible unit or create a separate item for a different measurement family.`,
            );
        }
        return qty * multiplier;
    }

    private resolveItemAllowedBaseUomIds(item: InventoryItem): number[] {
        const configured = Array.isArray(item.baseUomIds)
            ? item.baseUomIds
            : [];
        const normalized = configured
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0);
        const deduped = Array.from(new Set(normalized));
        if (item.baseUomId && !deduped.includes(Number(item.baseUomId))) {
            deduped.unshift(Number(item.baseUomId));
        }
        return deduped.length > 0 ? deduped : [Number(item.baseUomId)];
    }

    private async normalizeAndValidateItemBaseUoms(
        tenantId: number,
        baseUomId: number,
        baseUomIds?: number[],
    ): Promise<{ baseUomId: number; baseUomIds: number[] }> {
        if (!Number.isInteger(baseUomId) || baseUomId <= 0) {
            throw new BadRequestException('Base unit is required');
        }
        const normalizedFromDto = Array.isArray(baseUomIds)
            ? baseUomIds
                  .map((id) => Number(id))
                  .filter((id) => Number.isInteger(id) && id > 0)
            : [];
        const normalized = Array.from(
            new Set([baseUomId, ...normalizedFromDto]),
        );
        if (normalized.length === 0) {
            throw new BadRequestException('At least one base unit is required');
        }
        for (const uomId of normalized) {
            const uom = await this.uomsRepo.findOne({
                where: { id: uomId, tenantId, isActive: true },
            });
            if (!uom) {
                throw new NotFoundException(
                    `Unit of measure ${uomId} not found`,
                );
            }
        }
        for (const uomId of normalized) {
            if (uomId === baseUomId) continue;
            const multiplier = await this.resolveMultiplierToBaseUom(
                tenantId,
                uomId,
                baseUomId,
            );
            if (multiplier == null) {
                throw new BadRequestException(
                    `Unit ${uomId} cannot convert to primary base unit ${baseUomId}`,
                );
            }
        }
        return { baseUomId, baseUomIds: normalized };
    }

    private async resolveMultiplierToBaseUom(
        tenantId: number,
        fromUomId: number,
        targetBaseUomId: number,
    ): Promise<number | null> {
        const targetBaseUom = await this.uomsRepo.findOne({
            where: { id: targetBaseUomId, tenantId, isActive: true },
        });
        if (!targetBaseUom) return null;

        // Walk at most 4 levels to prevent cycles and bad data.
        let currentId: number | null = fromUomId;
        let multiplier = 1;
        for (let i = 0; i < 4; i++) {
            const uom = await this.uomsRepo.findOne({
                where: { id: currentId, tenantId, isActive: true },
            });
            if (!uom) return null;
            if (String(uom.kind) !== String(targetBaseUom.kind)) return null;
            if (uom.id === targetBaseUomId) return multiplier;

            if (uom.baseUomId == null || uom.multiplierToBase == null)
                return null;
            multiplier *= Number(uom.multiplierToBase);
            currentId = uom.baseUomId;
        }
        return null;
    }

    /**
     * Apply a set of ledger movements and update read models in the same DB transaction.
     * If `idempotencyKey` is present, duplicates are ignored (unique index).
     */
    async postLedgerMovements(args: {
        tenantId: number;
        branchId: number;
        manager?: EntityManager;
        movements: Array<{
            inventoryItemId: number;
            inventoryBatchId?: number | null;
            locationId?: number | null;
            brandId?: number | null;
            qtyDelta: number;
            eventType: string;
            eventRefType?: string | null;
            eventRefId?: number | null;
            idempotencyKey?: string | null;
            notes?: string | null;
            createdBy?: number | null;
        }>;
    }) {
        const { tenantId, branchId, movements } = args;
        if (movements.length === 0) return [];

        const run = async (manager: EntityManager) => {
            const inserted: InventoryLedgerEntry[] = [];

            for (const m of movements) {
                // Insert ledger entry (idempotent)
                const res = (await manager
                    .createQueryBuilder()
                    .insert()
                    .into(InventoryLedgerEntry)
                    .values({
                        tenantId,
                        branchId,
                        brandId: m.brandId ?? null,
                        inventoryItemId: m.inventoryItemId,
                        inventoryBatchId: m.inventoryBatchId ?? null,
                        locationId: m.locationId ?? null,
                        qtyDelta: m.qtyDelta,
                        eventType: m.eventType,
                        eventRefType: m.eventRefType ?? null,
                        eventRefId: m.eventRefId ?? null,
                        idempotencyKey: m.idempotencyKey ?? null,
                        notes: m.notes ?? null,
                        createdBy: m.createdBy ?? null,
                    })
                    .orIgnore()
                    .returning('*')
                    .execute()) as unknown as {
                    raw: InventoryLedgerEntry[];
                };

                // If duplicate idempotency key, res.raw will be empty
                if (!res.raw?.[0]) continue;
                inserted.push(res.raw[0]);

                // Update item on-hand (branch + brand + item + location)
                await manager.query(
                    `
                    INSERT INTO inventory_on_hand (tenant_id, branch_id, inventory_item_id, location_id, brand_id, qty)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (branch_id, inventory_item_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                    DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()
                    `,
                    [
                        tenantId,
                        branchId,
                        m.inventoryItemId,
                        m.locationId ?? null,
                        m.brandId ?? null,
                        m.qtyDelta,
                    ],
                );

                // Update batch on-hand when batch is specified
                if (m.inventoryBatchId != null) {
                    await manager.query(
                        `
                        INSERT INTO inventory_batch_on_hand (tenant_id, branch_id, inventory_batch_id, location_id, brand_id, qty)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (branch_id, inventory_batch_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
                        DO UPDATE SET qty = inventory_batch_on_hand.qty + EXCLUDED.qty, updated_at = now()
                        `,
                        [
                            tenantId,
                            branchId,
                            m.inventoryBatchId,
                            m.locationId ?? null,
                            m.brandId ?? null,
                            m.qtyDelta,
                        ],
                    );
                }
            }

            return inserted;
        };

        if (args.manager) return run(args.manager);
        return this.dataSource.transaction((manager) => run(manager));
    }

    async recordWastage(args: {
        tenantId: number;
        branchId: number;
        inventoryItemId: number;
        qty: number;
        qtyUomId: number;
        reason: string;
        notes?: string | null;
        locationId?: number | null;
        inventoryBatchId?: number | null;
        createdBy: number;
    }) {
        const qtyBase = await this.convertToItemBaseQty(
            args.tenantId,
            args.inventoryItemId,
            args.qty,
            args.qtyUomId,
        );

        const wastage = await this.wastageRepo.save(
            this.wastageRepo.create({
                tenantId: args.tenantId,
                branchId: args.branchId,
                inventoryItemId: args.inventoryItemId,
                inventoryBatchId: args.inventoryBatchId ?? null,
                locationId: args.locationId ?? null,
                qty: qtyBase,
                reason: args.reason,
                notes: args.notes ?? null,
                createdBy: args.createdBy,
            }),
        );

        await this.postLedgerMovements({
            tenantId: args.tenantId,
            branchId: args.branchId,
            movements: [
                {
                    inventoryItemId: args.inventoryItemId,
                    inventoryBatchId: args.inventoryBatchId ?? null,
                    locationId: args.locationId ?? null,
                    qtyDelta: -qtyBase,
                    eventType: 'waste',
                    eventRefType: 'wastage_event',
                    eventRefId: wastage.id,
                    idempotencyKey: `waste:${wastage.id}`,
                    createdBy: args.createdBy,
                },
            ],
        });

        return wastage;
    }

    async listWastage(
        tenantId: number,
        branchId: number,
        opts?: {
            inventoryItemId?: number;
            reason?: string;
            from?: string;
            to?: string;
            page?: number;
            pageSize?: number;
        },
    ) {
        const page = Math.max(Number(opts?.page ?? 1), 1);
        const pageSize = Math.min(
            Math.max(Number(opts?.pageSize ?? 50), 1),
            200,
        );

        const qb = this.wastageRepo
            .createQueryBuilder('w')
            .leftJoinAndSelect('w.inventoryBatch', 'batch')
            .leftJoinAndSelect('w.location', 'location')
            .leftJoinAndSelect('w.creator', 'creator')
            .where('w.tenant_id = :tenantId', { tenantId })
            .andWhere('w.branch_id = :branchId', { branchId });

        if (opts?.inventoryItemId != null) {
            qb.andWhere('w.inventory_item_id = :inventoryItemId', {
                inventoryItemId: opts.inventoryItemId,
            });
        }
        if (opts?.reason) {
            qb.andWhere('LOWER(w.reason) LIKE LOWER(:reason)', {
                reason: `%${String(opts.reason).trim()}%`,
            });
        }
        if (opts?.from) {
            qb.andWhere('w.createdAt >= :fromDate', { fromDate: opts.from });
        }
        if (opts?.to) {
            qb.andWhere(
                "w.createdAt < (:toDate::timestamp + interval '1 day')",
                {
                    toDate: opts.to,
                },
            );
        }

        qb.orderBy('w.createdAt', 'DESC')
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const [items, total] = await qb.getManyAndCount();
        return { items, total, page, pageSize };
    }

    async addItemCost(args: {
        tenantId: number;
        branchId: number;
        inventoryItemId: number;
        unitCostPerBase: number;
        currency?: string | null;
        sourceType: string;
        sourceId?: number | null;
    }) {
        return this.itemCostsRepo.save(
            this.itemCostsRepo.create({
                tenantId: args.tenantId,
                branchId: args.branchId,
                inventoryItemId: args.inventoryItemId,
                unitCost: args.unitCostPerBase,
                currency: args.currency ?? null,
                sourceType: args.sourceType,
                sourceId: args.sourceId ?? null,
            }),
        );
    }

    // ---------------- Alerts ----------------
    async getLowStockAlerts(tenantId: number, branchId: number) {
        // On-hand totals per item (sum all locations)
        const rows: Array<{
            inventory_item_id: number | string;
            on_hand_qty: number | string;
        }> = await this.dataSource.query(
            `
            SELECT ioh.inventory_item_id,
                   SUM(ioh.qty)::numeric AS on_hand_qty
            FROM inventory_on_hand ioh
            WHERE ioh.tenant_id = $1 AND ioh.branch_id = $2
            GROUP BY ioh.inventory_item_id
            `,
            [tenantId, branchId],
        );
        const onHandMap = new Map<number, number>(
            rows.map((r) => [
                Number(r.inventory_item_id),
                Number(r.on_hand_qty),
            ]),
        );

        const settings = await this.itemBranchSettingsRepo.find({
            where: { tenantId, branchId, isActive: true },
        });
        const settingsMap = new Map<number, InventoryItemBranchSetting>(
            settings.map((s) => [s.inventoryItemId, s]),
        );

        const items = await this.itemsRepo.find({
            where: { tenantId, isActive: true },
            order: { name: 'ASC' },
        });

        const alerts: Array<{
            inventory_item_id: number;
            item_code: string;
            item_name: string;
            on_hand_qty: number;
            reorder_point: number;
        }> = [];

        for (const item of items) {
            const reorderPoint =
                settingsMap.get(item.id)?.reorderPoint ??
                item.defaultReorderPoint ??
                null;
            if (reorderPoint == null) continue;
            const onHand = onHandMap.get(item.id) ?? 0;
            if (onHand <= Number(reorderPoint)) {
                alerts.push({
                    inventory_item_id: item.id,
                    item_code: item.code,
                    item_name: item.name,
                    on_hand_qty: onHand,
                    reorder_point: Number(reorderPoint),
                });
            }
        }

        return alerts;
    }

    async getNearExpiryAlerts(tenantId: number, branchId: number) {
        const settings = await this.itemBranchSettingsRepo.find({
            where: { tenantId, branchId, isActive: true },
        });
        const settingsMap = new Map<number, InventoryItemBranchSetting>(
            settings.map((s) => [s.inventoryItemId, s]),
        );
        const items = await this.itemsRepo.find({
            where: { tenantId, isActive: true },
        });
        const itemsMap = new Map<number, InventoryItem>(
            items.map((i) => [i.id, i]),
        );

        // Find batches with qty > 0 and expiry within (today + nearExpiryDays)
        const rows = await this.dataSource.query(
            `
            SELECT b.id AS batch_id,
                   b.inventory_item_id,
                   b.expiry_date,
                   SUM(iboh.qty)::numeric AS on_hand_qty
            FROM inventory_batches b
            INNER JOIN inventory_batch_on_hand iboh ON iboh.inventory_batch_id = b.id
            WHERE b.tenant_id = $1 AND b.branch_id = $2
              AND b.status = 'available'
              AND b.expiry_date IS NOT NULL
            GROUP BY b.id, b.inventory_item_id, b.expiry_date
            HAVING SUM(iboh.qty) > 0
            ORDER BY b.expiry_date ASC
            `,
            [tenantId, branchId],
        );

        const today = new Date();
        const msPerDay = 24 * 60 * 60 * 1000;

        const alerts: Array<{
            batch_id: number;
            inventory_item_id: number;
            item_code: string;
            item_name: string;
            expiry_date: string;
            days_to_expiry: number;
            on_hand_qty: number;
            near_expiry_days: number;
        }> = [];

        for (const r of rows) {
            const item = itemsMap.get(r.inventory_item_id);
            if (!item) continue;
            const nearExpiryDays =
                settingsMap.get(item.id)?.nearExpiryDays ??
                item.defaultNearExpiryDays ??
                null;
            if (nearExpiryDays == null) continue;
            const expiry = new Date(r.expiry_date + 'T00:00:00Z');
            const daysToExpiry = Math.floor(
                (expiry.getTime() - today.getTime()) / msPerDay,
            );
            if (daysToExpiry <= Number(nearExpiryDays)) {
                alerts.push({
                    batch_id: r.batch_id,
                    inventory_item_id: item.id,
                    item_code: item.code,
                    item_name: item.name,
                    expiry_date: r.expiry_date,
                    days_to_expiry: daysToExpiry,
                    on_hand_qty: Number(r.on_hand_qty),
                    near_expiry_days: Number(nearExpiryDays),
                });
            }
        }

        return alerts;
    }

    async getExpiryCoverageWarnings(tenantId: number, branchId: number) {
        const onHandRows: Array<{
            inventory_item_id: number | string;
            on_hand_qty: number | string;
        }> = await this.dataSource.query(
            `
            SELECT inventory_item_id, SUM(qty)::numeric AS on_hand_qty
            FROM inventory_on_hand
            WHERE tenant_id = $1 AND branch_id = $2
            GROUP BY inventory_item_id
            HAVING SUM(qty) > 0
            `,
            [tenantId, branchId],
        );
        if (onHandRows.length === 0) return [];

        const onHandMap = new Map<number, number>(
            onHandRows.map((r) => [
                Number(r.inventory_item_id),
                Number(r.on_hand_qty),
            ]),
        );
        const itemIds = [...onHandMap.keys()];
        const items = await this.itemsRepo
            .createQueryBuilder('i')
            .where('i.id IN (:...itemIds)', { itemIds })
            .andWhere('i.tenant_id = :tenantId', { tenantId })
            .andWhere('i.is_active = true')
            .getMany();
        const expiryTracked = items.filter((i) => i.trackExpiry);
        if (expiryTracked.length === 0) return [];

        const coveredRows: Array<{ inventory_item_id: number | string }> =
            await this.dataSource.query(
                `
            SELECT b.inventory_item_id
            FROM inventory_batches b
            INNER JOIN inventory_batch_on_hand iboh ON iboh.inventory_batch_id = b.id
            WHERE b.tenant_id = $1
              AND b.branch_id = $2
              AND b.status = 'available'
              AND b.expiry_date IS NOT NULL
            GROUP BY b.inventory_item_id
            HAVING SUM(iboh.qty) > 0
            `,
                [tenantId, branchId],
            );
        const coveredSet = new Set(
            coveredRows.map((r) => Number(r.inventory_item_id)),
        );

        return expiryTracked
            .filter((item) => !coveredSet.has(item.id))
            .map((item) => ({
                inventory_item_id: item.id,
                item_code: item.code,
                item_name: item.name,
                on_hand_qty: onHandMap.get(item.id) ?? 0,
                warning: 'Stock exists but no expiry batches found',
            }));
    }

    // ---------------- Stocktakes ----------------
    async createStocktake(args: {
        tenantId: number;
        branchId: number;
        weekStart: string;
        weekEnd: string;
        financeDay: string;
        createdBy: number;
    }) {
        const existing = await this.stocktakesRepo.findOne({
            where: {
                tenantId: args.tenantId,
                branchId: args.branchId,
                weekStart: args.weekStart,
            },
        });
        if (existing) return existing;
        return this.stocktakesRepo.save(
            this.stocktakesRepo.create({
                tenantId: args.tenantId,
                branchId: args.branchId,
                weekStart: args.weekStart,
                weekEnd: args.weekEnd,
                financeDay: args.financeDay,
                status: 'open',
            }),
        );
    }

    async upsertStocktakeLine(args: {
        tenantId: number;
        branchId: number;
        stocktakeId: number;
        inventoryItemId: number;
        countedQty: number;
        countedUomId: number;
        locationId: number | null;
        notes: string | null;
    }) {
        const st = await this.stocktakesRepo.findOne({
            where: {
                id: args.stocktakeId,
                tenantId: args.tenantId,
                branchId: args.branchId,
            },
        });
        if (!st) throw new NotFoundException('Stocktake not found');
        if (st.status !== 'open')
            throw new BadRequestException('Stocktake is not open');

        const existing = await this.stocktakeLinesRepo.findOne({
            where: {
                stocktakeId: st.id,
                inventoryItemId: args.inventoryItemId,
                locationId: args.locationId,
            } as any,
        });
        if (existing) {
            existing.countedQty = args.countedQty;
            existing.countedUomId = args.countedUomId;
            existing.notes = args.notes;
            return this.stocktakeLinesRepo.save(existing);
        }
        return this.stocktakeLinesRepo.save(
            this.stocktakeLinesRepo.create({
                stocktakeId: st.id,
                inventoryItemId: args.inventoryItemId,
                countedQty: args.countedQty,
                countedUomId: args.countedUomId,
                locationId: args.locationId,
                notes: args.notes,
            }),
        );
    }

    async submitStocktake(args: {
        tenantId: number;
        branchId: number;
        stocktakeId: number;
        submittedBy: number;
    }) {
        const st = await this.stocktakesRepo.findOne({
            where: {
                id: args.stocktakeId,
                tenantId: args.tenantId,
                branchId: args.branchId,
            },
        });
        if (!st) throw new NotFoundException('Stocktake not found');
        if (st.status !== 'open')
            throw new BadRequestException('Stocktake not open');
        st.status = 'submitted';
        st.submittedBy = args.submittedBy;
        st.submittedAt = new Date();
        return this.stocktakesRepo.save(st);
    }

    async closeStocktake(args: {
        tenantId: number;
        branchId: number;
        stocktakeId: number;
        closedBy: number;
    }) {
        const st = await this.stocktakesRepo.findOne({
            where: {
                id: args.stocktakeId,
                tenantId: args.tenantId,
                branchId: args.branchId,
            },
        });
        if (!st) throw new NotFoundException('Stocktake not found');
        if (st.status !== 'submitted') {
            throw new BadRequestException(
                'Stocktake must be submitted before close',
            );
        }
        const lines = await this.stocktakeLinesRepo.find({
            where: { stocktakeId: st.id },
        });
        if (lines.length === 0) {
            throw new BadRequestException('Stocktake has no lines');
        }

        // Aggregate counted in base units by item
        const countedByItem = new Map<number, number>();
        for (const line of lines) {
            const qtyBase = await this.convertToItemBaseQty(
                args.tenantId,
                line.inventoryItemId,
                Number(line.countedQty),
                line.countedUomId,
            );
            countedByItem.set(
                line.inventoryItemId,
                (countedByItem.get(line.inventoryItemId) ?? 0) + qtyBase,
            );
        }

        // Theoretical on-hand by item (sum all locations)
        const theoRows: Array<{
            inventory_item_id: number | string;
            qty: number | string;
        }> = await this.dataSource.query(
            `
            SELECT inventory_item_id, SUM(qty)::numeric AS qty
            FROM inventory_on_hand
            WHERE tenant_id = $1 AND branch_id = $2
            GROUP BY inventory_item_id
            `,
            [args.tenantId, args.branchId],
        );
        const theoreticalByItem = new Map<number, number>(
            theoRows.map((r) => [Number(r.inventory_item_id), Number(r.qty)]),
        );

        // Post variance entries
        const movements: Array<{
            inventoryItemId: number;
            qtyDelta: number;
            eventType: string;
            eventRefType: string;
            eventRefId: number;
            idempotencyKey: string;
            createdBy: number;
        }> = [];

        for (const [itemId, counted] of countedByItem.entries()) {
            const theoretical = theoreticalByItem.get(itemId) ?? 0;
            const variance = counted - theoretical;
            if (Math.abs(variance) < 1e-9) continue;
            if (variance > 0) {
                const item = await this.itemsRepo.findOne({
                    where: { id: itemId, tenantId: args.tenantId },
                });
                if (item?.trackExpiry) {
                    throw new BadRequestException(
                        `Stocktake positive variance for expiry-tracked item ${item.code} is blocked. Use adjustment IN with expiry date and lot code.`,
                    );
                }
            }
            movements.push({
                inventoryItemId: itemId,
                qtyDelta: variance,
                eventType: 'stocktake_variance',
                eventRefType: 'stocktake',
                eventRefId: st.id,
                idempotencyKey: `stocktake:${st.id}:item:${itemId}:variance`,
                createdBy: args.closedBy,
            });
        }

        await this.postLedgerMovements({
            tenantId: args.tenantId,
            branchId: args.branchId,
            movements: movements.map((m) => ({
                inventoryItemId: m.inventoryItemId,
                qtyDelta: m.qtyDelta,
                eventType: m.eventType,
                eventRefType: m.eventRefType,
                eventRefId: m.eventRefId,
                idempotencyKey: m.idempotencyKey,
                createdBy: m.createdBy,
            })),
        });

        st.status = 'closed';
        st.closedBy = args.closedBy;
        st.closedAt = new Date();
        return this.stocktakesRepo.save(st);
    }

    // ---------------- Weekly usage report ----------------
    async getWeeklyUsageReport(args: {
        tenantId: number;
        branchId: number;
        from: string;
        to: string;
    }) {
        const rows = await this.dataSource.query(
            `
            SELECT inventory_item_id,
                   event_type,
                   SUM(qty_delta)::numeric AS qty_delta
            FROM inventory_ledger_entries
            WHERE tenant_id = $1 AND branch_id = $2
              AND created_at >= $3::timestamp
              AND created_at < ($4::timestamp + interval '1 day')
            GROUP BY inventory_item_id, event_type
            ORDER BY inventory_item_id ASC
            `,
            [args.tenantId, args.branchId, args.from, args.to],
        );

        const byItem: Record<
            string,
            { inventory_item_id: number; movements: Record<string, number> }
        > = {};
        for (const r of rows) {
            const key = String(r.inventory_item_id);
            byItem[key] ??= {
                inventory_item_id: r.inventory_item_id,
                movements: {},
            };
            byItem[key].movements[r.event_type] = Number(r.qty_delta);
        }

        return {
            from: args.from,
            to: args.to,
            items: Object.values(byItem),
        };
    }
}
