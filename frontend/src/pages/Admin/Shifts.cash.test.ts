import { describe, it, expect, vi } from 'vitest';
import { Shift } from '../../types';

// Shifts.tsx pulls in the whole admin page (charts, print, react-query). Only
// the money helpers are under test here, so stub the heavy leaf imports.
vi.mock('../../utils/print', () => ({ printContent: vi.fn() }));

const {
  cashOutTotal,
  expectedInDrawer,
  drawerVariance,
  expectedTotal,
} = await import('./Shifts');

const shift = (over: Partial<Shift> = {}): Shift =>
  ({
    id: 1,
    branch_id: 10,
    user_id: 2,
    shift_number: 'SH-1',
    opening_cash: 5000,
    cash_collected: 90622.24,
    card_collected: 1000,
    status: 'open',
    opened_at: '2026-07-28T06:00:00Z',
    ...over,
  }) as Shift;

/**
 * The page used to re-derive these client-side and drifted from the backend.
 * These pin that the server's figures win, and that a cash-out lowers what the
 * drawer should hold.
 */
describe('Shifts page — drawer maths', () => {
  describe('cashOutTotal', () => {
    it('is zero on a payload that predates cash-outs', () => {
      expect(cashOutTotal(shift())).toBe(0);
    });

    it('reads the server figure', () => {
      expect(cashOutTotal(shift({ cash_out_total: 45000 }))).toBe(45000);
    });
  });

  describe('expectedInDrawer', () => {
    it('prefers the server figure over any local sum', () => {
      // Server says 50622.24 (already net of cash-outs); locals would say more.
      const s = shift({ expected_cash: 50622.24, cash_out_total: 45000 });
      expect(expectedInDrawer(s)).toBe(50622.24);
    });

    it('falls back to opening + cash − cash-outs when the server figure is absent', () => {
      const s = shift({ cash_out_total: 45000 });
      expect(expectedInDrawer(s)).toBeCloseTo(50622.24, 2);
    });

    it('fallback still works with no cash-outs', () => {
      expect(expectedInDrawer(shift())).toBeCloseTo(95622.24, 2);
    });

    it('never adds card takings — they never reach the drawer', () => {
      const s = shift({ card_collected: 99999 });
      expect(expectedInDrawer(s)).toBeCloseTo(95622.24, 2);
    });
  });

  describe('drawerVariance', () => {
    it('is null while the shift is open', () => {
      expect(drawerVariance(shift({ expected_cash: 100 }))).toBeNull();
    });

    it('is null on a closed shift that was never counted', () => {
      const s = shift({ status: 'closed', expected_cash: 100 });
      expect(drawerVariance(s)).toBeNull();
    });

    it('prefers the server difference', () => {
      const s = shift({
        status: 'closed',
        expected_cash: 50622.24,
        actual_cash: 50622.24,
        difference: 0,
        cash_out_total: 45000,
      });
      expect(drawerVariance(s)).toBe(0);
    });

    it('falls back to counted − expected, cash-outs included', () => {
      // 5000 + 90622.24 − 45000 = 50622.24 expected; 50000 counted ⇒ short 622.24
      const s = shift({
        status: 'closed',
        actual_cash: 50000,
        cash_out_total: 45000,
      });
      expect(drawerVariance(s)!).toBeCloseTo(-622.24, 2);
    });

    it('does NOT report a phantom shortage after a cash-out', () => {
      // The old formula (counted − (opening + cash)) would have said −45000.
      const s = shift({
        status: 'closed',
        expected_cash: 50622.24,
        actual_cash: 50622.24,
        cash_out_total: 45000,
      });
      expect(drawerVariance(s)).toBe(0);
    });
  });

  describe('expectedTotal (takings incl. card)', () => {
    it('is the drawer expectation plus card sales', () => {
      const s = shift({ expected_cash: 50622.24, card_collected: 1000 });
      expect(expectedTotal(s)).toBeCloseTo(51622.24, 2);
    });

    it('drops by a cash-out, like the drawer figure', () => {
      const withOut = shift({ expected_cash: 50622.24, cash_out_total: 45000 });
      const without = shift({ expected_cash: 95622.24 });
      expect(expectedTotal(without) - expectedTotal(withOut)).toBeCloseTo(45000, 2);
    });
  });
});
