import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const labourCostReport = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: { labourCostReport: (...a: unknown[]) => labourCostReport(...a) },
}));
vi.mock('../../../utils/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [{ id: 10, name: 'Emporium' }] }) },
}));

import LabourCost from './LabourCost';

const row = (over: Record<string, unknown> = {}) => ({
  branch_id: 10,
  branch_name: 'Emporium',
  brand_id: 25,
  brand_name: 'Fireaway',
  labour_cost: 120000,
  net_sales: 400000,
  revenue: 460000,
  labour_percent: 30,
  headcount: 8,
  ...over,
});

const report = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  period: { from: '2026-08-01', to: '2026-08-31' },
  rows,
  totals: {
    labour_cost: 120000,
    net_sales: 400000,
    revenue: 460000,
    labour_percent: 30,
    headcount: 8,
  },
  excluded_partial_runs: [],
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LabourCost />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Labour cost vs sales', () => {
  it('shows a dash, not 0%, when there were no sales', async () => {
    labourCostReport.mockResolvedValue(
      report([row({ net_sales: 0, revenue: 0, labour_percent: null })], {
        totals: {
          labour_cost: 120000,
          net_sales: 0,
          revenue: 0,
          labour_percent: null,
          headcount: 8,
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Emporium')).toBeInTheDocument());
    // Both the tile and the row read as "no figure" rather than as zero cost.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('labels a brandless row as shared rather than blank', async () => {
    labourCostReport.mockResolvedValue(
      report([
        row(),
        row({ brand_id: null, brand_name: null, labour_cost: 30000, labour_percent: null }),
      ]),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Shared (no brand)')).toBeInTheDocument(),
    );
  });

  it('names the payroll runs it excluded instead of pro-rating them', async () => {
    labourCostReport.mockResolvedValue(
      report([row()], {
        excluded_partial_runs: [
          {
            id: 4,
            period_from: '2026-07-16',
            period_to: '2026-08-15',
            branch_name: 'Emporium',
          },
        ],
      }),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/straddle this date range/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/2026-07-16 → 2026-08-15/)).toBeInTheDocument();
  });

  it('renders the percentage when there are sales', async () => {
    labourCostReport.mockResolvedValue(report([row()]));
    renderPage();

    await waitFor(() => expect(screen.getAllByText('30%').length).toBe(2));
  });
});

describe('LabourCost — the loading overlay', () => {
  /**
   * Regression: the overlay was driven by `isPlaceholderData`, which React Query
   * only reports when the incoming key has NOTHING cached. Changing the range
   * back to one already viewed served the stale rows instantly with no overlay,
   * then quietly rewrote them when the refetch landed. The signal is now
   * useResultsRefreshing — armed by the key change, not by cache luck.
   */
  const veil = () => screen.queryByRole('status', { name: /Updating labour cost/i });
  const fromInput = () => document.querySelector('input[type="date"]') as HTMLInputElement;

  const settle = (name: string) => report([row({ branch_name: name })]);

  it('veils the results whenever the range changes — cached or not', async () => {
    const pending: Array<(v: unknown) => void> = [];
    labourCostReport.mockImplementation(
      () => new Promise((res) => pending.push(res as (v: unknown) => void)),
    );

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LabourCost />
      </QueryClientProvider>,
    );
    await act(async () => { pending.shift()?.(settle('Emporium')); });
    await waitFor(() => expect(screen.getByText('Emporium')).toBeInTheDocument());
    expect(veil()).toBeNull();

    // 1. A range never requested before.
    await act(async () => { fireEvent.change(fromInput(), { target: { value: '2026-07-01' } }); });
    expect(veil()).not.toBeNull();
    await act(async () => { pending.shift()?.(settle('Pine Avenue')); });
    await waitFor(() => expect(veil()).toBeNull());

    // 2. Back to the FIRST range — already in cache. This is the case the old
    //    isPlaceholderData signal missed entirely: rows swapped with no veil.
    await act(async () => { fireEvent.change(fromInput(), { target: { value: '2026-08-01' } }); });
    expect(veil()).not.toBeNull();

    await act(async () => { pending.shift()?.(settle('Emporium')); });
    await waitFor(() => expect(veil()).toBeNull());
  });
});
