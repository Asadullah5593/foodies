import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
    PrintedVoucher,
    PrintedVoucherType,
} from '../entities/printed-voucher.entity';
import { normalizeOfferOrderTypes } from '../discounts/offer-validity.util';
import {
    branchLocalDate,
    voucherIneligibleReason,
} from '../orders/printed-voucher-pricing';

export type PrintedVoucherDto = {
    name?: string;
    brand_id?: number | string | null;
    voucher_type?: PrintedVoucherType;
    value?: number | string | null;
    max_discount_amount?: number | string | null;
    category_ids?: number[] | null;
    product_ids?: number[] | null;
    included_modifier_ids?: number[] | null;
    eligibility_branch_ids?: number[] | null;
    order_types?: string[] | null;
    /** 'YYYY-MM-DD'; both days inclusive. */
    valid_from?: string | null;
    valid_until?: string | null;
    sort_order?: number | null;
    is_active?: boolean;
};

type Named = { id: number; name: string };

/** Most redemptions the report lists (totals and breakdowns cover all of them). */
const REPORT_ROW_LIMIT = 5000;

/** Unique finite ids from client input; anything else is dropped. */
const idList = (input: unknown): number[] =>
    Array.isArray(input)
        ? [
              ...new Set(
                  input
                      .map((x) => Number(x))
                      .filter((n) => Number.isInteger(n) && n > 0),
              ),
          ]
        : [];

/** 'YYYY-MM-DD' that names a real calendar day, or null. */
function parseDay(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const s = input.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
        ? s
        : null;
}

/**
 * Printed vouchers: the paper coupon book. Admin CRUD, the till's list, the
 * form's pick-lists and the redemption report. The pricing rules live in
 * orders/printed-voucher-pricing.ts and are enforced by OrdersService — this
 * service only decides what exists and what the till is shown.
 *
 * Every voucher belongs to one brand, so brand lock is simple here: a
 * brand-locked admin sees and manages only the vouchers of their own brands.
 */
@Injectable()
export class PrintedVouchersService {
    constructor(
        @InjectRepository(PrintedVoucher)
        private readonly repo: Repository<PrintedVoucher>,
        private readonly dataSource: DataSource,
    ) {}

    private assertTenant(tenantId: number | null): asserts tenantId is number {
        if (tenantId == null) {
            throw new ForbiddenException(
                'Printed vouchers are managed per tenant',
            );
        }
    }

    private assertBrandAllowed(
        brandId: number,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        if (allowedBrandIds != null && !allowedBrandIds.includes(brandId)) {
            throw new ForbiddenException(
                'You can only manage vouchers of your own brand',
            );
        }
    }

    /** Money is rejected, never coerced: a voucher saved as 0 would discount nothing. */
    private amountOrThrow(input: unknown, label: string): number | null {
        if (input == null || input === '') return null;
        const n = Number(input);
        if (!Number.isFinite(n) || n < 0) {
            throw new BadRequestException(
                `${label} must be a non-negative number.`,
            );
        }
        return n;
    }

    private async names(
        table: 'menu_categories' | 'menu_items' | 'modifiers' | 'branches',
        ids: number[],
    ): Promise<Map<number, string>> {
        if (ids.length === 0) return new Map();
        const rows: Named[] = await this.dataSource.query(
            `SELECT id, name FROM ${table} WHERE id = ANY($1::int[])`,
            [ids],
        );
        return new Map(rows.map((r) => [Number(r.id), r.name]));
    }

