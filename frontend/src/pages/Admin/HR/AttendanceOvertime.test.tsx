import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRegister = vi.fn();
const decideOvertime = vi.fn();
const decideOvertimeBulk = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    getRegister: (...a: unknown[]) => getRegister(...a),
    getExceptionsReport: vi.fn().mockResolvedValue({ flagged_days: [], bursts: [] }),
    decideOvertime: (...a: unknown[]) => decideOvertime(...a),
    decideOvertimeBulk: (...a: unknown[]) => decideOvertimeBulk(...a),
  },
}));
vi.mock('../../../utils/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [{ id: 10, name: 'Pine Avenue' }] }) },
}));
vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import AttendanceRegister from './AttendanceRegister';

const row = (over: Record<string, unknown> = {}) => ({
  id: 269,
  work_date: '2026-08-17',
  employee: { id: 4, full_name: 'Fireaway Cashier 1', employee_code: 'EMP-0004' },
  branch_name: 'Pine Avenue',
  status: 'present',
  first_in_at: '2026-08-17T06:00:00.000Z',
  last_out_at: '2026-08-17T18:00:00.000Z',
  worked_minutes: 1163,
  late_minutes: 0,
  early_leave_minutes: 0,
  overtime_pending: 240,
  overtime_approved: 0,
  overtime_decided: false,
  flags: {},
  is_locked: false,
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AttendanceRegister />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['attendance:view', 'overtime:approve'];
  getRegister.mockResolvedValue([row()]);
  decideOvertime.mockResolvedValue({ id: 269, approved_minutes: 240, status: 'approved' });
  decideOvertimeBulk.mockResolvedValue({ decided: 1, skipped: [] });
});

describe('Overtime approval on the register', () => {
  it('offers the decision on the day itself', async () => {
    // Overtime accrued as pending with nowhere to approve it, so payroll
    // blocked forever and the only way out was to force past it.
    renderPage();
    await waitFor(() => expect(screen.getByText('240m waiting')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() =>
      expect(decideOvertime).toHaveBeenCalledWith(269, { approve: true }),
    );
  });

  it('rejects from the same row', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('240m waiting')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() =>
      expect(decideOvertime).toHaveBeenCalledWith(269, { approve: false }),
    );
  });

  it('says how much is waiting and clears it in one go', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/1 day\(s\) totalling 240 minutes/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Approve all'));
    await waitFor(() =>
      expect(decideOvertimeBulk).toHaveBeenCalledWith(
        expect.objectContaining({ approve: true }),
      ),
    );
  });

  it('shows an answered day as settled, with no buttons', async () => {
    getRegister.mockResolvedValue([
      row({ overtime_approved: 240, overtime_decided: true }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('240m approved')).toBeInTheDocument());
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText(/day\(s\) totalling/)).not.toBeInTheDocument();
  });

  it('shows a rejected day as rejected rather than waiting', async () => {
    getRegister.mockResolvedValue([
      row({ overtime_approved: 0, overtime_decided: true }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('240m rejected')).toBeInTheDocument());
    expect(screen.queryByText('Approve all')).not.toBeInTheDocument();
  });

  it('offers nothing to somebody without overtime:approve', async () => {
    permissions = ['attendance:view'];
    renderPage();
    await waitFor(() => expect(screen.getByText('240m waiting')).toBeInTheDocument());
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Approve all')).not.toBeInTheDocument();
  });

  it('will not offer a decision on a locked day', async () => {
    getRegister.mockResolvedValue([row({ is_locked: true })]);
    renderPage();
    await waitFor(() => expect(screen.getByText('240m waiting')).toBeInTheDocument());
    // Payroll is approved for that period; reversing the run is the only way.
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });
});
