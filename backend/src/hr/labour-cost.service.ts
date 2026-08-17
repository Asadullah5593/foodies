import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayrollRun } from '../entities/payroll-run.entity';
import { Order } from '../entities/order.entity';
import { HrUser } from './employee-scope';

export type LabourCostFilters = {
    from: string;
    to: string;
    branch_id?: number;
    brand_id?: number;
};

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Labour cost as a percentage of sales — the number the owner actually looks at.
 *
 * Two attribution decisions carry the whole report:
 *
 * 1. **Whole payroll runs only.** A run is the smallest unit of computed labour
 *    cost there is, so a run that only partly overlaps the range is EXCLUDED and
 *    counted in `excluded_partial_runs` rather than pro-rated. Pro-rating would
 *    invent a number, and silently including it would overstate a half-month.
 *
 * 2. **Shared staff are their own bucket.** An employee with no brand on their
 *    assignment (a cleaner, a guard) cannot be attributed to one brand, so their
 *    cost lands in a `brand_id: null` row instead of being spread across brands.
 *    Spreading it would make every brand's percentage wrong in a way nobody could
 *    see.
 *
 * Sales come from completed orders by `placed_at`, matching `reports/`, so this
 * report and the sales dashboard agree on the denominator.
 */
@Injectable()
export class LabourCostService {
    constructor(
        @InjectRepository(PayrollRun)
        private readonly runs: Repository<PayrollRun>,
        @InjectRepository(Order)
        private readonly orders: Repository<Order>,
    ) {}

    async report(user: HrUser, filters: LabourCostFilters) {
        if (!filters.from || !filters.to) {
            throw new BadRequestException('from and to are required');
        }
        if (filters.from > filters.to) {
            throw new BadRequestException('from must not be after to');
        }
        if (
            filters.branch_id &&
            user.allowedBranchIds != null &&
            !user.allowedBranchIds.includes(filters.branch_id)
        ) {
            throw new BadRequestException('That branch is out of your scope');
        }

        const labour = await this.labourByBranchBrand(user, filters);
        const sales = await this.salesByBranchBrand(user, filters);
        const excluded = await this.partialRuns(user, filters);

        // Union of both key sets: a branch can have sales and no payroll run yet
        // (the month is not closed), and a closed branch can have payroll and no
        // sales. Dropping either side would hide the more interesting case.
        const keys = new Set([...labour.keys(), ...sales.keys()]);
        const rows: Bucket[] = [];
        for (const key of keys) {
            const l = labour.get(key);
            const s = sales.get(key);
            const netSales = s?.net_sales ?? 0;
            const labourCost = l?.labour_cost ?? 0;
            rows.push({
                branch_id: l?.branch_id ?? s?.branch_id ?? null,
                branch_name: l?.branch_name ?? s?.branch_name ?? null,
                brand_id: l?.brand_id ?? s?.brand_id ?? null,
                brand_name: l?.brand_name ?? s?.brand_name ?? null,
                labour_cost: round2(labourCost),
                net_sales: round2(netSales),
                revenue: round2(s?.revenue ?? 0),
                // Null rather than 0 or Infinity when there are no sales: "we
                // spent 40,000 on labour and sold nothing" is not 0%.
                labour_percent:
                    netSales > 0 ? round2((labourCost / netSales) * 100) : null,
                headcount: l?.headcount ?? 0,
            });
        }

        rows.sort(
            (a, b) =>
                (a.branch_name ?? '').localeCompare(b.branch_name ?? '') ||
                (a.brand_name ?? 'zzz').localeCompare(b.brand_name ?? 'zzz'),
        );

        const totalLabour = rows.reduce((s, r) => s + r.labour_cost, 0);
        const totalSales = rows.reduce((s, r) => s + r.net_sales, 0);

        return {
            period: { from: filters.from, to: filters.to },
            rows,
            totals: {
                labour_cost: round2(totalLabour),
                net_sales: round2(totalSales),
                revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
                labour_percent:
                    totalSales > 0
                        ? round2((totalLabour / totalSales) * 100)
                        : null,
                headcount: rows.reduce((s, r) => s + r.headcount, 0),
            },
            /** Runs straddling the range boundary, named rather than silently dropped. */
            excluded_partial_runs: excluded,
        };
    }

    /**
     * Labour cost from whole payroll runs, keyed `branchId:brandId`.
     *
     * Brand is the employee's assignment for the run period (the latest one that
     * overlaps it), not their assignment today — a transfer in October must not
     * rewrite September's cost.
     */
    private async labourByBranchBrand(
        user: HrUser,
        filters: LabourCostFilters,
    ) {
        const params: unknown[] = [filters.from, filters.to];
        let where = 'r.period_from >= $1 AND r.period_to <= $2';

        // Approved is the point at which a payroll number is real. Computed runs
        // are still being argued about, and including them would make the report
        // move under the reader.
        where += ` AND r.status IN ('approved', 'paid')`;

        if (user.tenantId != null) {
            params.push(user.tenantId);
            where += ` AND r.tenant_id = $${params.length}`;
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0)
                return new Map<string, Bucket>();
            params.push(user.allowedBranchIds);
            where += ` AND r.branch_id = ANY($${params.length}::int[])`;
        }
        if (filters.branch_id) {
            params.push(filters.branch_id);
            where += ` AND r.branch_id = $${params.length}`;
        }

        let brandFilter = '';
        if (user.allowedBrandIds != null) {
            params.push(user.allowedBrandIds);
            brandFilter += ` AND a.brand_id = ANY($${params.length}::int[])`;
        }
        if (filters.brand_id) {
            params.push(filters.brand_id);
            brandFilter += ` AND a.brand_id = $${params.length}`;
        }

