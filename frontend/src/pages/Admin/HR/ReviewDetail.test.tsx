import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const openReview = vi.fn();
const listDesignations = vi.fn();
const trainingReadiness = vi.fn();
const submitReview = vi.fn();
const saveReviewDraft = vi.fn();
const approveReview = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    openReview: (...a: unknown[]) => openReview(...a),
    listDesignations: (...a: unknown[]) => listDesignations(...a),
    trainingReadiness: (...a: unknown[]) => trainingReadiness(...a),
    submitReview: (...a: unknown[]) => submitReview(...a),
    saveReviewDraft: (...a: unknown[]) => saveReviewDraft(...a),
    approveReview: (...a: unknown[]) => approveReview(...a),
    skipReviewCycle: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: '3' }) };
});

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import ReviewDetail from './ReviewDetail';

const detail = (over: Record<string, unknown> = {}) => ({
  cycle: {
    id: 3,
    cycle_type: 'quarterly',
    is_scheduled: true,
    ad_hoc_reason: null,
    period_from: '2026-05-01',
    period_to: '2026-08-01',
    due_date: '2026-08-01',
    status: 'in_progress',
  },
  review: {
    id: 9,
    answers: {},
    total_score: 0,
    max_score: 0,
    normalized_percent: null,
    strengths: null,
    improvements: null,
    reviewer_comments: null,
    outcome: null,
    promoted_to_designation_id: null,
    new_basic_amount: null,
    effective_from: null,
    training_gaps: [],
    status: 'draft',
  },
  template: {
    sections: [
      {
        title: 'Performance',
        questions: [
          { key: 'punctuality', label: 'Punctuality', type: 'rating', max: 5, weight: 1 },
          { key: 'quality', label: 'Quality of work', type: 'rating', max: 5, weight: 1 },
        ],
      },
    ],
  },
  employee: {
    id: 7,
    full_name: 'Bilal Ahmed',
    employee_code: 'EMP-0007',
    date_of_joining: '2025-11-01',
    timeline: [],
    current_assignment: {
      id: 1,
      branch: { id: 10, name: 'Emporium' },
      brand: { id: 25, name: 'Fireaway' },
      designation: { id: 4, name: 'Cashier', level: 2, department: 'front_of_house' },
      employment_type: 'full_time',
      effective_from: '2025-11-01',
      effective_to: null,
      is_current: true,
      change_reason: 'hire',
      note: null,
      created_by: null,
    },
    assignments: [],
    documents: [],
    warnings: [],
  },
  trainings: [],
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReviewDetail />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['reviews:view', 'reviews:conduct', 'reviews:approve'];
  listDesignations.mockResolvedValue([
    { id: 3, name: 'Helper', level: 1, slug: 'helper', department: 'kitchen', default_role_id: null, default_role_name: null, is_active: true, employee_count: 0 },
    { id: 4, name: 'Cashier', level: 2, slug: 'cashier', department: 'front_of_house', default_role_id: null, default_role_name: null, is_active: true, employee_count: 0 },
    { id: 5, name: 'Shift Supervisor', level: 3, slug: 'shift-supervisor', department: 'management', default_role_id: null, default_role_name: null, is_active: true, employee_count: 0 },
  ]);
  trainingReadiness.mockResolvedValue({ ready: true, missing: [] });
});

describe('Review form', () => {
  it('scores only the answered ratings', async () => {
    openReview.mockResolvedValue(detail());
    renderPage();

    await waitFor(() => expect(screen.getByText('Punctuality')).toBeInTheDocument());
    // Nothing answered: no percentage, not 0%.
    expect(screen.getByText('0 / 0 · 0 of 2 rated')).toBeInTheDocument();

    // Answer one of two ratings with a 4 — 4/5, not 4/10.
    const punctualityRow = screen.getByText('Punctuality').parentElement!;
    fireEvent.click(punctualityRow.querySelectorAll('button')[3]);

    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('4 / 5 · 1 of 2 rated')).toBeInTheDocument();
  });

  it('offers only designations above the current level as promotion targets', async () => {
    openReview.mockResolvedValue(detail());
    renderPage();

    await waitFor(() => expect(screen.getByText('Decision *')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Select an outcome'));
    fireEvent.mouseDown(screen.getByText('Promoted'));

    await waitFor(() => expect(screen.getByText('Promote to *')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Select a designation'));

    // Cashier is level 2 — Helper (1) and Cashier itself must not be offered.
    expect(screen.getByText('Shift Supervisor (level 3)')).toBeInTheDocument();
    expect(screen.queryByText('Helper (level 1)')).not.toBeInTheDocument();
    expect(screen.queryByText('Cashier (level 2)')).not.toBeInTheDocument();
  });

  it('warns about missing training without blocking the submit', async () => {
    openReview.mockResolvedValue(detail());
    trainingReadiness.mockResolvedValue({
      ready: false,
      missing: [{ programId: 2, programName: 'Food handling', reason: 'not started' }],
    });
    submitReview.mockResolvedValue({ id: 9, status: 'submitted', training_gaps: [{}] });
    saveReviewDraft.mockResolvedValue({ totalScore: 0, maxScore: 0, normalizedPercent: null });
    renderPage();

    await waitFor(() => expect(screen.getByText('Decision *')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Select an outcome'));
    fireEvent.mouseDown(screen.getByText('Promoted'));
    fireEvent.click(screen.getByText('Select a designation'));
    fireEvent.mouseDown(screen.getByText('Shift Supervisor (level 3)'));

    await waitFor(() => expect(screen.getByText('Food handling')).toBeInTheDocument());
    expect(screen.getByText(/warning, not a block/)).toBeInTheDocument();

    const submit = screen.getByText('Submit for approval');
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(submitReview).toHaveBeenCalled());
  });

  it('shows approve only once submitted, and only to an approver', async () => {
    openReview.mockResolvedValue(
      detail({
        cycle: { ...detail().cycle, status: 'submitted' },
        review: { ...detail().review, status: 'submitted', outcome: 'no_promotion' },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Approve & apply')).toBeInTheDocument());
    expect(screen.queryByText('Submit for approval')).not.toBeInTheDocument();
  });

  it('tells a non-approver the review is waiting on someone else', async () => {
    permissions = ['reviews:view', 'reviews:conduct'];
    openReview.mockResolvedValue(
      detail({
        cycle: { ...detail().cycle, status: 'submitted' },
        review: { ...detail().review, status: 'submitted', outcome: 'no_promotion' },
      }),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/waiting on someone with approval rights/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Approve & apply')).not.toBeInTheDocument();
  });

  it('marks an ad-hoc review as not affecting the cadence', async () => {
    openReview.mockResolvedValue(
      detail({
        cycle: {
          ...detail().cycle,
          cycle_type: 'ad_hoc',
          is_scheduled: false,
          ad_hoc_reason: 'performance_concern',
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Ad-hoc review')).toBeInTheDocument());
    expect(
      screen.getByText('Does not affect the scheduled cadence'),
    ).toBeInTheDocument();
    // Skipping is a scheduled-cycle concept only.
    expect(screen.queryByText('Skip this cycle')).not.toBeInTheDocument();
  });
});
