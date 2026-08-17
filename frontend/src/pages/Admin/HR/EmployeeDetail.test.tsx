import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getEmployee = vi.fn();
const getExit = vi.fn();
const listDesignations = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    getEmployee: (...a: unknown[]) => getEmployee(...a),
    getExit: (...a: unknown[]) => getExit(...a),
    listDesignations: (...a: unknown[]) => listDesignations(...a),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions: ['employees:view'] } }),
}));

import EmployeeDetail from './EmployeeDetail';

/** Payload as the server sends it to someone WITHOUT salary:view — the bank
 *  keys are absent entirely, not null. */
const baseEmployee = (over: Record<string, unknown> = {}) => ({
  id: 7,
  employee_code: 'EMP-0007',
  full_name: 'Bilal Ahmed',
  father_name: 'Ahmed Raza',
  cnic: '35202-1234567-1',
  date_of_birth: null,
  gender: null,
  phone: '03001234567',
  address: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  photo_url: null,
  user_id: null,
  has_login: false,
  employment_type: 'full_time',
  date_of_joining: '2026-01-05',
  probation_end_date: null,
  confirmation_date: null,
  status: 'active',
  date_of_leaving: null,
  leaving_reason: null,
  rehire_eligible: null,
  has_pin: false,
  current_assignment: {
    id: 1,
    branch: { id: 10, name: 'Pine Avenue' },
    brand: null,
    designation: { id: 3, name: 'Cook', level: 30, department: 'kitchen' },
    employment_type: 'full_time',
    effective_from: '2026-01-05',
    effective_to: null,
    is_current: true,
    change_reason: 'hire',
    note: null,
    created_by: null,
  },
  assignments: [],
  timeline: [],
  documents: [],
  warnings: [],
  ...over,
});

const renderDetail = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/hr/employees/7']}>
        <Routes>
          <Route path="/admin/hr/employees/:id" element={<EmployeeDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  getExit.mockResolvedValue(null);
  listDesignations.mockResolvedValue([]);
});

describe('EmployeeDetail salary gating', () => {
  /**
   * The security-relevant case. The server omits the bank keys for callers
   * without salary:view, so nothing sensitive must reach the DOM — checking the
   * rendered output rather than a flag is the point, since a flag can be right
   * while the render still leaks.
   */
  it('does not render bank details when the payload omits them', async () => {
    getEmployee.mockResolvedValue(baseEmployee());
    renderDetail();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());

    expect(screen.queryByText('Meezan Bank')).not.toBeInTheDocument();
    expect(screen.queryByText(/PK\d{2}/)).not.toBeInTheDocument();
    expect(screen.getByText(/salary:view/)).toBeInTheDocument();
  });

  it('renders bank details when the payload includes them', async () => {
    getEmployee.mockResolvedValue(
      baseEmployee({
        bank_name: 'Meezan Bank',
        account_title: 'Bilal Ahmed',
        account_number_iban: 'PK36MEZN0001234567890123',
        payment_method: 'bank_transfer',
      }),
    );
    renderDetail();

    await waitFor(() => expect(screen.getByText('Meezan Bank')).toBeInTheDocument());
    expect(screen.getByText('PK36MEZN0001234567890123')).toBeInTheDocument();
    expect(screen.queryByText(/salary:view/)).not.toBeInTheDocument();
  });

  /**
   * An employee allowed to be seen but with no bank details entered must NOT
   * look like a permission problem. This is why the check is key presence, not
   * truthiness — a null bank_name still means "you may look".
   */
  it('shows the payment section, not the permission notice, when fields are present but null', async () => {
    getEmployee.mockResolvedValue(
      baseEmployee({
        bank_name: null,
        account_title: null,
        account_number_iban: null,
        payment_method: 'cash',
      }),
    );
    renderDetail();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.queryByText(/salary:view/)).not.toBeInTheDocument();
    expect(screen.getByText('Payment details')).toBeInTheDocument();
  });
});

describe('EmployeeDetail actions', () => {
  it('hides promote and exit buttons without the permissions', async () => {
    getEmployee.mockResolvedValue(baseEmployee());
    renderDetail();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.queryByText('Promote / transfer')).not.toBeInTheDocument();
    expect(screen.queryByText('Record exit')).not.toBeInTheDocument();
  });

  it('labels a brandless assignment as shared rather than blank', async () => {
    getEmployee.mockResolvedValue(baseEmployee());
    renderDetail();

    await waitFor(() => expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument());
    expect(screen.getByText(/Shared \(no brand\)/)).toBeInTheDocument();
  });
});
