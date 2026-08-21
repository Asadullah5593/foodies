import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listEmployees = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    listEmployees: (...a: unknown[]) => listEmployees(...a),
    listDesignations: vi.fn().mockResolvedValue([
      { id: 4, name: 'Cashier', level: 2, slug: 'cashier', department: 'front_of_house',
        default_role_id: null, default_role_name: null, is_active: true, employee_count: 0 },
    ]),
  },
}));
vi.mock('../../../utils/apiClient', () => ({
  default: {
    get: vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        data:
          url === '/admin/brands'
            ? [{ id: 25, name: 'Fireaway' }]
            : [{ id: 10, name: 'Pine Avenue' }],
      }),
    ),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import Employees from './Employees';

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Employees />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const pick = async (control: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(control) }));
  // Options can arrive after the trigger renders (brands are fetched), so wait
  // for the one being picked rather than assuming the list is complete.
  const el = await within(screen.getByRole('listbox')).findByText(option);
  fireEvent.mouseDown(el);
};

const lastParams = () =>
  listEmployees.mock.calls[listEmployees.mock.calls.length - 1][0];

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['employees:view'];
  listEmployees.mockResolvedValue({
    data: [],
    meta: { page: 1, limit: 25, total: 0, pages: 1 },
  });
});

describe('Employee list filters', () => {
  it('filters by brand', async () => {
    renderPage();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    await pick('Brand', 'Fireaway');
    await waitFor(() => expect(lastParams().brand_id).toBe(25));
    expect(lastParams().unassigned_brand).toBeUndefined();
  });

  it('finds the shared staff, who have no brand id to match on', async () => {
    renderPage();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    await pick('Brand', 'Shared (no brand)');
    await waitFor(() => expect(lastParams().unassigned_brand).toBe(true));
    expect(lastParams().brand_id).toBeUndefined();
  });

  it('filters by status', async () => {
    renderPage();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    await pick('Status', 'Terminated');
    await waitFor(() => expect(lastParams().status).toBe('terminated'));
  });

  it('offers no status the system never sets', async () => {
    renderPage();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    const list = within(screen.getByRole('listbox'));
    // Approving leave writes attendance days and leaves the employee active,
    // and there is no suspension flow at all — filtering on either would return
    // nothing, for ever.
    expect(list.queryByText('On leave')).toBeNull();
    expect(list.queryByText('Suspended')).toBeNull();
    // Serving notice IS real: Record exit sets it for a future last working day.
    expect(list.getByText('Serving notice')).toBeInTheDocument();
  });

  it('says the checkbox is redundant once a gone status is picked', async () => {
    renderPage();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    await pick('Status', 'Resigned');
    await waitFor(() => expect(lastParams().status).toBe('resigned'));
    // The server includes them for this status; the checkbox would look ignored.
    expect(screen.getByText('(already shown by this status)')).toBeInTheDocument();
  });

  it('returns to page 1 when a filter changes', async () => {
    renderPage();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    await pick('Brand', 'Fireaway');
    await waitFor(() => expect(lastParams().page).toBe(1));
  });
});
