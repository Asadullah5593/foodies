import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBusinessSettings = vi.fn();
const updateBusinessSettings = vi.fn();
vi.mock('../../services/api', () => ({
  adminService: {
    getBusinessSettings: () => getBusinessSettings(),
    updateBusinessSettings: (...a: unknown[]) => updateBusinessSettings(...a),
  },
}));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));

const authState = vi.hoisted(() => ({ user: { tenant_id: 1 } as { tenant_id: number | null } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));

import BusinessSettings from './BusinessSettings';

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { tenant_id: 1 };
  // API stores GST as a fraction; the page shows percent.
  getBusinessSettings.mockResolvedValue({
    name: 'Foodies',
    legal_name: 'Foodies Pvt Ltd',
    gst_rate_cash: 0.15,
    gst_rate_card: 0.05,
    loyalty_enabled: true,
    auto_print_invoices: false,
  });
  updateBusinessSettings.mockResolvedValue({});
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <BusinessSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

/** The summary card — the "Summary" heading's parent. */
const summary = () => screen.getByText('Summary').parentElement as HTMLElement;
const save = () => screen.getByRole('button', { name: /Save changes/ });

describe('Business Settings', () => {
  it('loads the tenant settings into the form as percentages', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('Foodies')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Foodies Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });

  it('summarises the live form state, not the saved state', async () => {
    renderPage();
    await screen.findByDisplayValue('Foodies');
    expect(within(summary()).getByText('15% cash / 5% card')).toBeInTheDocument();
    expect(within(summary()).getByText('Enabled')).toBeInTheDocument();
    expect(within(summary()).getByText('Off')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('15'), { target: { value: '17' } });
    expect(within(summary()).getByText('17% cash / 5% card')).toBeInTheDocument();
  });

  it('says "default" for a blank GST rate', async () => {
    getBusinessSettings.mockResolvedValue({ name: 'Foodies', gst_rate_cash: null, gst_rate_card: null });
    renderPage();
    await screen.findByDisplayValue('Foodies');
    expect(within(summary()).getByText('default cash / default card')).toBeInTheDocument();
  });

  it('converts percentages back to fractions on save', async () => {
    renderPage();
    await screen.findByDisplayValue('Foodies');
    fireEvent.change(screen.getByDisplayValue('15'), { target: { value: '17.5' } });
    fireEvent.click(save());
    await waitFor(() => expect(updateBusinessSettings).toHaveBeenCalled());
    expect(updateBusinessSettings.mock.calls[0][0]).toMatchObject({
      name: 'Foodies',
      gst_rate_cash: 0.175,
      gst_rate_card: 0.05,
      loyalty_enabled: true,
      auto_print_invoices: false,
    });
  });

  it('sends null for a cleared GST rate rather than 0', async () => {
    renderPage();
    await screen.findByDisplayValue('Foodies');
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '' } });
    fireEvent.click(save());
    await waitFor(() => expect(updateBusinessSettings).toHaveBeenCalled());
    expect(updateBusinessSettings.mock.calls[0][0].gst_rate_card).toBeNull();
  });

  it('saves the toggles through the On/Off controls', async () => {
    renderPage();
    await screen.findByDisplayValue('Foodies');
    const printing = screen.getByRole('group', { name: 'Auto-print invoices when an order is placed' });
    fireEvent.click(within(printing).getByRole('button', { name: 'On' }));
    expect(within(summary()).getByText('On')).toBeInTheDocument();

    const loyalty = screen.getByRole('group', { name: 'Enable loyalty / rewards program' });
    fireEvent.click(within(loyalty).getByRole('button', { name: 'Off' }));
    expect(within(summary()).getByText('Disabled')).toBeInTheDocument();

    fireEvent.click(save());
    await waitFor(() => expect(updateBusinessSettings).toHaveBeenCalled());
    expect(updateBusinessSettings.mock.calls[0][0]).toMatchObject({
      auto_print_invoices: true,
      loyalty_enabled: false,
    });
  });

  it('refuses to save a business with no name', async () => {
    renderPage();
    await screen.findByDisplayValue('Foodies');
    fireEvent.change(screen.getByDisplayValue('Foodies'), { target: { value: '  ' } });
    fireEvent.click(save());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Business name is required'));
    expect(updateBusinessSettings).not.toHaveBeenCalled();
  });

  it('tells a super admin this page is not for them', async () => {
    authState.user = { tenant_id: null };
    renderPage();
    expect(await screen.findByText(/only available for tenant users/)).toBeInTheDocument();
    expect(getBusinessSettings).not.toHaveBeenCalled();
  });
});
