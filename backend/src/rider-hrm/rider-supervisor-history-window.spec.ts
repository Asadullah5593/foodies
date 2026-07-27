import { RiderSupervisorService } from './rider-supervisor.service';

/**
 * The supervisor's placement-date filtering: which WHERE clauses land on the
 * query for a given (role window, picked dates) pair. Exercised through a fake
 * QueryBuilder so the rules are pinned without a database.
 */
type Clause = { sql: string; params?: Record<string, unknown> };

function fakeQb(captured: Clause[]) {
    const qb: Record<string, unknown> = {};
    for (const m of [
        'where',
        'andWhere',
        'select',
        'addSelect',
        'groupBy',
        'orderBy',
        'skip',
        'take',
        'leftJoinAndSelect',
    ]) {
        qb[m] = (sql: unknown, params?: Record<string, unknown>) => {
            if (m === 'where' || m === 'andWhere')
                captured.push({ sql: String(sql), params });
            return qb;
        };
    }
    qb.getRawMany = () => Promise.resolve([]);
    qb.getManyAndCount = () => Promise.resolve([[], 0]);
    return qb;
}

async function runList(
    user: { orderHistoryDays?: number | null; canViewStatus?: boolean },
    filters: {
        date_from?: string;
        date_to?: string;
        rider_id?: number;
        status?: string;
    },
): Promise<Clause[]> {
    const captured: Clause[] = [];
    const orderRepo = { createQueryBuilder: () => fakeQb(captured) };
    const service = new RiderSupervisorService(
        orderRepo as never,
        { query: () => Promise.resolve([]) } as never,
    );
    await service.listDeliveryOrders(
        { tenantId: 1, ...user },
        filters as never,
    );
    return captured;
}

/** The full response, for the status-permission assertions. */
async function runListResult(
    user: { canViewStatus?: boolean },
    filters: { status?: string } = {},
) {
    const captured: Clause[] = [];
    const orderRepo = { createQueryBuilder: () => fakeQb(captured) };
    const service = new RiderSupervisorService(
        orderRepo as never,
        { query: () => Promise.resolve([]) } as never,
    );
    return service.listDeliveryOrders(
        { tenantId: 1, ...user },
        filters as never,
    );
}

const sqlOf = (c: Clause[]) => c.map((x) => x.sql).join(' | ');
const paramOf = (c: Clause[], key: string) =>
    c.find((x) => x.params && key in x.params)?.params?.[key];

describe('RiderSupervisor delivery-order date filtering', () => {
    it('defaults to the rolling 30-day window when no dates are picked', async () => {
        const c = await runList({}, {});
        expect(sqlOf(c)).toContain('CURRENT_DATE - CAST(:days AS int) + 1');
        expect(paramOf(c, 'days')).toBe(30);
    });

    it('uses the picked range instead of the default window', async () => {
        const c = await runList(
            {},
            {
                date_from: '2026-01-01',
                date_to: '2026-02-01',
            },
        );
        expect(sqlOf(c)).toContain('date(o.placed_at) >= :dateFrom');
        expect(sqlOf(c)).toContain('date(o.placed_at) <= :dateTo');
        expect(paramOf(c, 'dateFrom')).toBe('2026-01-01');
        // No default-window clause once the user drives the range.
        expect(sqlOf(c)).not.toContain(':days');
    });

    it('applies the role window as a hard floor on top of a wider pick', async () => {
        const c = await runList(
            { orderHistoryDays: 7 },
            { date_from: '2020-01-01' },
        );
        expect(sqlOf(c)).toContain(
            'CURRENT_DATE - CAST(:historyDays AS int) + 1',
        );
        expect(paramOf(c, 'historyDays')).toBe(7);
        // The client's date_from is still applied — the floor only narrows.
        expect(paramOf(c, 'dateFrom')).toBe('2020-01-01');
    });

    it('applies the role window even with no dates picked', async () => {
        const c = await runList({ orderHistoryDays: 7 }, {});
        expect(paramOf(c, 'historyDays')).toBe(7);
    });

    it('treats null / 0 / negative history days as unlimited', async () => {
        for (const days of [null, 0, -5]) {
            const c = await runList(
                { orderHistoryDays: days },
                {
                    date_from: '2020-01-01',
                },
            );
            expect(sqlOf(c)).not.toContain(':historyDays');
        }
    });

    it('ignores malformed dates rather than filtering on junk', async () => {
        const c = await runList(
            {},
            {
                date_from: 'not-a-date',
                date_to: '01/02/2026',
            },
        );
        expect(sqlOf(c)).not.toContain(':dateFrom');
        expect(sqlOf(c)).not.toContain(':dateTo');
        // Falls back to the default window, so the page is never unbounded.
        expect(paramOf(c, 'days')).toBe(30);
    });

    it('filters by rider when asked', async () => {
        const c = await runList({}, { rider_id: 42 });
        expect(sqlOf(c)).toContain('o.riderId = :riderFilter');
        expect(paramOf(c, 'riderFilter')).toBe(42);
    });

    it('does not filter by rider when not asked', async () => {
        const c = await runList({}, {});
        expect(sqlOf(c)).not.toContain('riderFilter');
    });
});

describe('RiderSupervisor status permission (rider-supervisor:view-status)', () => {
    it('returns bucket counts when the caller may see status', async () => {
        const res = await runListResult({ canViewStatus: true });
        expect(res.counts).toEqual({
            active: 0,
            delivered: 0,
            cancelled: 0,
            all: 0,
        });
        expect(res.can_view_status).toBe(true);
    });

    it('withholds counts entirely when the caller may not', async () => {
        const res = await runListResult({ canViewStatus: false });
        expect(res.counts).toBeNull();
        expect(res.can_view_status).toBe(false);
    });

    it('ignores the status filter without the permission (no bucket leak)', async () => {
        const denied = await runListResult(
            { canViewStatus: false },
            { status: 'cancelled' },
        );
        expect(denied.status).toBe('all');
        const allowed = await runListResult(
            { canViewStatus: true },
            { status: 'cancelled' },
        );
        expect(allowed.status).toBe('cancelled');
    });

    it('defaults to permitted when the flag is absent (internal callers)', async () => {
        const res = await runListResult({});
        expect(res.can_view_status).toBe(true);
    });
});
