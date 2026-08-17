import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listReviewCycles = vi.fn();
const syncReviewCycles = vi.fn();
const navigate = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    listReviewCycles: (...a: unknown[]) => listReviewCycles(...a),
    syncReviewCycles: (...a: unknown[]) => syncReviewCycles(...a),
    listEmployees: vi.fn().mockResolvedValue({ data: [] }),
    createAdHocReview: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => navigate };
});

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import Reviews from './Reviews';

const cycle = (over: Record<string, unknown> = {}) => ({
  id: 1,
  cycle_type: 'quarterly',
  is_scheduled: true,
  ad_hoc_reason: null,
  sequence_no: 2,
  period_from: '2026-05-01',
  period_to: '2026-08-01',
  due_date: '2026-08-01',
  overdue: false,
  status: 'scheduled',
  template_id: 1,
  employee: { id: 7, full_name: 'Bilal Ahmed', employee_code: 'EMP-0007' },
  reviewer: null,
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Reviews />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['reviews:view', 'reviews:conduct', 'reviews:approve'];
});

describe('Reviews queue', () => {
  it('labels scheduled and ad-hoc cycles distinctly', async () => {
    listReviewCycles.mockResolvedValue([
      cycle(),
      cycle({
        id: 2,
        cycle_type: 'ad_hoc',
        is_scheduled: false,
        sequence_no: null,
        ad_hoc_reason: 'performance_concern',
      }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Scheduled')).toBeInTheDocument());
    expect(screen.getByText('Ad-hoc')).toBeInTheDocument();
    expect(screen.getByText('Performance concern')).toBeInTheDocument();
  });

  it('counts only scheduled cycles in the overdue banner', async () => {
    listReviewCycles.mockResolvedValue([
      cycle({ id: 1, overdue: true, is_scheduled: true }),
      cycle({ id: 2, overdue: true, is_scheduled: false, cycle_type: 'ad_hoc' }),
    ]);
    renderPage();

    // One scheduled review is overdue; the ad-hoc one is reported separately so
    // raising extra reviews cannot inflate or deflate the cadence figure.
    await waitFor(() =>
      expect(screen.getByText(/1 scheduled review is past due/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/plus 1 ad-hoc/)).toBeInTheDocument();
  });

  it('opens the form for the clicked cycle', async () => {
    listReviewCycles.mockResolvedValue([cycle({ id: 42 })]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Open form')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Open form'));
    expect(navigate).toHaveBeenCalledWith('/admin/hr/reviews/42');
  });

  it('hides the generate button without approval rights', async () => {
    permissions = ['reviews:view'];
    listReviewCycles.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText(/No reviews in this list/)).toBeInTheDocument());
    expect(screen.queryByText('Generate due reviews')).not.toBeInTheDocument();
    expect(screen.queryByText('Start a review')).not.toBeInTheDocument();
  });

  it('filters the awaiting-approval tab to submitted cycles', async () => {
    listReviewCycles.mockResolvedValue([
      cycle({ id: 1, status: 'scheduled' }),
      cycle({
        id: 2,
        status: 'submitted',
        employee: { id: 8, full_name: 'Sara Khan', employee_code: 'EMP-0008' },
      }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Awaiting approval (1)'));

    expect(screen.getByText('Sara Khan')).toBeInTheDocument();
    expect(screen.queryByText('Bilal Ahmed')).not.toBeInTheDocument();
    expect(screen.getByText('Review & approve')).toBeInTheDocument();
  });
});
