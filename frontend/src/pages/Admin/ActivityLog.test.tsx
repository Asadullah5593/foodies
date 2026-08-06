import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = vi.fn(() => ({
  permissions: ['activity-log:view', 'activity-log:configure'],
}) as unknown);
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser() }),
}));

const settings = vi.fn();
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
    settings: () => settings(),
    updateSettings: vi.fn(),
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
  settings.mockResolvedValue({
    capture_level: 'mutations+sensitive_reads',
    pii_mode: 'mask',
    hot_months: 3,
    retention_months: 13,
    updated_at: null,
    env_disabled: false,
  });
});

describe('ActivityLog capture state', () => {
  it('warns loudly when capture is switched off', async () => {
    settings.mockResolvedValue({
      capture_level: 'off',
      pii_mode: 'mask',
      hot_months: 3,
      retention_months: 13,
      updated_at: '2026-08-06T09:00:00.000Z',
      env_disabled: false,
    });
    renderPage();
    // The person who turned it off is the last one who would mention it.
    expect(
      await screen.findByText(/Logging is OFF/)
    ).toBeInTheDocument();
  });

  it('says nothing when capture is on', async () => {
    renderPage();
    await screen.findByText('role.update');
    expect(screen.queryByText(/Logging is OFF/)).not.toBeInTheDocument();
  });

  it('hides the settings panel from someone who cannot configure', async () => {
    mockUser.mockReturnValue({ permissions: ['activity-log:view'] });
    renderPage();
    await screen.findByText('role.update');
    expect(
      screen.queryByRole('button', { name: /Capture settings/ })
    ).not.toBeInTheDocument();
    mockUser.mockReturnValue({
      permissions: ['activity-log:view', 'activity-log:configure'],
    });
  });

  it('keeps settings behind a button rather than on the page', async () => {
    renderPage();
    const trigger = await screen.findByRole('button', { name: /Capture settings/ });
    // Set-once controls must not compete with the log people came to read.
    expect(screen.queryByLabelText('Capture level')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Capture level')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });
});

describe('ActivityLog record lens', () => {
  const renderFor = (search: string) =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[`/admin/activity-logs${search}`]}>
          <ActivityLog />
        </MemoryRouter>
      </QueryClientProvider>
    );

  it('shows one record\'s history when arrived at from a History link', async () => {
    renderFor('?entity_type=menu_item&entity_id=2421&entity_label=Pepperoni');
    expect(
      await screen.findByRole('heading', { name: /Pepperoni/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/Full history of this record/)).toBeInTheDocument();
    const sent = list.mock.calls[0][0] as {
      entity_type: string;
      entity_id: string;
      date_from: string;
      date_to: string;
    };
    expect(sent.entity_type).toBe('menu_item');
    expect(sent.entity_id).toBe('2421');
    // A record's history is worth more than the time lens's default week
    const span =
      (new Date(sent.date_to).getTime() - new Date(sent.date_from).getTime()) /
      86_400_000;
    expect(span).toBeGreaterThan(300);
  });

  it('keeps the normal heading when not looking at one record', async () => {
    renderFor('');
    expect(await screen.findByText('role.update')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity Log' })).toBeInTheDocument();
    expect(screen.queryByText(/Full history of this record/)).not.toBeInTheDocument();
  });

  it('offers a way back to everything', async () => {
    renderFor('?entity_type=role&entity_id=11');
    expect(
      await screen.findByRole('button', { name: /All activity/ })
    ).toBeInTheDocument();
  });
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
    // Labelled explicitly, because today's role is the wrong answer for a past action
    expect(await screen.findByText(/Role at the time/)).toBeInTheDocument();
    const drawer = screen.getByText(/Role at the time/).closest('dl')!;
    expect(within(drawer).getByText(/Owner/)).toBeInTheDocument();
  });

  it('shows the before/after diff as the centrepiece of the drawer', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('role.update'));
    expect(await screen.findByText('What changed')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('read,write')).toBeInTheDocument();
  });

  it('reads a permission change as what was added and removed', async () => {
    // Two 119-item arrays side by side are unreadable; the question is always
    // "what did they grant themselves?"
    detail.mockResolvedValue({
      ...row(),
      query: null,
      request_body: null,
      response_meta: null,
      changes: {
        permissions: {
          before: ['orders:view', 'orders:create'],
          after: ['orders:view', 'orders:refund'],
        },
      },
      user_agent: null,
      session_id: null,
      device_id: null,
      actor_customer_id: null,
    });
    renderPage();
    fireEvent.click(await screen.findByText('role.update'));
    await screen.findByText('What changed');
    expect(screen.getByText('+ orders:refund')).toBeInTheDocument();
    expect(screen.getByText('− orders:create')).toBeInTheDocument();
    // Unchanged entries are not repeated as noise
    expect(screen.queryByText('+ orders:view')).not.toBeInTheDocument();
    expect(screen.queryByText('− orders:view')).not.toBeInTheDocument();
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
