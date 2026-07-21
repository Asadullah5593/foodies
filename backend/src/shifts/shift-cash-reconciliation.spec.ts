import { Repository } from 'typeorm';
import { ShiftsService } from './shifts.service';
import { Shift } from '../entities/shift.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';

/**
 * Shift cash reconciliation.
 *
 * Expected cash used to be accrued per completed order at its FULL total, so a
 * card sale inflated the drawer expectation and a completed→cancelled order
 * inflated it permanently. It is now derived from the tenders themselves:
 *
 *   expected = opening cash
 *            + cash tendered during the shift
 *            + balance of completed orders nobody tendered   (rider is carrying it)
 *
 *   actual   = cash counted in the drawer + cash the riders handed in
 *
 * These pin that arithmetic, and the rule that a closed shift keeps the figure
 * frozen at close rather than drifting when old orders are touched.
 */
describe('ShiftsService — cash reconciliation', () => {
    const makeService = () => {
        const stub = {} as unknown;
        return new ShiftsService(
            stub as Repository<Shift>,
            stub as Repository<Order>,
            stub as Repository<Payment>,
        );
    };

    const shift = (over: Partial<Shift> = {}): Shift =>
        ({
            id: 1,
            branchId: 10,
            brandId: 25,
            openingCash: 1000,
            expectedCash: null,
            closingCash: null,
            riderCashCollected: null,
            status: 'open',
            openedAt: new Date('2026-07-22T06:00:00Z'),
            closedAt: null,
            ...over,
        }) as Shift;

    /** computeExpectedCash with the outstanding-balance query stubbed out. */
    const expectedWith = async (
        s: Shift,
        cashCollected: number,
        outstanding: number,
    ) => {
        const service = makeService();
        jest.spyOn(
            service as unknown as { getOutstandingTotal: () => Promise<number> },
            'getOutstandingTotal',
        ).mockResolvedValue(outstanding);
        return (
            service as unknown as {
                computeExpectedCash: (a: Shift, b: number) => Promise<number>;
            }
        ).computeExpectedCash(s, cashCollected);
    };

    const respond = (s: Shift, expectedOverride?: number) =>
        (
            makeService() as unknown as {
                toResponse: (a: Shift, b?: number) => Record<string, number | null>;
            }
        ).toResponse(s, expectedOverride);

    describe('expected cash', () => {
        it('is opening cash plus the cash tendered', async () => {
            expect(await expectedWith(shift(), 5000, 0)).toBe(6000);
        });

        it('ignores card takings — they never reach the drawer', async () => {
            // 5000 cash + 3000 card tendered: only the cash counts.
            expect(await expectedWith(shift(), 5000, 0)).toBe(6000);
        });

        it('counts the balance of orders nobody tendered as cash owed', async () => {
            // A delivery order completed with no payment row: the rider holds it.
            expect(await expectedWith(shift(), 5000, 2000)).toBe(8000);
        });

        it('starts at the opening float on a shift with no sales', async () => {
            expect(await expectedWith(shift(), 0, 0)).toBe(1000);
        });
    });

    describe('actual cash and variance', () => {
        it('adds the rider cash to the drawer count', () => {
            const r = respond(
                shift({ status: 'closed', expectedCash: 8000, closingCash: 6000, riderCashCollected: 2000 }),
            );
            expect(r.drawer_cash).toBe(6000);
            expect(r.rider_cash_collected).toBe(2000);
            expect(r.actual_cash).toBe(8000);
            expect(r.difference).toBe(0);
        });

        it('reports a shortfall when a rider has not handed cash in', () => {
            // Expected includes 2000 the rider is carrying; none was handed over.
            const r = respond(
                shift({ status: 'closed', expectedCash: 8000, closingCash: 6000, riderCashCollected: 0 }),
            );
            expect(r.actual_cash).toBe(6000);
            expect(r.difference).toBe(-2000);
        });

        it('treats missing rider cash as zero rather than voiding the count', () => {
            const r = respond(
                shift({ status: 'closed', expectedCash: 1000, closingCash: 1000, riderCashCollected: null }),
            );
            expect(r.actual_cash).toBe(1000);
            expect(r.difference).toBe(0);
        });

        it('has no variance while the shift is still open', () => {
            const r = respond(shift(), 6000);
            expect(r.actual_cash).toBeNull();
            expect(r.difference).toBeNull();
        });
    });

    describe('open vs closed', () => {
        it('uses the derived figure for an open shift', () => {
            // Stored value is stale; the derived one wins.
            const r = respond(shift({ expectedCash: 99999 }), 6000);
            expect(r.expected_cash).toBe(6000);
        });

        it('keeps a closed shift frozen at the value stored on close', () => {
            const r = respond(
                shift({ status: 'closed', expectedCash: 4801, closingCash: 4500, riderCashCollected: 0 }),
            );
            expect(r.expected_cash).toBe(4801);
            expect(r.difference).toBe(-301);
        });
    });
});
