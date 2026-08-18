import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listStations = vi.fn();

vi.mock('../../../services/api/hrService', () => ({
  hrService: {
    listStations: (...a: unknown[]) => listStations(...a),
    registerStation: vi.fn(),
    revokeStation: vi.fn(),
    listRegister: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../utils/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [{ id: 10, name: 'Pine Avenue' }] }) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let permissions: string[] = [];
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));

import AttendanceDevices from './AttendanceDevices';
import AttendanceRegister from './AttendanceRegister';

const renderWith = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['attendance:view', 'attendance-stations:manage'];
  listStations.mockResolvedValue([
    {
      id: 1,
      label: 'Asad Laptop',
      token: 'tok-123',
      isActive: true,
      lastSeenAt: null,
      branchId: 10,
      branch: { name: 'Pine Avenue' },
    },
  ]);
});

describe('Attendance devices, split out of the register', () => {
  it('manages devices on its own screen', async () => {
    renderWith(<AttendanceDevices />);
    expect(screen.getByText('Attendance devices')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Asad Laptop')).toBeInTheDocument());
    // And offers the way back plus the station itself.
    expect(screen.getByText('Attendance register')).toBeInTheDocument();
    expect(screen.getByText('Open attendance station')).toBeInTheDocument();
  });

  it('keeps the register free of device setup', async () => {
    renderWith(<AttendanceRegister />);
    await waitFor(() =>
      expect(screen.getByText('Attendance register')).toBeInTheDocument(),
    );
    // The registration form no longer sits above the day's data.
    expect(screen.queryByText('Register device')).not.toBeInTheDocument();
    expect(screen.queryByText('Asad Laptop')).not.toBeInTheDocument();
    // But it still says where the tablets are set up.
    expect(
      screen.getByRole('link', { name: 'Attendance devices' }).getAttribute('href'),
    ).toBe('/admin/hr/attendance/devices');
  });
});
