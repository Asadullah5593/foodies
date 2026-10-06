import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
    PrintedVoucherDto,
    PrintedVouchersService,
} from './printed-vouchers.service';

/**
 * The voucher admin rules, the till's list and the report's scoping — with the
 * database mocked: `query` answers by which table a statement reads.
 */
type Row = Record<string, unknown>;

const FIREAWAY = 25;
const PEPERI = 23;

function build(
    opts: {
        vouchers?: Row[];
        /** ids that exist for the voucher's brand, per table */
        categories?: number[];
        products?: number[];
        modifiers?: number[];
        branches?: number[];
        brandTenant?: Record<number, number>;
        timezone?: string;
        reportRows?: Row[];
    } = {},
) {
    const saved: Row[] = [];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const brandTenant = opts.brandTenant ?? { [FIREAWAY]: 1, [PEPERI]: 1 };
    const existing = (allowed: number[] | undefined, params: unknown[]) =>
        ((params[0] as number[]) ?? [])
            .filter((id) => (allowed ?? []).includes(id))
            .map((id) => ({ id }));
    const query = jest.fn((sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM brands WHERE id = $1 AND tenant_id = $2'))
            return Promise.resolve(
                brandTenant[params[0] as number] === params[1]
                    ? [{ id: params[0] }]
                    : [],
            );
        if (sql.includes('SELECT timezone FROM branches'))
            return Promise.resolve([
                { timezone: opts.timezone ?? 'Asia/Karachi' },
            ]);
        if (sql.includes('FROM orders o') || sql.includes('JOIN orders o')) {
            if (
                sql.includes('AS papers,\n') &&
                sql.includes('AS redemptions\n')
            )
                return Promise.resolve([
                    { papers: '3', discount: '1500', redemptions: '2' },
                ]);
            if (sql.includes('AS subtotal,\n'))
                return Promise.resolve([{ subtotal: '3898', total: '2590' }]);
            return Promise.resolve(
                sql.includes('LIMIT') ? (opts.reportRows ?? []) : [],
            );
        }
        if (
            sql.includes(
                'FROM menu_categories WHERE id = ANY($1::int[]) AND brand_id',
            )
        )
            return Promise.resolve(existing(opts.categories, params));
        if (
            sql.includes(
                'FROM menu_items WHERE id = ANY($1::int[]) AND brand_id',
            )
        )
            return Promise.resolve(existing(opts.products, params));
        if (sql.includes('JOIN modifier_groups g'))
            return Promise.resolve(existing(opts.modifiers, params));
        if (sql.includes('FROM branch_brands bb'))
            return Promise.resolve(existing(opts.branches, params));
        // name lookups for the response
        return Promise.resolve([]);
    });
    const repo = {
        create: (v: Row) => ({ ...v }),
        save: jest.fn((v: Row) => {
            const row = { id: 77, ...v };
            saved.push(row);
            return Promise.resolve(row);
        }),
        find: jest.fn(({ where }: { where: Row }) =>
            Promise.resolve(
                (opts.vouchers ?? []).filter((v) =>
                    Object.entries(where).every(([k, val]) => v[k] === val),
                ),
            ),
        ),
        findOne: jest.fn(({ where }: { where: Row }) =>
            Promise.resolve(
                (opts.vouchers ?? []).find(
                    (v) => v.id === where.id && v.tenantId === where.tenantId,
                ) ?? null,
            ),
        ),
        remove: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PrintedVouchersService(
        repo as never,
        { query } as never,
    );
    return { service, repo, saved, queries, query };
}

const pizzaVoucher: PrintedVoucherDto = {
    name: ' Any Large Pizza ',
    brand_id: FIREAWAY,
    voucher_type: 'fixed_price',
    value: 999,
    category_ids: [501, 502, 501],
    order_types: ['pickup', 'dine_in'],
    valid_until: '2026-11-30',
};

describe('creating a printed voucher', () => {
    it('saves a fixed-price voucher scoped to its categories', async () => {
        const { service, saved } = build({ categories: [501, 502] });
        const res = await service.create(1, pizzaVoucher);
        expect(saved[0]).toMatchObject({
            tenantId: 1,
            brandId: FIREAWAY,
            name: 'Any Large Pizza',
            voucherType: 'fixed_price',
            value: 999,
            categoryIds: [501, 502],
            productIds: null,
            orderTypes: ['pickup', 'dine_in'],
            validFrom: null,
            validUntil: '2026-11-30',
            isActive: true,
        });
        expect(res).toMatchObject({
            id: 77,
            brand_id: FIREAWAY,
            voucher_type: 'fixed_price',
            value: 999,
            category_ids: [501, 502],
            valid_until: '2026-11-30',
        });
    });

    it('stores "every order type" one way: all three ticked is null', async () => {
        const { service, saved } = build({ categories: [501, 502] });
        await service.create(1, {
            ...pizzaVoucher,
            order_types: ['delivery', 'pickup', 'dine_in'],
        });
        expect(saved[0].orderTypes).toBeNull();
    });

    it.each<[string, Partial<PrintedVoucherDto>, RegExp]>([
        ['no name', { name: '  ' }, /name/],
        ['no brand', { brand_id: null }, /brand/],
        ['a zero price', { value: 0 }, /greater than zero/],
        [
            'a fixed price with nothing to apply it to',
            { category_ids: [], product_ids: [] },
            /categories or products/,
        ],
        [
            'a maximum on a fixed price',
            { max_discount_amount: 500 },
            /only applies to a percentage/,
        ],
        ['a made-up date', { valid_until: '2026-02-30' }, /not a valid date/],
        [
            'dates the wrong way round',
            { valid_from: '2026-12-01', valid_until: '2026-11-30' },
            /cannot be before/,
        ],
        [
            "another brand's category",
            { category_ids: [501, 999] },
            /categories do not belong/,
        ],
    ])('refuses %s', async (_label, patch, message) => {
        const { service, repo } = build({ categories: [501, 502] });
        await expect(
            service.create(1, { ...pizzaVoucher, ...patch }),
        ).rejects.toThrow(message);
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses a percentage above 100 or one with "price includes"', async () => {
        const { service } = build({ modifiers: [9001] });
        const pct: PrintedVoucherDto = {
            name: '30% off',
            brand_id: FIREAWAY,
            voucher_type: 'percentage',
            value: 30,
        };
        await expect(service.create(1, { ...pct, value: 130 })).rejects.toThrow(
            /cannot exceed 100%/,
        );
        await expect(
            service.create(1, { ...pct, included_modifier_ids: [9001] }),
        ).rejects.toThrow(/only applies to a fixed-price/);
    });

    it('lets a percentage voucher cover the whole menu', async () => {
        const { service, saved } = build();
        await service.create(1, {
            name: '30% off',
            brand_id: FIREAWAY,
            voucher_type: 'percentage',
            value: 30,
            max_discount_amount: 1000,
        });
        expect(saved[0]).toMatchObject({
            voucherType: 'percentage',
            categoryIds: null,
            productIds: null,
            maxDiscountAmount: 1000,
        });
    });

    it('checks products, included options and branches against the brand', async () => {
        const meal: PrintedVoucherDto = {
            name: 'Classic Smashed Burger Meal',
            brand_id: PEPERI,
            voucher_type: 'fixed_price',
            value: 799,
            product_ids: [300],
            included_modifier_ids: [9001],
            eligibility_branch_ids: [10, 17],
        };
        const ok = build({
            products: [300],
            modifiers: [9001],
            branches: [10, 17],
        });
        await ok.service.create(1, meal);
        expect(ok.saved[0]).toMatchObject({
            productIds: [300],
            includedModifierIds: [9001],
            eligibilityBranchIds: [10, 17],
        });

        await expect(
            build({
                products: [300],
                modifiers: [],
                branches: [10, 17],
            }).service.create(1, meal),
        ).rejects.toThrow(/included options do not belong/);
        await expect(
            build({
                products: [300],
                modifiers: [9001],
                branches: [10],
            }).service.create(1, meal),
        ).rejects.toThrow(/branches do not sell/);
    });

    it("refuses a brand that is not the tenant's", async () => {
        const { service } = build({ brandTenant: { [FIREAWAY]: 2 } });
        await expect(service.create(1, pizzaVoucher)).rejects.toThrow(
            /does not belong to this tenant/,
        );
    });

    it('is tenant work: a super admin with no tenant is refused', async () => {
        const { service } = build();
        await expect(service.create(null, pizzaVoucher)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
    });
});

describe('brand lock', () => {
    const stored = [
        {
            id: 1,
            tenantId: 1,
            brandId: FIREAWAY,
            name: 'Pizza',
            voucherType: 'fixed_price',
            value: 999,
            categoryIds: [501],
            isActive: true,
            sortOrder: 0,
        },
        {
            id: 2,
            tenantId: 1,
            brandId: PEPERI,
            name: 'Burger',
            voucherType: 'fixed_price',
            value: 799,
            productIds: [300],
            isActive: true,
            sortOrder: 0,
        },
    ];

    it('a brand admin lists only their own brand', async () => {
        const { service } = build({ vouchers: stored });
        const mine = await service.findAll(1, [PEPERI]);
        expect(mine.map((v) => v.id)).toEqual([2]);
        const all = await service.findAll(1, null);
        expect(all.map((v) => v.id)).toEqual([1, 2]);
    });

    it('a brand admin cannot create, edit, move or delete across brands', async () => {
        const { service, repo } = build({
            vouchers: stored,
            categories: [501],
            products: [300],
        });
        await expect(
            service.create(1, pizzaVoucher, [PEPERI]),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            service.update(1, 1, { name: 'x' }, [PEPERI]),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // Their own voucher, but moved to a brand they do not hold.
        await expect(
            service.update(2, 1, { brand_id: FIREAWAY }, [PEPERI]),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.remove(1, 1, [PEPERI])).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        expect(repo.save).not.toHaveBeenCalled();
        expect(repo.remove).not.toHaveBeenCalled();
    });

    it('editing re-validates the whole voucher', async () => {
        const { service } = build({ vouchers: stored, categories: [501] });
        await expect(
            service.update(1, 1, { category_ids: [] }),
        ).rejects.toThrow(/categories or products/);
        await expect(
            service.update(99, 1, { name: 'x' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe("the till's voucher buttons", () => {
    const base = {
        tenantId: 1,
        brandId: FIREAWAY,
        voucherType: 'fixed_price',
        value: 999,
        isActive: true,
        sortOrder: 0,
    };
    const vouchers = [
        { ...base, id: 1, name: 'Pizza', orderTypes: ['pickup', 'dine_in'] },
        { ...base, id: 2, name: 'Johar Town only', eligibilityBranchIds: [17] },
        { ...base, id: 3, name: 'Expired', validUntil: '2020-01-01' },
        { ...base, id: 4, name: 'Off', isActive: false },
        { ...base, id: 5, name: 'Burger', brandId: PEPERI },
    ];

    it("shows only the cart brand's usable vouchers", async () => {
        const { service } = build({ vouchers });
        const list = await service.findForTill(1, null, {
            branchId: 10,
            brandId: FIREAWAY,
            orderType: 'dine_in',
        });
        expect(list).toEqual([
            { id: 1, name: 'Pizza', voucher_type: 'fixed_price', value: 999 },
        ]);
    });

    it('hides a dine-in/takeaway voucher on a delivery order', async () => {
        const { service } = build({ vouchers });
        const list = await service.findForTill(1, null, {
            branchId: 17,
            brandId: FIREAWAY,
            orderType: 'delivery',
        });
        expect(list.map((v) => v.id)).toEqual([2]);
    });

    it('offers nothing without a single brand, or outside a brand lock', async () => {
        const { service, repo } = build({ vouchers });
        await expect(
            service.findForTill(1, null, { branchId: 10, brandId: null }),
        ).resolves.toEqual([]);
        await expect(
            service.findForTill(1, [PEPERI], {
                branchId: 10,
                brandId: FIREAWAY,
                orderType: 'dine_in',
            }),
        ).resolves.toEqual([]);
        expect(repo.find).not.toHaveBeenCalled();
    });
});

describe('the redemption report', () => {
    const lastOrdersQuery = (
        queries: Array<{ sql: string; params: unknown[] }>,
    ) => queries.filter((q) => q.sql.includes('FROM orders o')).pop()!;

    it('counts voucher orders placed in the range, cancelled ones excluded', async () => {
        const { service, queries } = build();
        const res = await service.report(1, {
            date_from: '2026-10-01',
            date_to: '2026-10-05',
        });
        const { sql, params } = lastOrdersQuery(queries);
        expect(sql).toContain('o.voucher_name IS NOT NULL');
        expect(sql).toContain("o.status <> 'cancelled'");
        expect(sql).toContain('o.placed_at BETWEEN $2 AND $3');
        expect(params[0]).toBe(1);
        expect(params[1]).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
        expect(params[2]).toEqual(new Date(2026, 9, 5, 23, 59, 59, 999));
        // Three papers on two orders: the average is per paper.
        expect(res.totals).toEqual({
            redemptions: 2,
            papers: 3,
            discount: 1500,
            subtotal: 3898,
            total: 2590,
            average_discount: 500,
        });
    });

    it("is limited to the caller's branches and brands", async () => {
        const { service, queries } = build();
        await service.report(1, {}, [10, 17], [FIREAWAY]);
        const { sql, params } = lastOrdersQuery(queries);
        expect(sql).toContain('o.branch_id = ANY($4::int[])');
        expect(sql).toContain('o.brand_id = ANY($5::int[])');
        expect(params.slice(3)).toEqual([[10, 17], [FIREAWAY]]);
    });

    it('refuses a branch or brand filter outside that scope', async () => {
        const { service } = build();
        await expect(
            service.report(1, { branch_id: 16 }, [10, 17], null),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            service.report(1, { brand_id: PEPERI }, null, [FIREAWAY]),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('narrows by branch, brand and voucher when asked', async () => {
        const { service, queries } = build();
        await service.report(1, {
            branch_id: 10,
            brand_id: FIREAWAY,
            voucher_id: 5,
        });
        const { sql, params } = lastOrdersQuery(queries);
        expect(sql).toContain('o.branch_id = $4');
        expect(sql).toContain('o.brand_id = $5');
        expect(sql).toContain('v.printed_voucher_id = $6');
        expect(params.slice(3)).toEqual([10, FIREAWAY, 5]);
    });

    it('lists each redemption with who applied it', async () => {
        const { service } = build({
            reportRows: [
                {
                    id: 900,
                    order_id: 'FDS-AAA',
                    order_number: '004',
                    placed_at: new Date('2026-10-05T09:30:00Z'),
                    status: 'completed',
                    order_type: 'dine_in',
                    customer_name: 'Ali',
                    customer_phone: '03001234567',
                    subtotal: '1949.00',
                    voucher_discount_amount: '950.00',
                    total_amount: '1158.84',
                    voucher_name: 'Any Large Pizza ×2',
                    papers: '2',
                    branch_name: 'Pine Avenue',
                    brand_name: 'Fireaway',
                    applied_by: 'Cashier One',
                },
            ],
        });
        const res = await service.report(1, {});
        expect(res.rows).toEqual([
            {
                id: 900,
                order_id: 'FDS-AAA',
                order_number: '004',
                placed_at: '2026-10-05T09:30:00.000Z',
                status: 'completed',
                order_type: 'dine_in',
                customer_name: 'Ali',
                customer_phone: '03001234567',
                subtotal: 1949,
                discount: 950,
                total: 1158.84,
                voucher_name: 'Any Large Pizza ×2',
                papers: 2,
                branch_name: 'Pine Avenue',
                brand_name: 'Fireaway',
                applied_by: 'Cashier One',
            },
        ]);
        expect(res.rows_truncated).toBe(false);
    });

    it('is refused outside a tenant', async () => {
        const { service } = build();
        await expect(service.report(null, {})).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(service.findAll(null)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
    });
});
