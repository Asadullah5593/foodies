import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RiderLayout from './RiderLayout';

/**
 * The rider's header. On desktop the live-location badge sits at the right of the bar; below that
 * width it used to disappear, so riders never saw whether dispatch could see them. It now sits on
 * its own line under the bar.
 */

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 24, name: 'rider ahmad' }, logout: vi.fn() }),
}));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('./RiderDutyBar', () => ({ default: () => <div data-testid="duty-bar" /> }));

let attendance: Record<string, unknown> = {};
const heartbeat = vi.fn();
vi.mock('../../services/api/riderService', () => ({
  riderService: {
    getAttendanceStatus: () => Promise.resolve(attendance),
    sendAttendanceHeartbeat: (p: unknown) => heartbeat(p),
  },
}));

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const renderLayout = (url = '/rider') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/rider" element={<RiderLayout />}>
            <Route index element={<div data-testid="page">deliveries</div>} />
            <Route path="orders/:id" element={<div data-testid="page">order</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const withGps = () =>
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (ok: PositionCallback) => {
        ok({ coords: { latitude: 31.44073, longitude: 74.26748 } } as GeolocationPosition);
        return 1;
      },
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  attendance = { is_checked_in: true, branch_name: 'Emporium', last_latitude: 31.44073, last_longitude: 74.26748 };
  heartbeat.mockImplementation(() => Promise.resolve(attendance));
  withGps();
});
afterEach(() => {
  setWidth(1024);
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('Rider header', () => {
  it('shows the live-location status under the bar on a phone', async () => {
    setWidth(390);
    renderLayout();
    const row = await screen.findByTestId('rider-location-row');
    await waitFor(() => expect(row).toHaveTextContent('Live location sharing'));
    expect(row).toHaveTextContent('Emporium · 31.44073, 74.26748');
  });

  it('says so when the rider has not checked in', async () => {
    setWidth(390);
    attendance = { is_checked_in: false };
    renderLayout();
    const row = await screen.findByTestId('rider-location-row');
    expect(row).toHaveTextContent('Not checked in');
    expect(row).toHaveTextContent('Check in first to publish live rider location');
  });

  it('shows the same status on a tablet, and the problem when location is blocked', async () => {
    setWidth(768);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => {
          fail({ code: 1, PERMISSION_DENIED: 1, message: 'denied' } as GeolocationPositionError);
          return 1;
        },
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
      },
    });
    renderLayout();
    const row = await screen.findByTestId('rider-location-row');
    await waitFor(() => expect(row).toHaveTextContent('Location unavailable'));
  });

  it('leaves the desktop header exactly as it was: its own badge, no extra row', async () => {
    setWidth(1440);
    renderLayout();
    await screen.findByText('deliveries');
    expect(screen.queryByTestId('rider-location-row')).toBeNull();
    await waitFor(() => expect(screen.getByText('Live location sharing')).toBeInTheDocument());
  });

  const dutyIsBeforePage = () => {
    const duty = screen.getByTestId('duty-bar');
    const page = screen.getByTestId('page');
    return !!(duty.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  it('keeps the shift card above the deliveries list on a phone', async () => {
    setWidth(390);
    renderLayout('/rider');
    await screen.findByText('deliveries');
    expect(dutyIsBeforePage()).toBe(true);
  });

  it('puts the order first and the shift card after it on a phone order page', async () => {
    setWidth(390);
    renderLayout('/rider/orders/7');
    await screen.findByText('order');
    expect(dutyIsBeforePage()).toBe(false);
  });

  it('keeps the shift card on top of the order page on a tablet and on desktop', async () => {
    setWidth(768);
    const { unmount } = renderLayout('/rider/orders/7');
    await screen.findByText('order');
    expect(dutyIsBeforePage()).toBe(true);
    unmount();
    setWidth(1440);
    renderLayout('/rider/orders/7');
    await screen.findByText('order');
    expect(dutyIsBeforePage()).toBe(true);
  });
});
