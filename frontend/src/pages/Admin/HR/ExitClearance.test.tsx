import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getExit = vi.fn();
const updateClearanceItem = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    getEmployee: vi.fn().mockResolvedValue({
      id: 6, employee_code: 'EMP-0006', full_name: 'Wok Cashier', father_name: null,
      cnic: null, date_of_birth: null, gender: null, phone: null, address: null,
      emergency_contact_name: null, emergency_contact_phone: null, photo_url: null,
      user_id: null, has_login: false, employment_type: 'full_time',
      date_of_joining: '2026-07-21', probation_end_date: null, confirmation_date: null,
      status: 'resigned', date_of_leaving: '2026-08-20', leaving_reason: null,
      rehire_eligible: true, has_pin: false, qr_token: null, qr_token_issued_at: null,
      current_assignment: null, assignments: [], timeline: [], documents: [], warnings: [],
    }),
    getExit: (...a: unknown[]) => getExit(...a),
    updateClearanceItem: (...a: unknown[]) => updateClearanceItem(...a),
    listDesignations: vi.fn().mockResolvedValue([]),
    listAdvances: vi.fn().mockResolvedValue([]),
    listReviewCycles: vi.fn().mockResolvedValue([]),
    listEmployeeTrainings: vi.fn().mockResolvedValue([]),
    listTrainingPrograms: vi.fn().mockResolvedValue([]),
    getSalaryHistory: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import EmployeeDetail from './EmployeeDetail';

const exitRecord = (over: Record<string, unknown> = {}) => ({
  id: 3,
  employee_id: 6,
  exit_type: 'end_of_contract',
  initiated_on: '2026-08-19',
  last_working_date: '2026-08-20',
  notice_period_days: 0,
  reason: null,
  exit_interview_notes: null,
  rehire_eligible: true,
  clearance_status: 'pending',
  settlement_payroll_line_id: null,
  settled_at: null,
  initiated_by: null,
  clearance_items: [
    { id: 11, item_type: 'uniform', description: 'Uniform returned', responsible_role: null,
      status: 'pending', note: null, cleared_at: null },
  ],
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/hr/employees/6']}>
        {/* A real route, so useParams gives the page its employee id. */}
        <Routes>
          <Route path="/admin/hr/employees/:id" element={<EmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['employees:view', 'employees:terminate'];
  getExit.mockResolvedValue(exitRecord());
  updateClearanceItem.mockResolvedValue({ id: 3, clearance_status: 'in_progress' });
});

describe('Exit clearance', () => {
  it('lets a clearance item actually be ticked off', async () => {
    // It rendered as plain text before, so every exit stayed "pending" for ever.
    renderPage();
    await waitFor(() => expect(screen.getByText('Uniform returned')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cleared'));
    await waitFor(() =>
      expect(updateClearanceItem).toHaveBeenCalledWith(3, 11, {
        status: 'cleared',
        note: undefined,
      }),
    );
  });

  it('demands a reason before withholding', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Uniform not returned');
    renderPage();
    await waitFor(() => expect(screen.getByText('Uniform returned')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Withhold'));
    await waitFor(() =>
      expect(updateClearanceItem).toHaveBeenCalledWith(3, 11, {
        status: 'withheld',
        note: 'Uniform not returned',
      }),
    );
    prompt.mockRestore();
  });

  it('records nothing when the reason is cancelled', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    renderPage();
    await waitFor(() => expect(screen.getByText('Uniform returned')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Withhold'));
    expect(updateClearanceItem).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('explains when the settlement is paid, without mentioning a phase', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/settles when that run is approved/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Phase 4/)).not.toBeInTheDocument();
  });

  it('stops offering changes once the exit is settled', async () => {
    getExit.mockResolvedValue(
      exitRecord({ settled_at: '2026-09-01T00:00:00.000Z', clearance_status: 'cleared' }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/Final settlement was paid/)).toBeInTheDocument());
    expect(screen.queryByText('Cleared')).not.toBeInTheDocument();
  });

  it('is read-only without employees:terminate', async () => {
    permissions = ['employees:view'];
    renderPage();
    await waitFor(() => expect(screen.getByText('Uniform returned')).toBeInTheDocument());
    expect(screen.queryByText('Withhold')).not.toBeInTheDocument();
  });
});
