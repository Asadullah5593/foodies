import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const list = vi.fn();
const filterOptions = vi.fn();
const detail = vi.fn();
const related = vi.fn();
vi.mock('../../services/api/activityLogService', () => ({
  activityLogService: {
    list: (...a: unknown[]) => list(...a),
    filterOptions: () => filterOptions(),
    detail: (...a: unknown[]) => detail(...a),
    related: (...a: unknown[]) => related(...a),
    forEntity: vi.fn(),
  },
}));

import ActivityLog from './ActivityLog';

const row = (over: Record<string, unknown> = {}) => ({
  id: '101',
  created_at: '2026-08-05T09:15:00.000Z',
  request_id: 'req-1',
  actor_type: 'staff',
  actor_user_id: 13,
  actor_label: 'foodies',
  actor_role_slugs: ['owner'],
  actor_role_names: ['Owner'],
  actor_is_super_admin: false,
  tenant_id: 6,
  branch_id: null,
  brand_id: null,
  action: 'role.update',
  action_group: 'access',
  entity_type: 'role',
  entity_id: '4',
  entity_label: 'Cashier',
  summary: null,
  http_method: 'PUT',
  route: '/admin/roles/4',
  status_code: 200,
  outcome: 'success',
  duration_ms: 42,
  changed_fields: ['permissions'],
  ip: '203.0.113.9',
  payload_truncated: false,
  diff_expected: true,
  ...over,
});

const page = (rows: unknown[] = [row()]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  page_size: 25,
  outcome_counts: { success: 1, denied: 2, failed: 0, error: 0 },
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/activity-logs']}>
        <ActivityLog />
      </MemoryRouter>
    </QueryClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue(page());
  filterOptions.mockResolvedValue({
    actions: ['role.update'],
    action_groups: ['access', 'auth'],
    actors: [{ actor_user_id: 13, actor_label: 'foodies' }],
    outcomes: ['success', 'denied', 'failed', 'error'],
    actor_types: ['staff', 'customer'],
    max_window_days: 92,
  });
  detail.mockResolvedValue({
    ...row(),
    query: null,
    request_body: { permission_ids: [1, 2] },
    response_meta: { id: 4 },
    changes: { permissions: { before: 'read', after: 'read,write' } },
    user_agent: 'Chrome',
    session_id: null,
    device_id: null,
    actor_customer_id: null,
  });
  related.mockResolvedValue([]);
});

describe('ActivityLog', () => {
  it('lists activity with who, what and outcome', async () => {
    renderPage();
    expect(await screen.findByText('role.update')).toBeInTheDocument();
    expect(screen.getByText('foodies')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
    expect(screen.getAllByText('success').length).toBeGreaterThan(0);
    expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
  });

  it('defaults to a 7-day window rather than an unbounded query', async () => {
    renderPage();
    await screen.findByText('role.update');
    const sent = list.mock.calls[0][0] as { date_from: string; date_to: string };
    expect(sent.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const span =
      (new Date(sent.date_to).getTime() - new Date(sent.date_from).getTime()) / 86_400_000;
    expect(span).toBeCloseTo(7, 0);
  });

  it('shows the role held AT THE TIME, labelled as such', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('role.update'));
    expect(
      await screen.findByText(/Role at the time of the action/)
    ).toBeInTheDocument();
    const drawer = screen.getByText(/Role at the time of the action/).closest('div')!;
    expect(within(drawer).getByText(/Owner/)).toBeInTheDocument();
  });

  it('shows the before/after diff as the centrepiece of the drawer', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('role.update'));
    expect(await screen.findByText('What changed')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('read,write')).toBeInTheDocument();
  });

  it('renders a redacted value as a visible marker, not an absence', async () => {
    detail.mockResolvedValue({
      ...row(),
      query: null,
      request_body: { password: '[redacted]' },
      response_meta: null,
      changes: { password: { before: '[changed]', after: '[changed]' } },
      user_agent: null,
      session_id: null,
      device_id: null,
      actor_customer_id: null,
    });
    renderPage();
    fireEvent.click(await screen.findByText('role.update'));
    await screen.findByText('What changed');
    expect(screen.getAllByText('[changed]').length).toBe(2);
  });

  it('offers no way to edit or delete an entry', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('role.update'));
    await screen.findByText('What changed');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(buttons.join(' ')).not.toMatch(/delete|remove|edit/i);
  });

  it('flags a row that should have carried a diff but did not', async () => {
    list.mockResolvedValue(page([row({ changed_fields: [], diff_expected: true })]));
    renderPage();
    expect(await screen.findByText('no diff')).toBeInTheDocument();
  });

  it('filters by outcome from the tally chips, and puts it in the URL', async () => {
    renderPage();
    await screen.findByText('role.update');
    fireEvent.click(screen.getByRole('button', { name: /denied: 2/ }));
    await waitFor(() => {
      const latest = list.mock.calls.at(-1)![0] as { outcome?: string };
      expect(latest.outcome).toBe('denied');
    });
  });

  it('explains an over-wide range instead of showing a generic failure', async () => {
    list.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Date range is limited to 92 days.' },
      },
    });
    renderPage();
    expect(
      await screen.findByText(/Date range is limited to 92 days/)
    ).toBeInTheDocument();
  });

  it('debounces the search box', async () => {
    renderPage();
    await screen.findByText('role.update');
    const before = list.mock.calls.length;
    const box = screen.getByPlaceholderText('Person, action, route or record…');
    fireEvent.change(box, { target: { value: 'r' } });
    fireEvent.change(box, { target: { value: 'ro' } });
    fireEvent.change(box, { target: { value: 'role' } });
    // No request per keystroke
    expect(list.mock.calls.length).toBe(before);
    await waitFor(
      () => {
        const latest = list.mock.calls.at(-1)![0] as { search?: string };
        expect(latest.search).toBe('role');
      },
      { timeout: 2000 }
    );
  });

  it('shows an empty state when nothing matches', async () => {
    list.mockResolvedValue(page([]));
    renderPage();
    expect(
      await screen.findByText('No activity matches these filters.')
    ).toBeInTheDocument();
  });
});
