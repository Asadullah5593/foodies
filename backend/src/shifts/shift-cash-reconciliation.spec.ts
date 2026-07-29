import { Repository } from 'typeorm';
import { ShiftsService } from './shifts.service';
import { Shift } from '../entities/shift.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';

/**
 * Shift cash reconciliation.
 *
 * The till reconciles purely on cash that physically passed through it:
 *
 *   expected = opening cash
 *            + cash tendered during the shift
 *            − cash handed out mid-shift            (cash-outs, voided excluded)
 *
 *   actual   = cash counted in the drawer
 *
 * Rider cash was removed from this arithmetic entirely: money a rider is still
 * carrying is not in the drawer and is no longer expected to be, and the close
 * no longer asks what they handed in.
 *
 * A cash-out lowers what the drawer should hold rather than adjusting the count
 * — the money left the till, so the counter naturally reflects it and
 * `difference` keeps meaning "real variance".
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
            status: 'open',
            openedAt: new Date('2026-07-22T06:00:00Z'),
            closedAt: null,
            ...over,
        }) as Shift;

    /** computeExpectedCash(shift, cashCollected, cashOutTotal). */
    const expectedWith = (s: Shift, cashCollected: number, cashOutTotal = 0) =>
        (
            makeService() as unknown as {
                computeExpectedCash: (a: Shift, b: number, c: number) => number;
            }
        ).computeExpectedCash(s, cashCollected, cashOutTotal);

    const respond = (s: Shift, expectedOverride?: number, cashOutTotal = 0) =>
        (
            makeService() as unknown as {
                toResponse: (
                    a: Shift,
                    b?: number,
                    c?: number,
                ) => Record<string, number | null>;
            }
        ).toResponse(s, expectedOverride, cashOutTotal);

    describe('expected cash', () => {
        it('is opening cash plus the cash tendered', () => {
            expect(expectedWith(shift(), 5000)).toBe(6000);
        });

        it('ignores card takings — they never reach the drawer', () => {
            expect(expectedWith(shift(), 5000)).toBe(6000);
        });

        it('starts at the opening float on a shift with no sales', () => {
            expect(expectedWith(shift(), 0)).toBe(1000);
        });

        it('ignores money riders are still carrying', () => {
            expect(expectedWith(shift(), 5000)).toBe(6000);
        });
    });

    describe('cash-out lowers what the drawer should hold', () => {
        it('subtracts a mid-shift hand-over from expected cash', () => {
            expect(expectedWith(shift(), 5000, 2000)).toBe(4000);
        });

        it('subtracts the combined total of several hand-overs', () => {
            expect(expectedWith(shift(), 5000, 2000 + 1500)).toBe(2500);
        });

        it('can drive expected below the opening float — and does not clamp', () => {
            expect(expectedWith(shift(), 0, 1500)).toBe(-500);
        });

        it('leaves expected untouched when nothing was taken', () => {
            expect(expectedWith(shift(), 5000, 0)).toBe(6000);
        });

        it('rounds to whole paisa — no binary-float tails in the figure', () => {
            // 5000 + 90622.24 − 45000 drifts to 50622.240000000005 unrounded.
            expect(
                expectedWith(shift({ openingCash: 5000 }), 90622.24, 45000),
            ).toBe(50622.24);
        });

        it('reports a balanced drawer when the count matches expected net of cash-outs', () => {
            // 1000 + 5000 − 2000 = 4000 expected; 4000 counted.
            const r = respond(
                shift({
                    status: 'closed',
                    expectedCash: 4000,
                    closingCash: 4000,
                }),
                undefined,
                2000,
            );
            expect(r.expected_cash).toBe(4000);
            expect(r.cash_out_total).toBe(2000);
            expect(r.actual_cash).toBe(4000);
            expect(r.difference).toBe(0);
        });

        it('exposes the cash-out total on an open shift too', () => {
            const r = respond(shift(), 4000, 2000);
            expect(r.expected_cash).toBe(4000);
            expect(r.cash_out_total).toBe(2000);
        });

        it('defaults the cash-out total to zero when none is supplied', () => {
            expect(respond(shift(), 6000).cash_out_total).toBe(0);
        });
    });

    describe('actual cash and variance', () => {
        it('is the drawer count alone — rider money is not part of it', () => {
            const r = respond(
                shift({
                    status: 'closed',
                    expectedCash: 6000,
                    closingCash: 6000,
                }),
            );
            expect(r.drawer_cash).toBe(6000);
            expect(r.actual_cash).toBe(6000);
            expect(r.difference).toBe(0);
        });

        it('reports a shortfall when the drawer is light', () => {
            const r = respond(
                shift({
                    status: 'closed',
                    expectedCash: 6000,
                    closingCash: 5800,
                }),
            );
            expect(r.actual_cash).toBe(5800);
            expect(r.difference).toBe(-200);
        });

        it('rounds the variance — a matching count reads exactly zero', () => {
            const r = respond(
                shift({
                    status: 'closed',
                    expectedCash: 50622.24,
                    closingCash: 50622.24,
                }),
                undefined,
                45000,
            );
            expect(r.difference).toBe(0);
        });

        it('reports an overage when the drawer is heavy', () => {
            const r = respond(
                shift({
                    status: 'closed',
                    expectedCash: 6000,
                    closingCash: 6250,
                }),
            );
            expect(r.difference).toBe(250);
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
                shift({
                    status: 'closed',
                    expectedCash: 4801,
                    closingCash: 4500,
                }),
            );
            expect(r.expected_cash).toBe(4801);
            expect(r.difference).toBe(-301);
        });

        it('a closed shift stays frozen even as cash-outs are reported alongside', () => {
            // The frozen figure was already net of the 2000 at close; passing the
            // total again must not subtract it twice.
            const r = respond(
                shift({
                    status: 'closed',
                    expectedCash: 4000,
                    closingCash: 4000,
                }),
                undefined,
                2000,
            );
            expect(r.expected_cash).toBe(4000);
            expect(r.difference).toBe(0);
        });
    });
});
