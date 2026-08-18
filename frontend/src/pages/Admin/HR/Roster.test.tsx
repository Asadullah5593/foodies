import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRoster = vi.fn();
const saveRoster = vi.fn();
const listScheduleTemplates = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    getRoster: (...a: unknown[]) => getRoster(...a),
    saveRoster: (...a: unknown[]) => saveRoster(...a),
    listScheduleTemplates: (...a: unknown[]) => listScheduleTemplates(...a),
  },
}));
vi.mock('../../../utils/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [{ id: 10, name: 'Emporium' }] }) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import Roster from './Roster';

// The component derives its week from today, so the fixtures must too — a
// hard-coded date would make these tests pass only during one week of the year.
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const monday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
})();

const dayOfWeek = (n: number) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

const grid = (cells: unknown[] = []) => ({
  range: { from: dayOfWeek(0), to: dayOfWeek(6) },
  employees: [
    {
      id: 7,
      full_name: 'Bilal Ahmed',
      employee_code: 'EMP-0007',
      status: 'active',
      designation_name: 'Cashier',
      brand_name: 'Fireaway',
      default_template_id: 2,
    },
  ],
  cells,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Roster />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  permissions = ['attendance:view', 'hr-settings:manage'];
  listScheduleTemplates.mockResolvedValue([
    {
      id: 2,
      name: 'Morning',
      startTime: '11:00:00',
      endTime: '23:00:00',
      crossesMidnight: false,
      branchId: 10,
      graceMinutes: 15,
      isDefault: true,
    },
  ]);
  saveRoster.mockResolvedValue({ written: 1, cleared: 0 });
});

/** Pick the value from the "Set selected cells to" dropdown. */
const chooseValue = (label: string) => {
  // The trigger shows the current selection, not the placeholder, so it is
  // addressed by its accessible name.
  fireEvent.click(screen.getByRole('button', { name: /Value to apply/ }));
  // Scoped to the open list: the trigger shows the same label as the selected
  // option, so an unscoped query matches twice.
  fireEvent.mouseDown(within(screen.getByRole('listbox')).getByText(label));
};

const dayCells = () =>
  screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));

describe('Roster', () => {
  it('shows an unset cell as Default rather than as a gap', async () => {
    getRoster.mockResolvedValue(grid());
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    const cells = dayCells();
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveTextContent('Default');
  });

  it('applies one value to every selected cell at once', async () => {
    getRoster.mockResolvedValue(grid());
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    // Selecting the whole column is one click on the day heading.
    fireEvent.click(screen.getAllByTitle('Select this whole day')[3]);
    chooseValue('Day off');
    fireEvent.click(screen.getByText('Apply to 1 cell'));
    fireEvent.click(screen.getByText('Save 1 change'));

    await waitFor(() => expect(saveRoster).toHaveBeenCalled());
    const payload = saveRoster.mock.calls[0][0];
    expect(payload.cells).toEqual([
      {
        employee_id: 7,
        work_date: dayOfWeek(3),
        template_id: null,
        is_weekly_off: true,
        is_holiday: false,
      },
    ]);
  });

  it('sends a cleared cell as an empty cell so the server deletes the row', async () => {
    getRoster.mockResolvedValue(
      grid([
        {
          id: 3,
          employee_id: 7,
          work_date: dayOfWeek(0),
          template_id: null,
          is_weekly_off: true,
          is_holiday: false,
          is_published: true,
        },
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(dayCells()[0]).toHaveTextContent('Day off');

    fireEvent.click(dayCells()[0]);
    chooseValue('Default shift (clears the cell)');
    fireEvent.click(screen.getByText('Apply to 1 cell'));
    fireEvent.click(screen.getByText('Save 1 change'));

    await waitFor(() => expect(saveRoster).toHaveBeenCalled());
    expect(saveRoster).toHaveBeenCalledWith({
      branch_id: 10,
      cells: [
        {
          employee_id: 7,
          work_date: dayOfWeek(0),
          template_id: null,
          is_weekly_off: false,
          is_holiday: false,
        },
      ],
    });
  });

  it('does not count a cell set back to its saved value as a change', async () => {
    getRoster.mockResolvedValue(
      grid([
        {
          id: 3,
          employee_id: 7,
          work_date: dayOfWeek(0),
          template_id: null,
          is_weekly_off: true,
          is_holiday: false,
          is_published: true,
        },
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    fireEvent.click(dayCells()[0]);
    chooseValue('Default shift (clears the cell)');
    fireEvent.click(screen.getByText('Apply to 1 cell'));
    expect(screen.getByText('Save 1 change')).toBeInTheDocument();

    fireEvent.click(dayCells()[0]);
    chooseValue('Day off');
    fireEvent.click(screen.getByText('Apply to 1 cell'));
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('sends a chosen template as the cell value', async () => {
    getRoster.mockResolvedValue(grid());
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    fireEvent.click(dayCells()[2]);
    chooseValue('Morning (11:00–23:00)');
    fireEvent.click(screen.getByText('Apply to 1 cell'));
    fireEvent.click(screen.getByText('Save 1 change'));

    await waitFor(() => expect(saveRoster).toHaveBeenCalled());
    const payload = saveRoster.mock.calls[0][0];
    expect(payload.cells[0].template_id).toBe(2);
    expect(payload.cells[0].work_date).toBe(dayOfWeek(2));
  });

  it('is read-only without hr-settings:manage', async () => {
    permissions = ['attendance:view'];
    getRoster.mockResolvedValue(grid());
    renderPage();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.queryByText('No changes')).not.toBeInTheDocument();
    expect(screen.queryByText('Set selected cells to')).not.toBeInTheDocument();
    expect(dayCells()[0]).toBeDisabled();
  });
});