    /** Vouchers with the names behind their id lists, for the admin list. */
    private async toResponses(vouchers: PrintedVoucher[]) {
        const collect = (pick: (v: PrintedVoucher) => number[] | null) => [
            ...new Set(vouchers.flatMap((v) => (pick(v) ?? []).map(Number))),
        ];
        const [categories, products, modifiers, branches, brands] =
            await Promise.all([
                this.names(
                    'menu_categories',
                    collect((v) => v.categoryIds),
                ),
                this.names(
                    'menu_items',
                    collect((v) => v.productIds),
                ),
                this.names(
                    'modifiers',
                    collect((v) => v.includedModifierIds),
                ),
                this.names(
                    'branches',
                    collect((v) => v.eligibilityBranchIds),
                ),
                vouchers.length
                    ? this.dataSource.query<Named[]>(
                          `SELECT id, name FROM brands WHERE id = ANY($1::int[])`,
                          [[...new Set(vouchers.map((v) => v.brandId))]],
                      )
                    : Promise.resolve([] as Named[]),
            ]);
        const brandName = new Map(brands.map((b) => [Number(b.id), b.name]));
        const label = (map: Map<number, string>, ids: number[] | null) =>
            (ids ?? []).map((id) => map.get(Number(id)) ?? `#${id}`);
        return vouchers.map((v) => ({
            id: v.id,
            name: v.name,
            brand_id: v.brandId,
            brand_name: brandName.get(v.brandId) ?? null,
            voucher_type: v.voucherType,
            value: Number(v.value),
            max_discount_amount:
                v.maxDiscountAmount != null
                    ? Number(v.maxDiscountAmount)
                    : null,
            category_ids: v.categoryIds ?? [],
            category_names: label(categories, v.categoryIds),
            product_ids: v.productIds ?? [],
            product_names: label(products, v.productIds),
            included_modifier_ids: v.includedModifierIds ?? [],
            included_modifier_names: label(modifiers, v.includedModifierIds),
            eligibility_branch_ids: v.eligibilityBranchIds ?? [],
            branch_names: label(branches, v.eligibilityBranchIds),
            order_types: v.orderTypes ?? null,
            valid_from: v.validFrom ?? null,
            valid_until: v.validUntil ?? null,
            sort_order: v.sortOrder,
            is_active: v.isActive,
        }));
    }

    private applyFields(voucher: PrintedVoucher, dto: PrintedVoucherDto): void {
        if (dto.name !== undefined) voucher.name = String(dto.name).trim();
        if (dto.brand_id !== undefined) voucher.brandId = Number(dto.brand_id);
        if (dto.voucher_type !== undefined)
            voucher.voucherType = dto.voucher_type;
        if (dto.value !== undefined)
            voucher.value = this.amountOrThrow(dto.value, 'Value') ?? 0;
        if (dto.max_discount_amount !== undefined)
            voucher.maxDiscountAmount = this.amountOrThrow(
                dto.max_discount_amount,
                'Maximum discount',
            );
        const list = (input: unknown): number[] | null => {
            const ids = idList(input);
            return ids.length ? ids : null;
        };
        if (dto.category_ids !== undefined)
            voucher.categoryIds = list(dto.category_ids);
        if (dto.product_ids !== undefined)
            voucher.productIds = list(dto.product_ids);
        if (dto.included_modifier_ids !== undefined)
            voucher.includedModifierIds = list(dto.included_modifier_ids);
        if (dto.eligibility_branch_ids !== undefined)
            voucher.eligibilityBranchIds = list(dto.eligibility_branch_ids);
        if (dto.order_types !== undefined)
            voucher.orderTypes = normalizeOfferOrderTypes(dto.order_types);
        for (const [key, label] of [
            ['valid_from', 'Valid from'],
            ['valid_until', 'Valid until'],
        ] as const) {
            const raw = dto[key];
            if (raw === undefined) continue;
            const day = raw == null || raw === '' ? null : parseDay(raw);
            if (raw != null && raw !== '' && day == null) {
                throw new BadRequestException(`${label} is not a valid date.`);
            }
            if (key === 'valid_from') voucher.validFrom = day;
            else voucher.validUntil = day;
        }
        if (dto.sort_order !== undefined)
            voucher.sortOrder = Math.floor(Number(dto.sort_order ?? 0)) || 0;
        if (dto.is_active !== undefined) voucher.isActive = !!dto.is_active;
    }

