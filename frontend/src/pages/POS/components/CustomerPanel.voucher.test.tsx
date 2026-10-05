import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useHasPermission', () => ({
  useHasPermission: () => false,
  useHasRestriction: () => false,
}));
vi.mock('../../../utils/apiClient', () => ({ default: { get: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('../../../components/AddressAutocomplete', () => ({ default: () => <div /> }));
vi.mock('../../../components/CustomerSearchSelect', () => ({ default: () => <div /> }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg /> }));

import CustomerPanel from './CustomerPanel';

const VOUCHERS = [
  { id: 1, name: 'Any Large Pizza', voucher_type: 'fixed_price' as const, value: 999 },
  { id: 2, name: '30% off', voucher_type: 'percentage' as const, value: 30 },
];
const STAFF = [{ id: 7, name: '10% off', discount_type: 'percentage' as const, value: 10, max_discount_amount: null }];
const OFFERS = [{ id: 9, name: 'BOGO', type: 'buy_x_get_y', value: 0, buy_quantity: 1, get_quantity: 1, get_discount_percent: 100 }];

const renderPanel = (props: Record<string, unknown> = {}) => {
  const onVoucherChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CustomerPanel
        orderType={'dine_in' as never}
        tableNumber="4"
        onTableNumberChange={() => {}}
        customerName=""
        customerPhone=""
        onCustomerChange={() => {}}
        phoneError=""
        onAddCustomerClick={() => {}}
        loyaltyBalance={null}
        deliveryAddress=""
        onDeliveryAddressChange={() => {}}
        deliveryPlace={null}
        onDeliveryPlaceChange={() => {}}
        onDeliveryPlacesUnavailable={() => {}}
        loyaltyPointsToRedeem=""
        onLoyaltyPointsToRedeemChange={() => {}}
        discountCode=""
        onDiscountCodeChange={() => {}}
        staffDiscounts={STAFF}
        staffDiscountId={null}
        onStaffDiscountChange={() => {}}
        manualOffers={OFFERS}
        manualOfferId={null}
        onManualOfferChange={() => {}}
        vouchers={VOUCHERS}
        voucherId={null}
        onVoucherChange={onVoucherChange}
        orderNotes=""
        onOrderNotesChange={() => {}}
        quote={undefined as never}
        {...(props as never)}
      />
    </QueryClientProvider>,
  );
  return { onVoucherChange };
};

describe('printed vouchers on the checkout', () => {
  it('offers the vouchers and leaves the other discounts usable until one is picked', () => {
    const { onVoucherChange } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Any Large Pizza — Rs 999' }));
    expect(onVoucherChange).toHaveBeenCalledWith(1);
    expect((screen.getByPlaceholderText('Optional') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '10%' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'BOGO' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('locks every other discount while a voucher is applied', () => {
    renderPanel({
      voucherId: 1,
      quote: { voucher_applied: true, voucher_discount_amount: 950 },
    });
    // Discount code, loyalty points, the till offer and the staff discount.
    expect((screen.getByPlaceholderText('Not available with a voucher') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText('0') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '10%' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'BOGO' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/still earns points/)).toBeTruthy();
    expect(screen.getByText(/Any Large Pizza: −Rs\. 950\.00/)).toBeTruthy();
  });

  it('shows why a picked voucher is not applied', () => {
    renderPanel({
      voucherId: 1,
      quote: {
        voucher_applied: false,
        voucher_discount_amount: 0,
        voucher_error: 'Any Large Pizza: Nothing in this cart qualifies for this voucher.',
      },
    });
    expect(screen.getByRole('alert').textContent).toContain('Nothing in this cart qualifies');
  });

  it('shows no voucher control when none can be used on this order', () => {
    renderPanel({ vouchers: [] });
    expect(screen.queryByText(/Printed voucher/)).toBeNull();
  });
});