        const rows = (await this.runs.query(
            `SELECT r.branch_id,
                    br.name              AS branch_name,
                    a.brand_id,
                    bd.name              AS brand_name,
                    SUM(l.net_payable)   AS labour_cost,
                    COUNT(DISTINCT l.employee_id) AS headcount
               FROM payroll_lines l
               JOIN payroll_runs r ON r.id = l.run_id
               LEFT JOIN branches br ON br.id = r.branch_id
               LEFT JOIN LATERAL (
                     SELECT ea.brand_id
                       FROM employee_assignments ea
                      WHERE ea.employee_id = l.employee_id
                        AND ea.effective_from <= r.period_to
                        AND (ea.effective_to IS NULL
                             OR ea.effective_to >= r.period_from)
                      ORDER BY ea.effective_from DESC
                      LIMIT 1
                   ) a ON TRUE
               LEFT JOIN brands bd ON bd.id = a.brand_id
              WHERE ${where}${brandFilter}
              GROUP BY r.branch_id, br.name, a.brand_id, bd.name`,
            params,
        )) as unknown as Array<{
            branch_id: number | null;
            branch_name: string | null;
            brand_id: number | null;
            brand_name: string | null;
            labour_cost: string;
            headcount: string;
        }>;

        const map = new Map<string, Bucket>();
        for (const r of rows) {
            map.set(`${r.branch_id ?? 'x'}:${r.brand_id ?? 'shared'}`, {
                branch_id: r.branch_id,
                branch_name: r.branch_name,
                brand_id: r.brand_id,
                brand_name: r.brand_name,
                labour_cost: Number(r.labour_cost),
                net_sales: 0,
                revenue: 0,
                labour_percent: null,
                headcount: Number(r.headcount),
            });
        }
        return map;
    }

    /** Completed-order sales per branch and brand, same convention as `reports/`. */
    private async salesByBranchBrand(user: HrUser, filters: LabourCostFilters) {
        const qb = this.orders
            .createQueryBuilder('o')
            .leftJoin('branches', 'br', 'br.id = o.branchId')
            .leftJoin('brands', 'bd', 'bd.id = o.brandId')
            .select('o.branchId', 'branch_id')
            .addSelect('br.name', 'branch_name')
            .addSelect('o.brandId', 'brand_id')
            .addSelect('bd.name', 'brand_name')
            .addSelect('COALESCE(SUM(o.subtotal), 0)', 'net_sales')
            .addSelect('COALESCE(SUM(o.totalAmount), 0)', 'revenue')
            .where("o.status = 'completed'")
            // Inclusive of the last day: a date-only `to` would otherwise cut the
            // final day off at midnight.
            .andWhere('o.placedAt >= :from::date', { from: filters.from })
            .andWhere("o.placedAt < (:to::date + INTERVAL '1 day')", {
                to: filters.to,
            })
            .groupBy('o.branchId')
            .addGroupBy('br.name')
            .addGroupBy('o.brandId')
            .addGroupBy('bd.name');

        if (user.tenantId != null) {
            qb.andWhere('o.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0)
                return new Map<string, Bucket>();
            qb.andWhere('o.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds: user.allowedBranchIds,
            });
        }
        if (filters.branch_id) {
            qb.andWhere('o.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        }
        if (user.allowedBrandIds != null) {
            qb.andWhere('o.brandId IN (:...allowedBrandIds)', {
                allowedBrandIds: user.allowedBrandIds,
            });
        }
        if (filters.brand_id) {
            qb.andWhere('o.brandId = :brandId', { brandId: filters.brand_id });
        }

        const rows = await qb.getRawMany<{
            branch_id: number | null;
            branch_name: string | null;
            brand_id: number | null;
            brand_name: string | null;
            net_sales: string;
            revenue: string;
        }>();

        const map = new Map<string, Bucket>();
        for (const r of rows) {
            map.set(`${r.branch_id ?? 'x'}:${r.brand_id ?? 'shared'}`, {
                branch_id: r.branch_id,
                branch_name: r.branch_name,
                brand_id: r.brand_id,
                brand_name: r.brand_name,
                labour_cost: 0,
                net_sales: Number(r.net_sales),
                revenue: Number(r.revenue),
                labour_percent: null,
                headcount: 0,
            });
        }
        return map;
    }

    /** Approved runs that straddle the range boundary and are therefore left out. */
    private async partialRuns(user: HrUser, filters: LabourCostFilters) {
        const qb = this.runs
            .createQueryBuilder('r')
            .leftJoin('branches', 'br', 'br.id = r.branchId')
            .select([
                'r.id AS id',
                'r.period_from AS period_from',
                'r.period_to AS period_to',
                'br.name AS branch_name',
            ])
            .where("r.status IN ('approved', 'paid')")
            // Overlaps the range but is not contained by it.
            .andWhere('r.periodFrom <= :to', { to: filters.to })
            .andWhere('r.periodTo >= :from', { from: filters.from })
            .andWhere('(r.periodFrom < :from OR r.periodTo > :to)', {
                from: filters.from,
                to: filters.to,
            });

        if (user.tenantId != null) {
            qb.andWhere('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0) return [];
            qb.andWhere('r.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds: user.allowedBranchIds,
            });
        }
        if (filters.branch_id) {
            qb.andWhere('r.branchId = :branchId', {
                branchId: filters.branch_id,
            });
        }

        return qb.getRawMany<{
            id: number;
            period_from: string;
            period_to: string;
            branch_name: string | null;
        }>();
    }
}
