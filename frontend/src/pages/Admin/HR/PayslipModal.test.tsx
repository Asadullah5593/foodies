import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPayslip = vi.fn();
const addPayrollAdjustment = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    getPayslip: (...a: unknown[]) => getPayslip(...a),
    addPayrollAdjustment: (...a: unknown[]) => addPayrollAdjustment(...a),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import PayslipModal from './PayslipModal';

const slip = (items: unknown[] = []) => ({
  id: 5,
  run: {
    id: 2,
    period_from: '2026-08-01',
    period_to: '2026-08-31',
    status: 'computed',
  },
  employee: { id: 7, full_name: 'Bilal Ahmed', employee_code: 'EMP-0007' },
  attendance: {
    present_days: 26,
    half_days: 0,
    paid_leave_days: 0,
    unpaid_leave_days: 0,
    absent_days: 1,
    weekly_off_days: 4,
    holiday_days: 0,
    late_count: 2,
    overtime_minutes: 0,
  },
  items,
  gross_earnings: 34000,
  total_deductions: 1500,
  net_payable: 32500,
  currency: 'PKR',
});

const renderSlip = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PayslipModal lineId={5} onClose={() => undefined} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = [];
});

describe('PayslipModal explainability', () => {
  /**
   * The entire point of the payslip screen: every figure shows the arithmetic
   * that produced it. A payslip that just says "Late arrivals −500" is the
   * thing this module exists to replace.
   */
  it('explains the late deduction with the ladder', async () => {
    getPayslip.mockResolvedValue(
      slip([
        {
          component_key: 'late',
          component_name: 'Late arrivals',
          kind: 'deduction',
          quantity: 0.5,
          rate: 1000,
          amount: 500,
          calc_meta: { late_count: 2, days_deducted: 0.5 },
        },
      ]),
    );
    renderSlip();
    await waitFor(() => expect(screen.getByText('Late arrivals')).toBeInTheDocument());
    expect(screen.getByText(/2 late\(s\) → 0.5 day\(s\)/)).toBeInTheDocument();
  });

  it('shows a waiver with its reason and approver, beside the deduction', async () => {
    getPayslip.mockResolvedValue(
      slip([
        {
          component_key: 'late',
          component_name: 'Late arrivals',
          kind: 'deduction',
          quantity: 1,
          rate: 1000,
          amount: 1000,
          calc_meta: { late_count: 3, days_deducted: 1 },
        },
        {
          component_key: 'late_waiver',
          component_name: 'Late arrivals waived',
          kind: 'waiver',
          quantity: 1,
          rate: 1000,
          amount: 1000,
          calc_meta: { reason: 'bike breakdown', approved_by: 'Ali Raza' },
        },
      ]),
    );
    renderSlip();
    // Both lines present — the waiver offsets, it does not replace.
    await waitFor(() => expect(screen.getByText('Late arrivals')).toBeInTheDocument());
    expect(screen.getByText('Late arrivals waived')).toBeInTheDocument();
    expect(screen.getByText(/bike breakdown — Ali Raza/)).toBeInTheDocument();
  });

  it('explains prorated basic for a partial month', async () => {
    getPayslip.mockResolvedValue(
      slip([
        {
          component_key: 'basic',
          component_name: 'Basic salary',
          kind: 'earning',
          quantity: 15,
          rate: 1000,
          amount: 15000,
          calc_meta: { prorated: true, employed_days: 15, days_in_month: 31 },
        },
      ]),
    );
    renderSlip();
    await waitFor(() => expect(screen.getByText('Basic salary')).toBeInTheDocument());
    expect(screen.getByText(/15 of 31 days employed/)).toBeInTheDocument();
  });

  it('shows an advance recovered in full on a final settlement', async () => {
    getPayslip.mockResolvedValue(
      slip([
        {
          component_key: 'advance_4',
          component_name: 'Advance recovered in full (final settlement)',
          kind: 'deduction',
          quantity: 1,
          rate: 7500,
          amount: 7500,
          calc_meta: {
            outstanding_before: 7500,
            outstanding_after: 0,
            recovered_in_full: true,
          },
        },
      ]),
    );
    renderSlip();
    await waitFor(() =>
      expect(
        screen.getByText('Advance recovered in full (final settlement)'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/outstanding 7500 → 0 \(recovered in full\)/)).toBeInTheDocument();
  });
});

describe('PayslipModal adjustment gating', () => {
  beforeEach(() => {
    getPayslip.mockResolvedValue(slip([]));
  });

  it('hides the adjust action without payroll:adjust', async () => {
    renderSlip();
    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.queryByText('Waive or add a deduction')).not.toBeInTheDocument();
  });

  it('shows it with the permission', async () => {
    permissions = ['payroll:adjust'];
    renderSlip();
    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.getByText('Waive or add a deduction')).toBeInTheDocument();
  });

  it('hides it on a reversed run — there is nothing to adjust', async () => {
    permissions = ['payroll:adjust'];
    getPayslip.mockResolvedValue({
      ...slip([]),
      run: {
        id: 2,
        period_from: '2026-08-01',
        period_to: '2026-08-31',
        status: 'reversed',
      },
    });
    renderSlip();
    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.queryByText('Waive or add a deduction')).not.toBeInTheDocument();
  });
});
