import { LabourCostService } from './labour-cost.service';
import { HrUser } from './employee-scope';

/**
 * The arithmetic and the attribution, not the SQL.
 *
 * What can go quietly wrong here is a percentage: dividing labour by zero sales,
 * or folding shared staff into a brand so every brand's figure is off by a bit
 * nobody can see.
 */
describe('LabourCostService.report', () => {
    const user: HrUser = {
        id: 1,
        tenantId: 3,
        allowedBranchIds: null,
        allowedBrandIds: null,
        permissions: ['payroll:view'],
    } as unknown as HrUser;

    type Bucket = {
        branch_id: number | null;
        branch_name: string | null;
        brand_id: number | null;
        brand_name: string | null;
        labour_cost: number;
        net_sales: number;
        revenue: number;
        labour_percent: number | null;
        headcount: number;
    };

    const bucket = (over: Partial<Bucket> = {}): Bucket => ({
        branch_id: 10,
        branch_name: 'Emporium',
        brand_id: 25,
        brand_name: 'Fireaway',
        labour_cost: 0,
        net_sales: 0,
        revenue: 0,
        labour_percent: null,
        headcount: 0,
        ...over,
    });

    function makeService(
        labour: Array<[string, Bucket]>,
        sales: Array<[string, Bucket]>,
        partial: unknown[] = [],
    ) {
        const noop = {} as never;
        const service = new LabourCostService(noop, noop);
        const s = service as unknown as Record<string, unknown>;
        s.labourByBranchBrand = jest.fn().mockResolvedValue(new Map(labour));
        s.salesByBranchBrand = jest.fn().mockResolvedValue(new Map(sales));
        s.partialRuns = jest.fn().mockResolvedValue(partial);
        return service;
    }

    const range = { from: '2026-08-01', to: '2026-08-31' };

    it('computes labour as a percentage of net sales', async () => {
        const service = makeService(
            [['10:25', bucket({ labour_cost: 120000, headcount: 8 })]],
            [['10:25', bucket({ net_sales: 400000, revenue: 460000 })]],
        );

        const out = await service.report(user, range);

        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].labour_percent).toBe(30);
        expect(out.totals.labour_percent).toBe(30);
        expect(out.rows[0].headcount).toBe(8);
    });

    it('reports no percentage — not zero — when there were no sales', async () => {
        const service = makeService(
            [['10:25', bucket({ labour_cost: 40000 })]],
            [],
        );

        const out = await service.report(user, range);

        // "Spent 40,000 and sold nothing" is not 0%, and it is not 100% either.
        expect(out.rows[0].labour_percent).toBeNull();
        expect(out.totals.labour_percent).toBeNull();
        expect(out.totals.labour_cost).toBe(40000);
    });

    it('keeps brandless staff in their own row rather than spreading them', async () => {
        const service = makeService(
            [
                ['10:25', bucket({ labour_cost: 100000 })],
                [
                    '10:shared',
                    bucket({
                        brand_id: null,
                        brand_name: null,
                        labour_cost: 30000,
                    }),
                ],
            ],
            [['10:25', bucket({ net_sales: 500000 })]],
        );

        const out = await service.report(user, range);

        const branded = out.rows.find((r) => r.brand_id === 25)!;
        const shared = out.rows.find((r) => r.brand_id === null)!;
        // The brand carries only its own cost…
        expect(branded.labour_percent).toBe(20);
        // …and the shared cost is visible instead of hidden inside it.
        expect(shared.labour_cost).toBe(30000);
        expect(shared.labour_percent).toBeNull();
        // The total still includes both.
        expect(out.totals.labour_cost).toBe(130000);
        expect(out.totals.labour_percent).toBe(26);
    });

    it('keeps a branch with sales but no payroll run yet', async () => {
        const service = makeService(
            [],
            [
                [
                    '11:25',
                    bucket({
                        branch_id: 11,
                        branch_name: 'Gulberg',
                        net_sales: 200000,
                    }),
                ],
            ],
        );

        const out = await service.report(user, range);

        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].labour_cost).toBe(0);
        expect(out.rows[0].labour_percent).toBe(0);
    });

    it('names the runs it left out instead of pro-rating them', async () => {
        const service = makeService(
            [],
            [],
            [
                {
                    id: 4,
                    period_from: '2026-07-16',
                    period_to: '2026-08-15',
                    branch_name: 'Emporium',
                },
            ],
        );

        const out = await service.report(user, range);

        expect(out.excluded_partial_runs).toHaveLength(1);
        expect(out.excluded_partial_runs[0].id).toBe(4);
    });

    it('rejects a backwards range', async () => {
        const service = makeService([], []);
        await expect(
            service.report(user, { from: '2026-08-31', to: '2026-08-01' }),
        ).rejects.toThrow('from must not be after to');
    });
});
