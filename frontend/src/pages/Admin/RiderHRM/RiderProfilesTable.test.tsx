import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import RiderProfilesTable from './RiderProfilesTable';

const getRiders = vi.fn();
const getRiderProfiles = vi.fn();
const upsertRiderProfile = vi.fn();
vi.mock('../../../services/api/adminService', () => ({
  adminService: {
    getRiders: () => getRiders(),
    getRiderProfiles: () => getRiderProfiles(),
    upsertRiderProfile: (data: unknown) => upsertRiderProfile(data),
  },
}));

let canEdit = true;
vi.mock('../../../hooks/useHasPermission', () => ({
  useHasPermission: () => canEdit,
}));

const RIDERS = [
  { id: 41, name: 'fireaway rider 1', email: null, phone: '03001234567', rating_average: 4.5, rating_count: 10 },
  { id: 42, name: 'loranzo rider 2', email: null, phone: '03017654321', rating_average: null, rating_count: 0 },
];

// Rider 41 has a saved profile; rider 42 has none yet.
const PROFILES = [
  {
    id: 7,
    user_id: 41,
    user_name: 'fireaway rider 1',
    salary_type: 'hybrid',
    base_salary: 10000,
    default_per_ride_commission: 100,
    is_active: true,
    owner_brand_id: 25,
    owner_brand_name: 'Fireaway',
    brands: [],
  },
];

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RiderProfilesTable />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  canEdit = true;
  getRiders.mockResolvedValue(RIDERS);
  getRiderProfiles.mockResolvedValue(PROFILES);
  upsertRiderProfile.mockResolvedValue({});
});

describe('RiderProfilesTable — base salary CRUD', () => {
  it('lists every rider, with the saved salary or "not set"', async () => {
    renderPage();
    expect(await screen.findByText('fireaway rider 1')).toBeTruthy();
    expect(screen.getByText('loranzo rider 2')).toBeTruthy();
    expect(screen.getByText(/10,?000/)).toBeTruthy();
    expect(screen.getByText('not set')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set salary' })).toBeTruthy();
  });

  it('Edit opens the dialog prefilled with the current salary', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('10000');
  });

  it('saves ONLY user_id + base_salary (never the other HR fields)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '12500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(upsertRiderProfile).toHaveBeenCalledWith({ user_id: 41, base_salary: 12500 }),
    );
    expect(upsertRiderProfile).toHaveBeenCalledTimes(1);
  });

  it('a rider without a profile starts empty and saves the typed value', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Set salary' }));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByText('No salary saved for this rider yet.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '8500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(upsertRiderProfile).toHaveBeenCalledWith({ user_id: 42, base_salary: 8500 }),
    );
  });

  it('Save is disabled while the input is empty — an existing salary cannot be wiped to 0 by accident', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(upsertRiderProfile).not.toHaveBeenCalled();
  });

  it('search filters the rider rows', async () => {
    renderPage();
    await screen.findByText('fireaway rider 1');
    fireEvent.change(screen.getByLabelText('Search riders'), { target: { value: 'loranzo' } });
    expect(screen.queryByText('fireaway rider 1')).toBeNull();
    expect(screen.getByText('loranzo rider 2')).toBeTruthy();
  });

  it('a saved salary whose rider is deactivated/unlinked still shows as an "inactive rider" row', async () => {
    getRiderProfiles.mockResolvedValue([
      ...PROFILES,
      {
        id: 9,
        user_id: 77,
        user_name: 'departed rider',
        salary_type: 'hybrid',
        base_salary: 25000,
        default_per_ride_commission: 0,
        is_active: false,
        owner_brand_id: null,
        owner_brand_name: null,
        brands: [],
      },
    ]);
    renderPage();
    expect(await screen.findByText('departed rider')).toBeTruthy();
    expect(screen.getByText('inactive rider')).toBeTruthy();
    expect(screen.getByText(/25,?000/)).toBeTruthy();
    // Still editable — the salary keeps feeding payroll.
    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    expect(editButtons.length).toBe(2);
  });

  it('a failed profiles load shows an error instead of an editable "not set" table', async () => {
    getRiderProfiles.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load the saved salaries.")).toBeTruthy();
    expect(screen.queryByText('not set')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set salary' })).toBeNull();
  });

  it('a failed riders load shows an error instead of the false empty state', async () => {
    getRiders.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText("Couldn't load the rider list.")).toBeTruthy();
    expect(screen.queryByText(/No riders yet/)).toBeNull();
  });

  it('without rider-profiles:edit the table is read-only', async () => {
    canEdit = false;
    renderPage();
    await screen.findByText('fireaway rider 1');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set salary' })).toBeNull();
  });
});
