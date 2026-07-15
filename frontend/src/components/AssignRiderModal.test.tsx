import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import AssignRiderModal from './AssignRiderModal';

const getRiders = vi.fn();
vi.mock('../services/api/adminService', () => ({
  adminService: { getRiders: (brandId?: number) => getRiders(brandId) },
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
    await waitFor(() => expect(getRiders).toHaveBeenCalledWith(28));
  });

  it('with no riders: hides the dropdown and the confirm button, offering only the notice', async () => {
    getRiders.mockResolvedValue([]);
    renderModal();
    expect(await screen.findByRole('link')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.queryByText('Select a rider')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('with riders: shows the dropdown and no notice', async () => {
    getRiders.mockResolvedValue([RIDER]);
    renderModal();
    expect(await screen.findByText('Select a rider')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('confirm stays disabled until a rider is picked', async () => {
    getRiders.mockResolvedValue([RIDER]);
    renderModal();
    await screen.findByText('Select a rider');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('filters the list by the search box and reports the picked rider', async () => {
    getRiders.mockResolvedValue([RIDER, { ...RIDER, id: 41, name: 'fireaway rider 1' }]);
    const { onSelectRider } = renderModal();

    fireEvent.click(await screen.findByRole('button', { name: /Select a rider/ }));
    expect(screen.getByText(/fireaway rider 1/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search riders...'), {
      target: { value: 'ahmad' },
    });
    // SearchableSelect debounces the query before filtering.
    await waitFor(() =>
      expect(screen.queryByText(/fireaway rider 1/)).not.toBeInTheDocument(),
    );

    fireEvent.mouseDown(screen.getByText(/rider ahmad/));
    expect(onSelectRider).toHaveBeenCalledWith(24);
  });
});