    /**
     * Everything a voucher must satisfy before it is saved. Run on the final
     * state for create and update alike, so changing the brand re-checks every
     * category, product, option and branch against the new one.
     */
    private async assertValid(
        voucher: PrintedVoucher,
        tenantId: number,
    ): Promise<void> {
        if (!voucher.name?.trim()) {
            throw new BadRequestException('Give the voucher a name.');
        }
        if (!Number.isInteger(voucher.brandId) || voucher.brandId <= 0) {
            throw new BadRequestException(
                'Choose the brand this voucher is for.',
            );
        }
        const brand: Array<{ id: number }> = await this.dataSource.query(
            `SELECT id FROM brands WHERE id = $1 AND tenant_id = $2`,
            [voucher.brandId, tenantId],
        );
        if (brand.length === 0) {
            throw new BadRequestException(
                'That brand does not belong to this tenant.',
            );
        }
        if (
            voucher.voucherType !== 'fixed_price' &&
            voucher.voucherType !== 'percentage'
        ) {
            throw new BadRequestException(
                'Choose a voucher type (fixed price or percentage).',
            );
        }
        const value = Number(voucher.value);
        if (!Number.isFinite(value) || value <= 0) {
            throw new BadRequestException('Value must be greater than zero.');
        }
        const categoryIds = voucher.categoryIds ?? [];
        const productIds = voucher.productIds ?? [];
        const modifierIds = voucher.includedModifierIds ?? [];
        if (voucher.voucherType === 'percentage') {
            if (value > 100) {
                throw new BadRequestException(
                    'A percentage voucher cannot exceed 100%.',
                );
            }
            if (modifierIds.length > 0) {
                throw new BadRequestException(
                    '"Price includes" only applies to a fixed-price voucher.',
                );
            }
        } else {
            if (voucher.maxDiscountAmount != null) {
                throw new BadRequestException(
                    'A maximum discount only applies to a percentage voucher.',
                );
            }
            // "Any item on the menu for Rs 999" is never what a voucher means,
            // and it would let the most expensive item on the menu go for it.
            if (categoryIds.length === 0 && productIds.length === 0) {
                throw new BadRequestException(
                    'Choose the categories or products this voucher price applies to.',
                );
            }
        }
        if (
            voucher.validFrom &&
            voucher.validUntil &&
            voucher.validFrom > voucher.validUntil
        ) {
            throw new BadRequestException(
                '"Valid until" cannot be before "Valid from".',
            );
        }

        const allIn = async (
            sql: string,
            ids: number[],
            message: string,
        ): Promise<void> => {
            if (ids.length === 0) return;
            const rows: Array<{ id: number }> = await this.dataSource.query(
                sql,
                [ids, voucher.brandId],
            );
            if (rows.length !== ids.length)
                throw new BadRequestException(message);
        };
        await allIn(
            `SELECT id FROM menu_categories WHERE id = ANY($1::int[]) AND brand_id = $2`,
            categoryIds,
            "One or more categories do not belong to the voucher's brand.",
        );
        await allIn(
            `SELECT id FROM menu_items WHERE id = ANY($1::int[]) AND brand_id = $2`,
            productIds,
            "One or more products do not belong to the voucher's brand.",
        );
        await allIn(
            `SELECT m.id FROM modifiers m
             JOIN modifier_groups g ON g.id = m.modifier_group_id
             WHERE m.id = ANY($1::int[]) AND g.brand_id = $2`,
            modifierIds,
            "One or more included options do not belong to the voucher's brand.",
        );
        await allIn(
            `SELECT bb.branch_id AS id FROM branch_brands bb
             WHERE bb.branch_id = ANY($1::int[]) AND bb.brand_id = $2`,
            voucher.eligibilityBranchIds ?? [],
            "One or more branches do not sell the voucher's brand.",
        );
    }

    async findAll(tenantId: number | null, allowedBrandIds?: number[] | null) {
        this.assertTenant(tenantId);
        const vouchers = await this.repo.find({
            where: { tenantId },
            order: { brandId: 'ASC', sortOrder: 'ASC', id: 'ASC' },
        });
        return this.toResponses(
            vouchers.filter(
                (v) =>
                    allowedBrandIds == null ||
                    allowedBrandIds.includes(v.brandId),
            ),
        );
    }

