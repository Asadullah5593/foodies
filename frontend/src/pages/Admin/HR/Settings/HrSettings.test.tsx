import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const settingsList = vi.fn();
const settingsSave = vi.fn();
const settingsRemove = vi.fn();
const listDesignations = vi.fn();
const listPublicHolidays = vi.fn();

vi.mock('../../../../services/api/hrService', () => ({
  hrService: {
    settingsList: (...a: unknown[]) => settingsList(...a),
    settingsSave: (...a: unknown[]) => settingsSave(...a),
    settingsRemove: (...a: unknown[]) => settingsRemove(...a),
    listDesignations: (...a: unknown[]) => listDesignations(...a),
    listPublicHolidays: (...a: unknown[]) => listPublicHolidays(...a),
    createPublicHoliday: vi.fn(),
    deletePublicHoliday: vi.fn(),
  },
}));
vi.mock('../../../../utils/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [{ id: 10, name: 'Emporium' }] }) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import HrSettings from './HrSettings';

const template = (over: Record<string, unknown> = {}) => ({
  id: 1,
  branchId: null,
  designationId: null,
  name: 'Morning',
  startTime: '11:00:00',
  endTime: '20:00:00',
  crossesMidnight: false,
  breakMinutes: 60,
  graceMinutes: 15,
  halfDayAfterLateMinutes: 120,
  minMinutesFullDay: 480,
  minMinutesHalfDay: 270,
  overtimeAfterMinutes: 30,
  attributionLeadHours: 6,
  attributionTrailHours: 6,
  isDefault: true,
  isActive: true,
  ...over,
});

const deductionRule = (over: Record<string, unknown> = {}) => ({
  id: 5,
  branchId: null,
  designationId: null,
  trigger: 'late',
  condition: { ladder: [0, 0.5, 0.5] },
  effectType: 'deduct_days',
  effectValue: '0.00',
  priority: 0,
  effectiveFrom: null,
  effectiveTo: null,
  isActive: true,
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HrSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const openTab = (label: string) => fireEvent.click(screen.getByText(label));

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['hr-settings:view', 'hr-settings:manage'];
  listDesignations.mockResolvedValue([
    {
      id: 4,
      name: 'Cashier',
      level: 2,
      slug: 'cashier',
      department: 'front_of_house',
      default_role_id: null,
      default_role_name: null,
      is_active: true,
      employee_count: 0,
    },
  ]);
  listPublicHolidays.mockResolvedValue([]);
  settingsList.mockImplementation((resource: string) => {
    if (resource === 'schedule-templates') return Promise.resolve([template()]);
    if (resource === 'deduction-rules') return Promise.resolve([deductionRule()]);
    return Promise.resolve([]);
  });
  settingsSave.mockResolvedValue({ id: 1, updated: true });
});

describe('HR settings', () => {
  it('shows the shift template that attendance is scored against', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Morning')).toBeInTheDocument());
    expect(screen.getByText('11:00–20:00')).toBeInTheDocument();
    // Grace and the severe-lateness threshold are the two numbers people argue
    // about, so both are on the row rather than hidden in the form.
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('120m')).toBeInTheDocument();
  });

  it('derives the overnight warning from the times rather than asking', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Morning')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Edit Morning'));

    await waitFor(() => expect(screen.getByLabelText('Starts *')).toBeInTheDocument());
    // No "crosses midnight" control exists — a wrong flag computes a 33-hour day.
    expect(screen.queryByText(/crosses midnight/i)).not.toBeInTheDocument();

    const ends = screen.getByLabelText('Ends *');
    fireEvent.change(ends, { target: { value: '02:00' } });
    expect(screen.getByText(/Ends the next day/)).toBeInTheDocument();
  });

  it('describes the late ladder in plain terms', async () => {
    renderPage();
    openTab('Deductions');
    await waitFor(() =>
      expect(screen.getByText('Late arrival (the ladder)')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('0 → 0.5 → 0.5 days, repeating (1 per 3 lates)'),
    ).toBeInTheDocument();
  });

  it('says an empty deduction list still charges the defaults', async () => {
    settingsList.mockResolvedValue([]);
    renderPage();
    openTab('Deductions');
    await waitFor(() =>
      expect(screen.getByText(/payroll uses the shipped defaults/)).toBeInTheDocument(),
    );
  });

  it('sends the edited ladder as an array', async () => {
    renderPage();
    openTab('Deductions');
    await waitFor(() =>
      expect(screen.getByText('Late arrival (the ladder)')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText('Edit rule'));

    const ladder = await screen.findByPlaceholderText('0, 0.5, 0.5');
    fireEvent.change(ladder, { target: { value: '0, 0, 1' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(settingsSave).toHaveBeenCalled());
    const [resource, payload] = settingsSave.mock.calls[0];
    expect(resource).toBe('deduction-rules');
    expect(payload.condition).toEqual({ ladder: [0, 0, 1] });
  });

  it('keeps encashment and carry-forward mutually exclusive', async () => {
    renderPage();
    openTab('Offs & holidays');
    await waitFor(() =>
      expect(screen.getByText('New offs policy')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('New offs policy'));

    const encash = await screen.findByLabelText(/Unused offs are encashed/);
    const carry = screen.getByLabelText(/carry forward to next month/);
    expect(encash).toBeChecked();

    fireEvent.click(carry);
    // Paying a day out AND carrying it into next month would pay for it twice.
    expect(carry).toBeChecked();
    expect(encash).not.toBeChecked();
  });

  it('offers only the tenant default and the caller’s branches as a scope', async () => {
    renderPage();
    openTab('Attendance capture');
    await waitFor(() => expect(screen.getByText('New policy')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New policy'));

    fireEvent.click(await screen.findByRole('button', { name: /Branch scope/ }));
    const list = screen.getByRole('listbox');
    expect(
      within(list).getByText('All branches (tenant default)'),
    ).toBeInTheDocument();
    expect(within(list).getByText('Emporium')).toBeInTheDocument();
  });

  it('is read-only without hr-settings:manage', async () => {
    permissions = ['hr-settings:view'];
    renderPage();
    await waitFor(() => expect(screen.getByText('Morning')).toBeInTheDocument());
    expect(screen.queryByText('New shift')).not.toBeInTheDocument();
    expect(screen.getByText(/Changing them needs/)).toBeInTheDocument();
  });
});
