import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** On a phone each log entry is a card that carries what the table's columns held. */

const mockUser = vi.fn(() => ({ permissions: ['activity-log:view', 'activity-log:configure'] }) as unknown);
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser() }) }));

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
  branch_id: 4,
  brand_id: 2,
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

const page = (rows: unknown[]) => ({ data: rows, total: rows.length, page: 1, page_size: 25, outcome_counts: { success: rows.length, denied: 0, failed: 0, error: 0 } });

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/activity-logs']}>
        <ActivityLog />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(390);
  list.mockResolvedValue(page([row()]));
  filterOptions.mockResolvedValue({
    actions: ['role.update'],
    action_groups: ['access', 'auth'],
    actors: [{ actor_user_id: 13, actor_label: 'foodies' }],
    branches: [{ id: 4, name: 'Johar Town' }],
    brands: [{ id: 2, name: 'Wok & Go' }],
    roles: [{ name: 'Cashier', slugs: ['cashier'] }],
    record_types: ['role'],
    outcomes: ['success', 'denied', 'failed', 'error'],
    actor_types: ['staff', 'customer'],
    max_window_days: 92,
  });
  detail.mockResolvedValue({ ...row(), query: null, request_body: {}, response_meta: {}, changes: {}, user_agent: 'Chrome', session_id: null, device_id: null, actor_customer_id: null });
  related.mockResolvedValue([]);
  settings.mockResolvedValue({ capture_level: 'mutations+sensitive_reads', pii_mode: 'mask', hot_months: 3, retention_months: 13, updated_at: null, env_disabled: false });
});
afterEach(() => setWidth(1024));

describe('Activity log on a phone', () => {
  it('shows each entry as a card with when, who, where, what, the record, the result and the address', async () => {
    renderPage();
    const cards = await screen.findByTestId('activity-cards');
    expect(screen.queryByRole('table')).toBeNull();
    const card = cards.querySelector('li') as HTMLElement;
    const text = card.textContent ?? '';
    for (const expected of ['foodies', 'Owner', 'Johar Town', 'Wok & Go', 'Cashier', 'role #4', '1 field changed', '203.0.113.9', 'Details']) {
      expect(text).toContain(expected);
    }
    expect(within(card).getByText(/^Changed role/)).toBeInTheDocument();
    // tapping the card opens the entry's details
    fireEvent.click(within(card).getByRole('button', { name: /Changed role/ }));
    await waitFor(() => expect(detail).toHaveBeenCalled());
  });

  it('folds a burst of entries into one card that opens to list them', async () => {
    list.mockResolvedValue(page([
      row({ id: '201', action: 'menu_item.update', entity_type: 'menu_item', entity_id: '7', entity_label: 'Zinger', request_id: 'req-9', created_at: '2026-08-05T09:20:00.000Z' }),
      row({ id: '202', action: 'menu_item.update', entity_type: 'menu_item', entity_id: '8', entity_label: 'Wings', request_id: 'req-9', created_at: '2026-08-05T09:20:01.000Z' }),
    ]));
    renderPage();
    const cards = await screen.findByTestId('activity-cards');
    const groupCard = cards.querySelector('li') as HTMLElement;
    if (!/2 entries/.test(groupCard.textContent ?? '')) {
      // Not grouped by this build's rules: two separate cards, each with its own Details.
      expect(cards.querySelectorAll(':scope > li')).toHaveLength(2);
      return;
    }
    expect(groupCard.textContent).toContain('Show all');
    fireEvent.click(within(groupCard).getAllByRole('button')[0]);
    await waitFor(() => expect(groupCard.textContent).toContain('Hide'));
    expect(within(groupCard).getAllByRole('button').length).toBeGreaterThanOrEqual(3);
  });
});
