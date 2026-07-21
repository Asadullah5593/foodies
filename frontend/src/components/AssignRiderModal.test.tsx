import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import AssignRiderModal from './AssignRiderModal';

const getRiders = vi.fn();
vi.mock('../services/api/adminService', () => ({
  adminService: {
    getRiders: (brandId?: number, orderId?: number) => getRiders(brandId, orderId),
  },
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { allowed_brand_ids: null } }),
}));

const RIDER = {
  id: 24,
  name: 'rider ahmad',
  email: null,
  phone: '0300123',
  rating_average: 5,
  rating_count: 1,
  is_eligible: null,
  ineligible_reasons: [],
  ineligible_detail: null,
  distance_m: null,
  premises_radius_m: null,
};

/** Same rider, judged against an order: available. */
const AVAILABLE = { ...RIDER, is_eligible: true, distance_m: 120, premises_radius_m: 300 };

/** Judged against an order and blocked by the premises geofence. */
const OUTSIDE = {
  ...RIDER,
  id: 41,
  name: 'fireaway rider 1',
  is_eligible: false,
  ineligible_reasons: ['outside_premises'],
  ineligible_detail:
    'This rider is outside the branch premises (about 2605m away); they must be within 481m of the branch.',
  distance_m: 2605,
  premises_radius_m: 481,
};

const renderModal = (props: Partial<React.ComponentProps<typeof AssignRiderModal>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onConfirm = vi.fn();
  const onSelectRider = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter>
          <AssignRiderModal
            isOpen
            onClose={vi.fn()}
            title="Assign rider"
            subject="Order #001"
            confirmLabel="Assign"
            brandId={28}
            brandName="Wok & Go"
            selectedRiderId={null}
            onSelectRider={onSelectRider}
            onConfirm={onConfirm}
            {...props}
          />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onConfirm, onSelectRider };
};

describe('AssignRiderModal', () => {
  beforeEach(() => {
    getRiders.mockReset();
  });

  it('scopes the rider fetch to the order brand', async () => {
    getRiders.mockResolvedValue([]);
    renderModal();
    await waitFor(() => expect(getRiders).toHaveBeenCalledWith(28, undefined));
  });

  it('passes the order id so the list is availability-aware', async () => {
    getRiders.mockResolvedValue([]);
    renderModal({ orderId: 83 });
    await waitFor(() => expect(getRiders).toHaveBeenCalledWith(28, 83));
  });

  it('with no riders: hides the list and the confirm button, offering only the notice', async () => {
    getRiders.mockResolvedValue([]);
    renderModal();
    expect(await screen.findByRole('link')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('with riders: lists them and shows no notice', async () => {
    getRiders.mockResolvedValue([RIDER]);
    renderModal();
    expect(await screen.findByText('rider ahmad')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('confirm stays disabled until a rider is picked', async () => {
    getRiders.mockResolvedValue([RIDER]);
    renderModal();
    await screen.findByText('rider ahmad');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('reports the picked rider', async () => {
    getRiders.mockResolvedValue([RIDER]);
    const { onSelectRider } = renderModal();
    fireEvent.click(await screen.findByText('rider ahmad'));
    expect(onSelectRider).toHaveBeenCalledWith(24);
  });

  describe('availability (order context)', () => {
    it('badges an available rider and shows their distance', async () => {
      getRiders.mockResolvedValue([AVAILABLE]);
      renderModal({ orderId: 83 });
      expect(await screen.findByText('Available')).toBeInTheDocument();
      expect(screen.getByText('120 m from branch')).toBeInTheDocument();
    });

    it('blocks an out-of-premises rider and spells out why in full', async () => {
      getRiders.mockResolvedValue([OUTSIDE]);
      const { onSelectRider } = renderModal({ orderId: 83 });

      expect(await screen.findByText('Outside premises')).toBeInTheDocument();
      // The whole sentence renders — it used to be a truncated native tooltip.
      expect(screen.getByText(/must be within 481m of the branch/)).toBeInTheDocument();
      expect(screen.getByText('2.6 km from branch')).toBeInTheDocument();

      const row = screen.getByRole('button', { name: /fireaway rider 1/ });
      expect(row).toBeDisabled();
      fireEvent.click(row);
      expect(onSelectRider).not.toHaveBeenCalled();
    });

    it('summarises how many riders are available', async () => {
      getRiders.mockResolvedValue([AVAILABLE, OUTSIDE]);
      renderModal({ orderId: 83 });
      expect(await screen.findByText(/of 2 riders are available/)).toBeInTheDocument();
    });

    it('warns plainly when nobody can take the order', async () => {
      getRiders.mockResolvedValue([OUTSIDE]);
      renderModal({ orderId: 83 });
      expect(await screen.findByText(/No rider is available right now/)).toBeInTheDocument();
    });

    it('refuses to confirm a rider who became unavailable', async () => {
      getRiders.mockResolvedValue([OUTSIDE]);
      renderModal({ orderId: 83, selectedRiderId: 41 });
      await screen.findByText('Outside premises');
      expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    });

    it('sorts available riders above blocked ones', async () => {
      getRiders.mockResolvedValue([OUTSIDE, AVAILABLE]);
      renderModal({ orderId: 83 });
      await screen.findByText('Available');
      const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
      const availableAt = names.findIndex((t) => t.includes('rider ahmad'));
      const blockedAt = names.findIndex((t) => t.includes('fireaway rider 1'));
      expect(availableAt).toBeLessThan(blockedAt);
    });
  });

  it('filters the list by the search box once it is long enough to need one', async () => {
    getRiders.mockResolvedValue([
      RIDER,
      { ...RIDER, id: 41, name: 'fireaway rider 1' },
      { ...RIDER, id: 42, name: 'rider three' },
      { ...RIDER, id: 43, name: 'rider four' },
    ]);
    renderModal();

    await screen.findByText('rider ahmad');
    fireEvent.change(screen.getByPlaceholderText(/Search riders/), {
      target: { value: 'ahmad' },
    });
    expect(screen.queryByText('fireaway rider 1')).not.toBeInTheDocument();
    expect(screen.getByText('rider ahmad')).toBeInTheDocument();
  });

  it('hides the search box for a short list', async () => {
    getRiders.mockResolvedValue([RIDER]);
    renderModal();
    await screen.findByText('rider ahmad');
    expect(screen.queryByPlaceholderText(/Search riders/)).not.toBeInTheDocument();
  });
});
