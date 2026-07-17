import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';

const get = vi.fn();
const patch = vi.fn();

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));
vi.mock('../../services/api/adminService', () => ({
  adminService: { assignRider: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const authState = vi.hoisted(() => ({
  user: { is_super_admin: true } as {
    is_super_admin?: boolean;
    permissions?: string[];
  },
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

import FOHPacking from './Packing';

const order = (id: number, status: string) => ({
  id,
  order_number: `A-${id}`,
  order_type: 'takeaway',
  status,
  items: [{ id: id * 10, name: 'Pizza', quantity: 1 }],
});

/** Everything the branch has today; the fake API applies include_completed. */
let allOrders: ReturnType<typeof order>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { is_super_admin: true };
  allOrders = [order(1, 'preparing'), order(2, 'ready'), order(3, 'completed')];
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/admin/branches')) return { data: [{ id: 7, name: 'Emporium' }] };
    if (url.startsWith('/kitchen/orders')) {
      const includeCompleted = url.includes('include_completed=1');
      return { data: allOrders.filter((o) => includeCompleted || o.status !== 'completed') };
    }
    return { data: [] };
  });
});

const renderPacking = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <FOHPacking />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

describe('FOH Packing queue', () => {
  it('defaults to the ready queue, with completed orders hidden', async () => {
    renderPacking();
    expect(await screen.findByText('Order #A-2')).toBeInTheDocument();
    expect(screen.queryByText('Order #A-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Order #A-3')).not.toBeInTheDocument();
  });

  it('reveals completed orders in a bottom section when toggled', async () => {
    renderPacking();
    fireEvent.click(await screen.findByRole('button', { name: 'Show Completed' }));
    expect(await screen.findByText('Order #A-3')).toBeInTheDocument();
    expect(screen.getByText(/Completed \(1\)/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Hide Completed' })).toBeInTheDocument();
  });

  it('dissolves a packed order out of the queue when marked completed', async () => {
    renderPacking();
    expect(await screen.findByText('Order #A-2')).toBeInTheDocument();
    patch.mockImplementation(async () => {
      allOrders = [order(1, 'preparing'), order(2, 'completed'), order(3, 'completed')];
      return { data: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Change status to Completed' }));
    await waitFor(() => expect(screen.queryByText('Order #A-2')).not.toBeInTheDocument(), { timeout: 4000 });
  });
});

describe('FOH branch filter permission', () => {
  it('shows the branch filter to users with foh:branch-filter', async () => {
    authState.user = { permissions: ['customer-display:view', 'foh:branch-filter'] };
    renderPacking();
    expect(await screen.findByText('Branch')).toBeInTheDocument();
  });

  it('hides the branch filter from regular FOH staff', async () => {
    authState.user = { permissions: ['customer-display:view', 'customer-display:update'] };
    renderPacking();
    expect(await screen.findByText('Order #A-2')).toBeInTheDocument();
    expect(screen.queryByText('Branch')).not.toBeInTheDocument();
  });
});
