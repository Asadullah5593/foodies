import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/api/hrService', () => ({
  hrService: { updateEmployee: vi.fn().mockResolvedValue({}) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import EmployeeEditModal from './EmployeeEditModal';

const employee = {
  id: 16,
  employee_code: 'EMP-0016',
  full_name: 'asad ullah',
  father_name: '',
  cnic: '',
  date_of_birth: null,
  gender: null,
  phone: '',
  address: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  photo_url: null,
  user_id: null,
  has_login: false,
  employment_type: 'full_time',
  date_of_joining: '2026-08-01',
  probation_end_date: null,
  confirmation_date: null,
  status: 'active',
  date_of_leaving: null,
  leaving_reason: null,
  rehire_eligible: null,
  has_pin: false,
  qr_token: null,
  qr_token_issued_at: null,
  bank_name: null,
  account_title: null,
  account_number_iban: null,
  payment_method: 'cash',
  current_assignment: null,
  assignments: [],
  timeline: [],
  documents: [],
  warnings: [],
} as never;

const renderModal = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeEditModal employee={employee} onClose={() => undefined} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['employees:edit', 'salary:view', 'salary:edit'];
});

describe('Employee edit form', () => {
  it('keeps focus while typing a whole word', () => {
    // The bug: the field component was defined inside the modal, so every
    // keystroke produced a new component type and React remounted the input —
    // focus was lost after one character, and a date picker closed on month
    // change.
    renderModal();
    const father = screen.getByLabelText("Father's name") as HTMLInputElement;
    father.focus();

    for (const ch of 'khalid') {
      fireEvent.change(father, { target: { value: father.value + ch } });
      expect(document.activeElement).toBe(screen.getByLabelText("Father's name"));
    }
    expect((screen.getByLabelText("Father's name") as HTMLInputElement).value).toBe(
      'khalid',
    );
  });

  it('keeps the same input element across renders', () => {
    renderModal();
    const before = screen.getByLabelText('Bank');
    fireEvent.change(before, { target: { value: 'hbl' } });
    // Same DOM node, not a replacement — this is what focus depends on.
    expect(screen.getByLabelText('Bank')).toBe(before);
  });

  it('accepts digits only in the phone fields', () => {
    renderModal();
    const phone = screen.getByLabelText('Emergency phone') as HTMLInputElement;
    fireEvent.change(phone, { target: { value: '+92 300-123 4567' } });
    expect(phone.value).toBe('923001234567');
    expect(phone.getAttribute('inputmode')).toBe('numeric');
  });

  it('leaves the emergency contact NAME as text', () => {
    renderModal();
    const name = screen.getByLabelText('Emergency contact name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Bilal' } });
    expect(name.value).toBe('Bilal');
  });
});