    /**
     * The till's buttons: this brand's vouchers that can be used on an order of
     * this type, at this branch, today. Whether the cart qualifies is the
     * pricing engine's answer, reported through the quote. Everything here is
     * re-checked when the order is priced and placed, so a hidden button is a
     * courtesy to the cashier, not the control.
     */
    async findForTill(
        tenantId: number | null,
        allowedBrandIds: number[] | null | undefined,
        opts: {
            branchId?: number | null;
            brandId?: number | null;
            orderType?: string | null;
        },
    ) {
        this.assertTenant(tenantId);
        const brandId = opts.brandId != null ? Number(opts.brandId) : null;
        const branchId = opts.branchId != null ? Number(opts.branchId) : null;
        // No single brand (empty or mixed cart) or no branch: nothing to offer.
        if (brandId == null || branchId == null) return [];
        if (allowedBrandIds != null && !allowedBrandIds.includes(brandId))
            return [];
        const vouchers = await this.repo.find({
            where: { tenantId, brandId, isActive: true },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
        if (vouchers.length === 0) return [];
        const branch: Array<{ timezone: string | null }> =
            await this.dataSource.query(
                `SELECT timezone FROM branches WHERE id = $1`,
                [branchId],
            );
        const today = branchLocalDate(branch[0]?.timezone);
        return vouchers
            .filter(
                (v) =>
                    voucherIneligibleReason(v, {
                        brandId,
                        branchId,
                        orderType: opts.orderType,
                        today,
                    }) == null,
            )
            .map((v) => ({
                id: v.id,
                name: v.name,
                voucher_type: v.voucherType,
                value: Number(v.value),
            }));
    }

    /**
     * Pick-lists for the voucher form, for one brand: its categories, its
     * products (each with the option groups its wizard offers), the paid
     * options of those groups, and the branches that sell the brand. One call,
     * so the form does not depend on the menu admin's own endpoints or rights.
     */
    async formOptions(
        tenantId: number | null,
        brandId: number,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        if (!Number.isInteger(brandId) || brandId <= 0) {
            throw new BadRequestException('brand_id is required');
        }
        this.assertBrandAllowed(brandId, allowedBrandIds);
        const brand: Array<{ id: number }> = await this.dataSource.query(
            `SELECT id FROM brands WHERE id = $1 AND tenant_id = $2`,
            [brandId, tenantId],
        );
        if (brand.length === 0) throw new NotFoundException('Brand not found');

        const [categories, products, links, options, branches] =
            await Promise.all([
                this.dataSource.query<
                    Array<{ id: number; name: string; is_active: boolean }>
                >(
                    `SELECT id, name, is_active FROM menu_categories
                     WHERE brand_id = $1 ORDER BY is_active DESC, name, id`,
                    [brandId],
                ),
                this.dataSource.query<
                    Array<{
                        id: number;
                        name: string;
                        base_price: string;
                        is_active: boolean;
                        category_id: number | null;
                        category_name: string | null;
                    }>
                >(
                    `SELECT mi.id, mi.name, mi.base_price, mi.is_active,
                            mi.category_id, c.name AS category_name
                     FROM menu_items mi
                     LEFT JOIN menu_categories c ON c.id = mi.category_id
                     WHERE mi.brand_id = $1
                     ORDER BY mi.is_active DESC, c.name, mi.name, mi.id`,
                    [brandId],
                ),
                this.dataSource.query<
                    Array<{ menu_item_id: number; modifier_group_id: number }>
                >(
                    `SELECT x.menu_item_id, x.modifier_group_id
                     FROM menu_item_modifier_groups x
                     JOIN menu_items mi ON mi.id = x.menu_item_id
                     WHERE mi.brand_id = $1`,
                    [brandId],
                ),
                // Only options that cost something: a fixed price has nothing
                // to "include" in a free one.
                this.dataSource.query<
                    Array<{
                        id: number;
                        name: string;
                        price: string;
                        modifier_group_id: number;
                        group_name: string;
                    }>
                >(
                    `SELECT m.id, m.name, m.price, m.modifier_group_id,
                            g.name AS group_name
                     FROM modifiers m
                     JOIN modifier_groups g ON g.id = m.modifier_group_id
                     WHERE g.brand_id = $1
                       AND (m.price > 0 OR (m.price_by_size IS NOT NULL
                            AND m.price_by_size::text NOT IN ('null', '{}')))
                     ORDER BY g.name, g.id, m.sort_order, m.id`,
                    [brandId],
                ),
                this.dataSource.query<
                    Array<{ id: number; name: string; is_active: boolean }>
                >(
                    `SELECT b.id, b.name, b.is_active
                     FROM branches b
                     JOIN branch_brands bb ON bb.branch_id = b.id
                     WHERE bb.brand_id = $1
                     ORDER BY b.name, b.id`,
                    [brandId],
                ),
            ]);

        const groupsOf = new Map<number, number[]>();
        for (const l of links) {
            const list = groupsOf.get(Number(l.menu_item_id)) ?? [];
            list.push(Number(l.modifier_group_id));
            groupsOf.set(Number(l.menu_item_id), list);
        }
        return {
            categories: categories.map((c) => ({
                id: Number(c.id),
                name: c.name,
                is_active: !!c.is_active,
            })),
            products: products.map((p) => ({
                id: Number(p.id),
                name: p.name,
                base_price: Number(p.base_price),
                is_active: !!p.is_active,
                category_id:
                    p.category_id != null ? Number(p.category_id) : null,
                category_name: p.category_name,
                modifier_group_ids: groupsOf.get(Number(p.id)) ?? [],
            })),
            modifier_options: options.map((o) => ({
                id: Number(o.id),
                name: o.name,
                price: Number(o.price),
                group_id: Number(o.modifier_group_id),
                group_name: o.group_name,
            })),
            branches: branches.map((b) => ({
                id: Number(b.id),
                name: b.name,
                is_active: !!b.is_active,
            })),
        };
    }

    async create(
        tenantId: number | null,
        dto: PrintedVoucherDto,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const voucher = this.repo.create({
            tenantId,
            brandId: 0,
            name: '',
            voucherType: dto.voucher_type ?? 'fixed_price',
            value: 0,
            maxDiscountAmount: null,
            categoryIds: null,
            productIds: null,
            includedModifierIds: null,
            eligibilityBranchIds: null,
            orderTypes: null,
            validFrom: null,
            validUntil: null,
            sortOrder: 0,
            isActive: dto.is_active ?? true,
        });
        this.applyFields(voucher, dto);
        this.assertBrandAllowed(voucher.brandId, allowedBrandIds);
        await this.assertValid(voucher, tenantId);
        const saved = await this.repo.save(voucher);
        return (await this.toResponses([saved]))[0];
    }

    async update(
        id: number,
        tenantId: number | null,
        dto: PrintedVoucherDto,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const voucher = await this.repo.findOne({ where: { id, tenantId } });
        if (!voucher) throw new NotFoundException('Voucher not found');
        // Both the brand it has and the brand it is being moved to.
        this.assertBrandAllowed(voucher.brandId, allowedBrandIds);
        this.applyFields(voucher, dto);
        this.assertBrandAllowed(voucher.brandId, allowedBrandIds);
        await this.assertValid(voucher, tenantId);
        const saved = await this.repo.save(voucher);
        return (await this.toResponses([saved]))[0];
    }

    /**
     * Deletion retires the button. Orders that used the voucher keep their
     * snapshotted name and amount (order_printed_vouchers.printed_voucher_id
     * is ON DELETE SET NULL), so the report still counts them — under the
     * name they were given.
     */
    async remove(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const voucher = await this.repo.findOne({ where: { id, tenantId } });
        if (!voucher) throw new NotFoundException('Voucher not found');
        this.assertBrandAllowed(voucher.brandId, allowedBrandIds);
        await this.repo.remove(voucher);
        return { deleted: true };
    }

    /**
     * The redemption report: which vouchers were used, how many papers of
     * each, where, when, by whom, and what they took off — the system's side
     * of counting the paper vouchers staff collected. Several vouchers can sit
     * on one order, so papers and orders are counted separately.
     *
     * Counts orders PLACED in the range (the voucher changes hands when the
     * order is rung up), cancelled ones excluded. Day bounds are the server's
     * local days, the same convention the sales reports use, so a day here
     * and a day there cover the same orders.
     */
    async report(
        tenantId: number | null,
        filters: {
            date_from?: string;
            date_to?: string;
            branch_id?: number;
            brand_id?: number;
            voucher_id?: number;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const restrictedBranches =
            Array.isArray(allowedBranchIds) && allowedBranchIds.length > 0
                ? allowedBranchIds
                : null;
        if (
            filters.branch_id != null &&
            restrictedBranches != null &&
            !restrictedBranches.includes(filters.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (
            filters.brand_id != null &&
            allowedBrandIds != null &&
            !allowedBrandIds.includes(filters.brand_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }

        const today = new Date();
        const dayStart = (ymd: string | null): Date => {
            if (!ymd) return new Date(new Date(today).setHours(0, 0, 0, 0));
            const [y, m, d] = ymd.split('-').map(Number);
            return new Date(y, m - 1, d, 0, 0, 0, 0);
        };
        const dayEnd = (ymd: string | null): Date => {
            if (!ymd)
                return new Date(new Date(today).setHours(23, 59, 59, 999));
            const [y, m, d] = ymd.split('-').map(Number);
            return new Date(y, m - 1, d, 23, 59, 59, 999);
        };
        const dateFrom = dayStart(parseDay(filters.date_from));
        const dateTo = dayEnd(parseDay(filters.date_to));

        const params: unknown[] = [tenantId, dateFrom, dateTo];
        const where: string[] = [
            'o.tenant_id = $1',
            'o.voucher_name IS NOT NULL',
            "o.status <> 'cancelled'",
            'o.placed_at BETWEEN $2 AND $3',
        ];
        const add = (sql: string, value: unknown) => {
            params.push(value);
            where.push(sql.replace('?', `$${params.length}`));
        };
        if (restrictedBranches != null)
            add('o.branch_id = ANY(?::int[])', restrictedBranches);
        if (allowedBrandIds != null)
            add('o.brand_id = ANY(?::int[])', allowedBrandIds);
        if (filters.branch_id != null)
            add('o.branch_id = ?', filters.branch_id);
        if (filters.brand_id != null) add('o.brand_id = ?', filters.brand_id);
        // An order holds one row per voucher kind it used (order_printed_vouchers),
        // with a paper count. Narrowing by voucher narrows to those rows.
        let voucherFilter = '';
        if (filters.voucher_id != null) {
            params.push(filters.voucher_id);
            voucherFilter = ` AND v.printed_voucher_id = $${params.length}`;
        }
        const whereSql = where.join(' AND ');
        const voucherRows = `FROM order_printed_vouchers v
                 JOIN orders o ON o.id = v.order_id`;
        const voucherRowsWhere = `WHERE ${whereSql}${voucherFilter}`;
        const usedVouchers = `EXISTS (SELECT 1 FROM order_printed_vouchers v
                                     WHERE v.order_id = o.id${voucherFilter})`;

        // A voucher renamed mid-range must stay one row: live vouchers group by
        // id under their current name; deleted ones by the name they had.
        const voucherKey = `COALESCE(pv.name, v.voucher_name)`;
        const [papers, orders, byVoucher, byDay, rows] = await Promise.all([
            this.dataSource.query<Array<Record<string, string>>>(
                `SELECT COALESCE(SUM(v.quantity), 0) AS papers,
                        COALESCE(SUM(v.discount_amount), 0) AS discount,
                        COUNT(DISTINCT o.id) AS redemptions
                 ${voucherRows}
                 ${voucherRowsWhere}`,
                params,
            ),
            this.dataSource.query<Array<Record<string, string>>>(
                `SELECT COALESCE(SUM(o.subtotal), 0) AS subtotal,
                        COALESCE(SUM(o.total_amount), 0) AS total
                 FROM orders o
                 WHERE ${whereSql} AND ${usedVouchers}`,
                params,
            ),
            this.dataSource.query<Array<Record<string, string | null>>>(
                `SELECT v.printed_voucher_id AS voucher_id,
                        ${voucherKey} AS voucher_name,
                        pv.voucher_type, pv.value,
                        b.name AS brand_name,
                        COUNT(DISTINCT o.id) AS redemptions,
                        COALESCE(SUM(v.quantity), 0) AS papers,
                        COALESCE(SUM(v.discount_amount), 0) AS discount,
                        COALESCE(SUM(o.total_amount), 0) AS total
                 ${voucherRows}
                 LEFT JOIN printed_vouchers pv ON pv.id = v.printed_voucher_id
                 LEFT JOIN brands b ON b.id = o.brand_id
                 ${voucherRowsWhere}
                 GROUP BY v.printed_voucher_id, ${voucherKey}, pv.voucher_type,
                          pv.value, b.name
                 ORDER BY COALESCE(SUM(v.quantity), 0) DESC, ${voucherKey}`,
                params,
            ),
            this.dataSource.query<Array<Record<string, string | null>>>(
                `SELECT to_char(o.placed_at, 'YYYY-MM-DD') AS day,
                        br.name AS branch_name,
                        ${voucherKey} AS voucher_name,
                        COUNT(DISTINCT o.id) AS redemptions,
                        COALESCE(SUM(v.quantity), 0) AS papers,
                        COALESCE(SUM(v.discount_amount), 0) AS discount
                 ${voucherRows}
                 LEFT JOIN printed_vouchers pv ON pv.id = v.printed_voucher_id
                 LEFT JOIN branches br ON br.id = o.branch_id
                 ${voucherRowsWhere}
                 GROUP BY to_char(o.placed_at, 'YYYY-MM-DD'), br.name, ${voucherKey}
                 ORDER BY 1 DESC, br.name, ${voucherKey}`,
                params,
            ),
            this.dataSource.query<Array<Record<string, unknown>>>(
                `SELECT o.id, o.order_id, o.order_number, o.placed_at, o.status,
                        o.order_type, o.customer_name, o.customer_phone,
                        o.subtotal, o.voucher_discount_amount, o.total_amount,
                        o.voucher_name,
                        (SELECT COALESCE(SUM(x.quantity), 0)
                           FROM order_printed_vouchers x
                          WHERE x.order_id = o.id) AS papers,
                        br.name AS branch_name, b.name AS brand_name,
                        u.name AS applied_by
                 FROM orders o
                 LEFT JOIN branches br ON br.id = o.branch_id
                 LEFT JOIN brands b ON b.id = o.brand_id
                 LEFT JOIN users u ON u.id = o.voucher_by
                 WHERE ${whereSql} AND ${usedVouchers}
                 ORDER BY o.placed_at DESC, o.id DESC
                 LIMIT ${REPORT_ROW_LIMIT + 1}`,
                params,
            ),
        ]);

        const p = papers[0] ?? {};
        const t = orders[0] ?? {};
        const paperCount = Number(p.papers ?? 0);
        const discount = Number(p.discount ?? 0);
        return {
            date_from: dateFrom.toISOString(),
            date_to: dateTo.toISOString(),
            totals: {
                /** Orders that used a voucher. */
                redemptions: Number(p.redemptions ?? 0),
                /** Paper vouchers collected — what the count sheet is matched against. */
                papers: paperCount,
                discount,
                /** What those orders were worth before the vouchers. */
                subtotal: Number(t.subtotal ?? 0),
                /** What was actually charged, tax included. */
                total: Number(t.total ?? 0),
                average_discount:
                    paperCount > 0
                        ? Math.round((discount / paperCount) * 100) / 100
                        : 0,
            },
            by_voucher: byVoucher.map((r) => ({
                voucher_id: r.voucher_id != null ? Number(r.voucher_id) : null,
                voucher_name: r.voucher_name,
                voucher_type: r.voucher_type,
                value: r.value != null ? Number(r.value) : null,
                brand_name: r.brand_name,
                redemptions: Number(r.redemptions ?? 0),
                papers: Number(r.papers ?? 0),
                discount: Number(r.discount ?? 0),
                total: Number(r.total ?? 0),
            })),
            by_day: byDay.map((r) => ({
                day: r.day,
                branch_name: r.branch_name,
                voucher_name: r.voucher_name,
                redemptions: Number(r.redemptions ?? 0),
                papers: Number(r.papers ?? 0),
                discount: Number(r.discount ?? 0),
            })),
            rows: rows.slice(0, REPORT_ROW_LIMIT).map((r) => ({
                id: Number(r.id),
                order_id: (r.order_id as string | null) ?? null,
                order_number: (r.order_number as string | null) ?? null,
                placed_at:
                    r.placed_at instanceof Date
                        ? r.placed_at.toISOString()
                        : null,
                status: r.status as string,
                order_type: r.order_type as string,
                customer_name: (r.customer_name as string | null) ?? null,
                customer_phone: (r.customer_phone as string | null) ?? null,
                subtotal: Number(r.subtotal ?? 0),
                discount: Number(r.voucher_discount_amount ?? 0),
                total: Number(r.total_amount ?? 0),
                /** The vouchers used, as a line: "Any Large Pizza ×3". */
                voucher_name: r.voucher_name as string,
                papers: Number(r.papers ?? 0),
                branch_name: (r.branch_name as string | null) ?? null,
                brand_name: (r.brand_name as string | null) ?? null,
                applied_by: (r.applied_by as string | null) ?? null,
            })),
            /** True when the list was cut at the row limit; the totals never are. */
            rows_truncated: rows.length > REPORT_ROW_LIMIT,
        };
    }
}
