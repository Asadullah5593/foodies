import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'react-hot-toast';
import { ThemeProvider } from '../../contexts/ThemeContext';

const get = vi.fn();
const patch = vi.fn();

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));
vi.mock('../../services/api', () => ({
  menuService: { getBranchMenu: vi.fn(async () => ({ brands: [] })) },
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/print', () => ({
  printContent: vi.fn(),
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

import KDS from './KDS';
import { printContent } from '../../utils/print';

const order = (id: number, status: string) => ({
  id,
  order_number: `A-${id}`,
  order_type: 'takeaway',
  status,
  items: [{ id: id * 10, name: 'Pizza', quantity: 1 }],
});

/** Orders the fake API returns; mutated per-test before render. */
let kitchenOrders: ReturnType<typeof order>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { is_super_admin: true };
  kitchenOrders = [order(1, 'preparing'), order(2, 'ready')];
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/admin/branches')) return { data: [{ id: 7, name: 'Emporium' }] };
    if (url.startsWith('/kitchen/orders')) return { data: kitchenOrders };
    return { data: [] };
  });
});

const renderKds = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <KDS />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

describe('Back Kitchen ready-order visibility', () => {
  it('hides ready orders by default but keeps the ones still being cooked', async () => {
    renderKds();
    expect(await screen.findByText('#A-1')).toBeInTheDocument();
    expect(screen.queryByText('#A-2')).not.toBeInTheDocument();
  });

  it('counts the hidden ready orders on the toggle and reveals them in a bottom section', async () => {
    renderKds();
    // Generous timeout: the count appears only after branches → orders load,
    // which can exceed the 1s default when the whole suite runs in parallel.
    const toggle = await screen.findByRole('button', { name: 'Show Ready (1)' }, { timeout: 5000 });
    fireEvent.click(toggle);
    expect(await screen.findByText('#A-2')).toBeInTheDocument();
    expect(screen.getByText(/Ready — moved to FOH Packing \(1\)/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Hide Ready' })).toBeInTheDocument();
  });

  it('tells the user why the queue looks empty when every order is ready', async () => {
    kitchenOrders = [order(2, 'ready')];
    renderKds();
    expect(await screen.findByText(/Ready orders are hidden/)).toBeInTheDocument();
    expect(screen.queryByText('#A-2')).not.toBeInTheDocument();
  });

  it('says the queue is empty (not "ready hidden") when there are no orders at all', async () => {
    kitchenOrders = [];
    renderKds();
    expect(await screen.findByText('No orders in queue.')).toBeInTheDocument();
  });

  it('drops the card from the queue and announces the FOH move once it is marked ready', async () => {
    renderKds();
    expect(await screen.findByText('#A-1')).toBeInTheDocument();
    patch.mockImplementation(async () => {
      // The server now reports it as ready, which is what the refetch will see.
      kitchenOrders = [order(1, 'ready')];
      return { data: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: /Change status to Ready/ }));
    await waitFor(() => expect(screen.queryByText('#A-1')).not.toBeInTheDocument(), { timeout: 4000 });
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('moved to the FOH Packing screen'),
      expect.objectContaining({ duration: 4500 }),
    );
  });
});

describe('Back Kitchen KOT print', () => {
  it('prints through the invoice-template renderer using the template returned by the KOT endpoint', async () => {
    const invoiceVM = {
      order_id: 1,
      order_number: 'A-1',
      subtotal: 500,
      total_amount: 500,
      items: [{ name: 'Pizza', quantity: 1, unit_price: 500, subtotal: 500 }],
      template: {
        id: 9,
        layout: 'thermal_classic',
        config: { showLogo: false, footerText: 'KOT footer' },
      },
    };
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/admin/branches')) return { data: [{ id: 7, name: 'Emporium' }] };
      if (url.includes('/kot')) return { data: invoiceVM };
      if (url.startsWith('/kitchen/orders')) return { data: kitchenOrders };
      return { data: [] };
    });
    renderKds();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Print KOT' }))[0]);
    await waitFor(() => expect(printContent).toHaveBeenCalled());
    const [html, title, css] = vi.mocked(printContent).mock.calls[0];
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/kitchen/orders/1/kot?branch_id=7'));
    expect(title).toBe('KOT A-1');
    expect(html).toContain('A-1');
    expect(html).toContain('Pizza');
    expect(html).toContain('KOT footer');
    // The template's layout drives the print CSS (thermal width, not A4).
    expect(css).toContain('80mm');
  });
});

describe('Back Kitchen branch filter permission', () => {
  it('shows the branch filter to super admins', async () => {
    renderKds();
    expect(await screen.findByText('Branch')).toBeInTheDocument();
  });

  it('shows the branch filter to users with back-kitchen:branch-filter', async () => {
    authState.user = { permissions: ['back-kitchen:view', 'back-kitchen:branch-filter'] };
    renderKds();
    expect(await screen.findByText('Branch')).toBeInTheDocument();
  });

  it('hides the branch filter from regular kitchen staff', async () => {
    authState.user = { permissions: ['back-kitchen:view'] };
    renderKds();
    // The auto-selected branch still loads the queue, just without a picker.
    expect(await screen.findByText('#A-1')).toBeInTheDocument();
    expect(screen.queryByText('Branch')).not.toBeInTheDocument();
  });
});
