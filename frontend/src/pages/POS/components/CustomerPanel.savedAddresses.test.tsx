import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const permissions: string[] = [];
vi.mock('../../../hooks/useHasPermission', () => ({
  useHasPermission: (p?: string) => (p ? permissions.includes(p) : true),
  useHasRestriction: () => false,
}));

const get = vi.fn();
vi.mock('../../../utils/apiClient', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock('../../../components/AddressAutocomplete', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Delivery address" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('../../../components/CustomerSearchSelect', () => ({ default: () => <div /> }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg /> }));

import CustomerPanel from './CustomerPanel';

const SAVED = {
  id: 7,
  label: null,
  address: 'House 5, Street 2, DHA Phase 5',
  latitude: 31.47,
  longitude: 74.39,
  notes: null,
  times_used: 3,
  last_used_at: new Date().toISOString(),
};

const renderPanel = (props: Record<string, unknown> = {}) => {
  const onDeliveryAddressChange = vi.fn();
  const onDeliveryPlaceChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CustomerPanel
        orderType={'delivery' as never}
        tableNumber=""
        onTableNumberChange={() => {}}
        customerName="Ali"
        customerPhone="03001112233"
        onCustomerChange={() => {}}
        phoneError=""
        onAddCustomerClick={() => {}}
        loyaltyBalance={null}
        deliveryAddress=""
        onDeliveryAddressChange={onDeliveryAddressChange}
        deliveryPlace={null}
        onDeliveryPlaceChange={onDeliveryPlaceChange}
        onDeliveryPlacesUnavailable={() => {}}
        loyaltyPointsToRedeem=""
        onLoyaltyPointsToRedeemChange={() => {}}
        discountCode=""
        onDiscountCodeChange={() => {}}
        staffDiscounts={[]}
        staffDiscountId={null}
        onStaffDiscountChange={() => {}}
        manualOffers={[]}
        manualOfferId={null}
        onManualOfferChange={() => {}}
        orderNotes=""
        onOrderNotesChange={() => {}}
        quote={undefined as never}
        {...(props as never)}
      />
    </QueryClientProvider>,
  );
  return { onDeliveryAddressChange, onDeliveryPlaceChange };
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions.length = 0;
  get.mockResolvedValue({ data: { addresses: [SAVED] } });
});

describe('saved delivery addresses at the till', () => {
  it('asks for nothing without the permission — the till never sees the customer’s history', async () => {
    renderPanel();
    await new Promise((r) => setTimeout(r, 50));
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delivered here before/)).toBeNull();
  });

  it('looks up the number and offers what it finds, with the permission', async () => {
    permissions.push('orders:customer-addresses:view');
    renderPanel();
    expect(await screen.findByText(/Delivered here before \(1\)/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/pos/customers/addresses', {
      params: { phone: '03001112233' },
    });
  });

  it('picking one restores the ADDRESS AND ITS COORDINATES', async () => {
    permissions.push('orders:customer-addresses:view');
    const { onDeliveryAddressChange, onDeliveryPlaceChange } = renderPanel();
    fireEvent.click(await screen.findByText(/House 5, Street 2/));
    expect(onDeliveryAddressChange).toHaveBeenCalledWith('House 5, Street 2, DHA Phase 5');
    // Without this the order is refused, or priced from the wrong distance.
    expect(onDeliveryPlaceChange).toHaveBeenCalledWith({
      placeId: 'saved:7',
      address: 'House 5, Street 2, DHA Phase 5',
      latitude: 31.47,
      longitude: 74.39,
    });
  });

  it('does not look up a partial number', async () => {
    permissions.push('orders:customer-addresses:view');
    renderPanel({ customerPhone: '0300111' });
    await new Promise((r) => setTimeout(r, 50));
    expect(get).not.toHaveBeenCalled();
  });

  it('does not look anything up for a non-delivery order', async () => {
    permissions.push('orders:customer-addresses:view');
    renderPanel({ orderType: 'takeaway' });
    await new Promise((r) => setTimeout(r, 50));
    expect(get).not.toHaveBeenCalled();
  });

  it('typing over a picked address drops the selection, so the pin cannot outlive the words', async () => {
    permissions.push('orders:customer-addresses:view');
    renderPanel();
    fireEvent.click(await screen.findByText(/House 5, Street 2/));
    await waitFor(() =>
      expect(
        screen.getByText(/House 5, Street 2/).closest('button')!.getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    fireEvent.change(screen.getByLabelText('Delivery address'), {
      target: { value: 'somewhere else entirely' },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/House 5, Street 2/).closest('button')!.getAttribute('aria-pressed'),
      ).toBe('false'),
    );
  });
});
