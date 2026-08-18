import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const context = vi.fn();
const punch = vi.fn();
const capture = vi.fn();

vi.mock('../../services/api/stationService', () => ({
  stationService: {
    context: (...a: unknown[]) => context(...a),
    punch: (...a: unknown[]) => punch(...a),
  },
  uploadStationPhoto: vi.fn(),
}));

vi.mock('./usePunchCamera', () => ({
  usePunchCamera: () => ({
    videoRef: () => undefined,
    status: 'ready',
    ready: true,
    error: null,
    capture: (...a: unknown[]) => capture(...a),
  }),
}));

import AttendanceStation from './AttendanceStation';

const renderStation = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AttendanceStation />
    </QueryClientProvider>,
  );
};

const punchResult = {
  duplicate: false,
  punch_id: 1,
  employee: { id: 7, full_name: 'Bilal Ahmed', employee_code: 'EMP-0007', photo_url: null },
  punch_type: 'in',
  punched_at: '2026-08-18T06:00:00.000Z',
  orphan: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('attendance_station_token', 'tok-123');
  context.mockResolvedValue({
    branch: { id: 10, name: 'Pine Avenue' },
    station: { id: 1, label: 'Asad Laptop' },
    policy: { primary_method: 'qr_card', require_photo: true, allow_manager_attestation: true },
  });
  punch.mockResolvedValue(punchResult);
});

describe('Attendance station photos', () => {
  it('sends the captured photo URL with the punch', async () => {
    capture.mockResolvedValue({ url: 'https://cdn/x.jpg', reason: null });
    renderStation();

    await waitFor(() => expect(screen.getByLabelText('Scan your card')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Scan your card'), {
      target: { value: 'card-token-12345678' },
    });
    fireEvent.click(screen.getByText('Clock in'));

    await waitFor(() => expect(punch).toHaveBeenCalled());
    expect(punch.mock.calls[0][1].photo_url).toBe('https://cdn/x.jpg');
    await waitFor(() => expect(screen.getByText('Photo saved')).toBeInTheDocument());
  });

  it('says WHY no photo was saved instead of failing silently', async () => {
    // The bug this guards: photos stopped arriving and the screen said nothing,
    // so nobody could tell whether the camera, the upload or the server failed.
    capture.mockResolvedValue({ url: null, reason: 'camera produced no frame' });
    renderStation();

    await waitFor(() => expect(screen.getByLabelText('Scan your card')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Scan your card'), {
      target: { value: 'card-token-12345678' },
    });
    fireEvent.click(screen.getByText('Clock in'));

    await waitFor(() =>
      expect(screen.getByText('No photo — camera produced no frame')).toBeInTheDocument(),
    );
    // The punch itself still went through: refusing it would be the worse
    // outcome.
    expect(punch).toHaveBeenCalled();
    expect(punch.mock.calls[0][1].photo_url).toBeUndefined();
  });

  it('takes no photo when clocking OUT', async () => {
    renderStation();
    await waitFor(() => expect(screen.getByLabelText('Scan your card')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Scan your card'), {
      target: { value: 'card-token-12345678' },
    });
    fireEvent.click(screen.getByText('Clock out'));

    await waitFor(() => expect(punch).toHaveBeenCalled());
    expect(capture).not.toHaveBeenCalled();
  });
});
