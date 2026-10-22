import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'react-hot-toast';

const getDiscounts = vi.fn();
const createDiscount = vi.fn();
const updateDiscount = vi.fn();
vi.mock('../../services/api/adminService', () => ({
  adminService: {
    getDiscounts: (...a: unknown[]) => getDiscounts(...a),
    createDiscount: (...a: unknown[]) => createDiscount(...a),
    updateDiscount: (...a: unknown[]) => updateDiscount(...a),
    deleteDiscount: vi.fn(),
  },
}));
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn((url: string) =>
      Promise.resolve({
        data: url.includes('branches')
          ? [
              { id: 1, name: 'DHA', timezone: 'Asia/Karachi' },
              { id: 2, name: 'Johar Town', timezone: 'Asia/Karachi' },
            ]
          : url.includes('brands')
            ? [{ id: 1, name: 'Fireaway' }]
            : [],
      }),
    ),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: true, allowed_brand_ids: null } }),
}));

import Discounts from './Discounts';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { MemoryRouter } from 'react-router-dom';

/** The Special 50% off as it is on prod after the SQL fix: ends 2:00 AM Mon 26 Oct. */
const weekend = (over: Record<string, unknown> = {}) => ({
  id: 63,
  name: 'Special 50% off',
  type: 'percentage',
  value: 50,
  is_active: true,
  manage_scope: 'full',
  effective_brand_ids: null,
  application_scope: 'whole_order',
  eligibility_branch_ids: [],
  eligibility_brand_ids: [],
  channels: null,
  order_types: null,
  valid_from: '2026-10-23T00:00:00.000Z',
  valid_until: '2026-10-25T21:00:00.000Z',
  valid_time_start: null,
  valid_time_end: null,
  valid_days_of_week: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getDiscounts.mockResolvedValue([weekend()]);
  createDiscount.mockResolvedValue({});
  updateDiscount.mockResolvedValue({});
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <Discounts />
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
};

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const dailyField = (label: 'Each day from' | 'Each day until') =>
  screen.getByText(label).parentElement!.querySelector('input') as HTMLInputElement;
const set = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } });

describe('Discounts form: start and end times', () => {
  it('saves "Fri 23 Oct to Mon 26 Oct, 2:00 AM" as a whole first day and an exact end', async () => {
    getDiscounts.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Discount' }));

    set(screen.getByPlaceholderText('e.g. Weekend 10% off') as HTMLInputElement, 'Weekend');
    set(screen.getByPlaceholderText('0.00') as HTMLInputElement, '100');
    expect(field('Valid until time').disabled).toBe(true);
    set(field('Valid from date'), '2026-10-23');
    set(field('Valid until date'), '2026-10-26');
    expect(field('Valid until time').disabled).toBe(false);
    set(field('Valid until time'), '02:00');

    expect(
      screen.getByText(
        'Runs from the start of Fri 23 Oct 2026 until 2:00 AM on Mon 26 Oct 2026 (Pakistan time).',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Discount' }));
    await waitFor(() => expect(createDiscount).toHaveBeenCalledTimes(1));
    expect(createDiscount.mock.calls[0][0]).toMatchObject({
      valid_from: '2026-10-23',
      valid_until: '2026-10-25T21:00:00.000Z',
      valid_time_start: null,
      valid_time_end: null,
      valid_days_of_week: null,
    });
  });

  it('shows a saved end time in Pakistan time, on the list and in the form, and saves it back unchanged', async () => {
    renderPage();
    expect(
      await screen.findByText(
        'Runs from the start of Fri 23 Oct 2026 until 2:00 AM on Mon 26 Oct 2026 (Pakistan time).',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(field('Valid from date').value).toBe('2026-10-23');
    expect(field('Valid from time').value).toBe('');
    // Not the UTC date (25 Oct) the old form showed.
    expect(field('Valid until date').value).toBe('2026-10-26');
    expect(field('Valid until time').value).toBe('02:00');

    fireEvent.click(screen.getByRole('button', { name: 'Update Discount' }));
    await waitFor(() => expect(updateDiscount).toHaveBeenCalledTimes(1));
    expect(updateDiscount.mock.calls[0][0]).toBe(63);
    expect(updateDiscount.mock.calls[0][1]).toMatchObject({
      valid_from: '2026-10-23',
      valid_until: '2026-10-25T21:00:00.000Z',
    });
  });

  it('keeps an old whole-day offer exactly as it was', async () => {
    getDiscounts.mockResolvedValue([weekend({ valid_until: '2026-11-30T00:00:00.000Z' })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(field('Valid until date').value).toBe('2026-11-30');
    expect(field('Valid until time').value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Update Discount' }));
    await waitFor(() => expect(updateDiscount).toHaveBeenCalledTimes(1));
    expect(updateDiscount.mock.calls[0][1]).toMatchObject({
      valid_from: '2026-10-23',
      valid_until: '2026-11-30',
    });
  });

  it('clears a removed end date instead of keeping the old one', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    set(field('Valid until date'), '');
    expect(field('Valid until time').value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Update Discount' }));
    await waitFor(() => expect(updateDiscount).toHaveBeenCalledTimes(1));
    expect(updateDiscount.mock.calls[0][1]).toMatchObject({ valid_until: null });
  });

  it('spells out daily hours, and refuses hours that cross midnight', async () => {
    getDiscounts.mockResolvedValue([
      weekend({
        valid_until: '2026-10-26T00:00:00.000Z',
        valid_time_end: '02:00:00',
        valid_days_of_week: [0, 1, 5, 6],
      }),
    ]);
    renderPage();
    // The setup that ran the offer only from 12 to 2 AM is now visible on the list.
    expect(
      await screen.findByText(
        'Runs from the start of Fri 23 Oct 2026 until the end of Mon 26 Oct 2026 (Pakistan time). ' +
          'Only between 12:00 AM and 2:00 AM each day. Only on Sun, Mon, Fri, Sat.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    set(dailyField('Each day from'), '22:00');
    fireEvent.click(screen.getByRole('button', { name: 'Update Discount' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/cannot run past midnight/));
    expect(updateDiscount).not.toHaveBeenCalled();
  });

  it('refuses an end before the start', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    set(field('Valid from time'), '18:00');
    set(field('Valid until date'), '2026-10-23');
    set(field('Valid until time'), '12:00');
    fireEvent.click(screen.getByRole('button', { name: 'Update Discount' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ends before it starts/));
    expect(updateDiscount).not.toHaveBeenCalled();
  });
});
