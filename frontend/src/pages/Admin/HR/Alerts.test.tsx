import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listHrAlerts = vi.fn();
const navigate = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: { listHrAlerts: (...a: unknown[]) => listHrAlerts(...a) },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => navigate };
});

import Alerts from './Alerts';

const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const alert = (over: Record<string, unknown> = {}) => ({
  kind: 'document_expiring',
  dedupeKey: `k${Math.random()}`,
  branchId: 10,
  employeeId: 7,
  employeeName: 'Bilal Ahmed',
  employeeCode: 'EMP-0007',
  date: iso(10),
  label: 'cnic — Bilal Ahmed',
  detail: 'Expires soon',
  link: '/admin/hr/employees/7',
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  documents: [],
  trainings: [],
  probations: [],
  reviews: [],
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Alerts />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HR alerts', () => {
  it('says so plainly when nothing needs attention', async () => {
    listHrAlerts.mockResolvedValue(payload());
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Nothing is lapsing/)).toBeInTheDocument(),
    );
  });

  it('separates an overdue item from one still in the future', async () => {
    listHrAlerts.mockResolvedValue(
      payload({
        documents: [
          alert({ dedupeKey: 'past', date: iso(-3) }),
          alert({ dedupeKey: 'future', date: iso(12) }),
        ],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('3d overdue')).toBeInTheDocument());
    expect(screen.getByText('in 12d')).toBeInTheDocument();
  });

  it('sorts the soonest first, expired ones at the top', async () => {
    listHrAlerts.mockResolvedValue(
      payload({
        documents: [
          alert({ dedupeKey: 'later', date: iso(20), label: 'later doc' }),
          alert({ dedupeKey: 'sooner', date: iso(-1), label: 'sooner doc' }),
        ],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('sooner doc')).toBeInTheDocument());
    const labels = screen
      .getAllByText(/doc$/)
      .map((el) => el.textContent);
    expect(labels).toEqual(['sooner doc', 'later doc']);
  });

  it('opens the alert’s own destination', async () => {
    listHrAlerts.mockResolvedValue(
      payload({
        reviews: [
          alert({
            kind: 'review_overdue',
            dedupeKey: 'r1',
            label: 'Bilal Ahmed',
            link: '/admin/hr/reviews/42',
            date: iso(-5),
          }),
        ],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Bilal Ahmed'));
    expect(navigate).toHaveBeenCalledWith('/admin/hr/reviews/42');
  });

  it('counts every group in the header', async () => {
    listHrAlerts.mockResolvedValue(
      payload({
        documents: [alert({ dedupeKey: 'a' })],
        trainings: [alert({ dedupeKey: 'b' })],
        probations: [alert({ dedupeKey: 'c' })],
      }),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('3 needing attention')).toBeInTheDocument(),
    );
  });
});
