import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import CustomerSearchSelect from '../../../components/CustomerSearchSelect';
import AddressAutocomplete from '../../../components/AddressAutocomplete';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { adminService } from '../../../services/api/adminService';
import { ResolvedPlace } from '../../../utils/googlePlaces';
import { formatCurrency } from '../../../utils/currency';
import { OrderTypeOption } from './types';

export type CustomerPanelProps = {
  orderType: OrderTypeOption;
  tableNumber: string;
  onTableNumberChange: (v: string) => void;
  customerName: string;
  customerPhone: string;
  onCustomerChange: (v: { name: string; phone: string }) => void;
  phoneError: string;
  onAddCustomerClick: (query?: string) => void;
  loyaltyBalance: { balance: number; displayName: string } | null | undefined;
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;
  /** Google place backing the address, or null while none is picked. */
  deliveryPlace: ResolvedPlace | null;
  onDeliveryPlaceChange: (place: ResolvedPlace) => void;
  onDeliveryPlacesUnavailable: () => void;
  loyaltyPointsToRedeem: number | '';
  onLoyaltyPointsToRedeemChange: (v: number | '') => void;
  discountCode: string;
  onDiscountCodeChange: (v: string) => void;
  orderNotes: string;
  onOrderNotesChange: (v: string) => void;
  quote: {
    loyalty_discount?: number;
    coupon_discount_amount?: number;
    discount_code?: string | null;
    discount_amount?: number;
  } | null | undefined;
};

const CustomerPanel: React.FC<CustomerPanelProps> = ({
  orderType,
  tableNumber,
  onTableNumberChange,
  customerName,
  customerPhone,
  onCustomerChange,
  phoneError,
  onAddCustomerClick,
  loyaltyBalance,
  deliveryAddress,
  onDeliveryAddressChange,
  deliveryPlace,
  onDeliveryPlaceChange,
  onDeliveryPlacesUnavailable,
  loyaltyPointsToRedeem,
  onLoyaltyPointsToRedeemChange,
  discountCode,
  onDiscountCodeChange,
  orderNotes,
  onOrderNotesChange,
  quote,
}) => {
  const effectiveOrderType = orderType;
  // Dine-in: customer is fully optional. Takeaway & delivery: customer required.
  const customerRequired =
    effectiveOrderType === 'takeaway' || effectiveOrderType === 'delivery';

  const [showVouchers, setShowVouchers] = useState(false);
  const phone = customerPhone.trim();
  const { data: voucherData, isFetching: vouchersLoading } = useQuery({
    queryKey: ['pos-customer-vouchers', phone],
    queryFn: () => adminService.getCustomerVouchers(phone),
    enabled: showVouchers && phone.length > 0,
  });

  return (
    <>
      {effectiveOrderType === 'dine_in' && (
        <div>
          <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
            Table number <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            data-keyboard="numeric"
            required
            value={tableNumber}
            onChange={(e) => onTableNumberChange(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 5"
            className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
          Customer{' '}
          {customerRequired ? (
            <span className="text-red-500">*</span>
          ) : (
            <span className="font-normal text-foodies-textSecondary">(optional)</span>
          )}
        </label>
        <CustomerSearchSelect
          value={{ name: customerName, phone: customerPhone }}
          onChange={({ name, phone }) => onCustomerChange({ name, phone })}
          onAddClick={onAddCustomerClick}
          placeholder="Search by name or phone..."
        />
        {phoneError && <p className="mt-1 text-sm text-red-600">{phoneError}</p>}
        {loyaltyBalance != null && (
          <p className="mt-1 text-sm text-green-700">
            {loyaltyBalance.displayName ?? 'Points'} balance: <strong>{loyaltyBalance.balance}</strong>
          </p>
        )}
      </div>
      {effectiveOrderType === 'delivery' && (
        <div>
          <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">Delivery address *</label>
          <AddressAutocomplete
            value={deliveryAddress}
            onChange={onDeliveryAddressChange}
            onPick={onDeliveryPlaceChange}
            picked={deliveryPlace}
            onUnavailable={onDeliveryPlacesUnavailable}
          />
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">
          Loyalty points to redeem{loyaltyBalance != null ? ` (max ${loyaltyBalance.balance})` : ' (optional)'}
        </label>
        <input
          type="number"
          min={0}
          max={loyaltyBalance?.balance ?? undefined}
          value={loyaltyPointsToRedeem === '' ? '' : loyaltyPointsToRedeem}
          onChange={(e) => {
            const raw = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0);
            if (raw === '') {
              onLoyaltyPointsToRedeemChange('');
              return;
            }
            const maxAllowed = loyaltyBalance?.balance ?? Infinity;
            onLoyaltyPointsToRedeemChange(Math.min(raw as number, maxAllowed));
          }}
          placeholder="0"
          className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
        />
        {quote?.loyalty_discount != null && quote.loyalty_discount > 0 && (
          <p className="mt-1 text-sm text-foodies-cta font-medium">Discount: {formatCurrency(quote.loyalty_discount)}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">Discount code</label>
        <input
          type="text"
          value={discountCode}
          onChange={(e) => onDiscountCodeChange(e.target.value.toUpperCase())}
          placeholder="Optional"
          className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
        />
        {discountCode.trim() && quote && (quote.coupon_discount_amount ?? 0) === 0 && (
          <p className="mt-1 text-xs text-foodies-primary">
            Coupon not applied. Check code and branch.
          </p>
        )}
        {phone.length > 0 && (
          <button
            type="button"
            onClick={() => setShowVouchers(true)}
            className="mt-1.5 text-xs text-foodies-primary underline"
          >
            View this customer's vouchers
          </button>
        )}
      </div>

      <Modal isOpen={showVouchers} onClose={() => setShowVouchers(false)} title="Customer vouchers" size="large">
        {vouchersLoading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
        ) : !voucherData?.customer ? (
          <p className="text-sm text-gray-500 py-6 text-center">No customer found for this phone.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {voucherData.vouchers.map((v) => {
              const usable = v.status === 'active';
              const statusColor =
                v.status === 'active' ? 'bg-green-100 text-green-700'
                : v.status === 'used' || v.status === 'exhausted' ? 'bg-gray-200 text-gray-600'
                : 'bg-red-100 text-red-700';
              return (
                <div key={v.id} className={`rounded-xl border-2 border-dashed p-3 ${usable ? 'border-foodies-primary/40 bg-foodies-primary/5' : 'border-gray-200 opacity-70'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-base font-extrabold text-foodies-primary">{v.type === 'percentage' ? `${v.value}% OFF` : `Rs ${v.value} OFF`}</div>
                      <div className="text-[10px] text-gray-500 truncate">{v.title}</div>
                    </div>
                    {v.qr_token && <div className="bg-white p-1 rounded shrink-0"><QRCodeSVG value={v.qr_token} size={40} /></div>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 font-mono text-gray-600">{v.reference}</span>
                    <span className={`px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>{v.status}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{v.expires_at ? `exp ${new Date(v.expires_at).toLocaleDateString()}` : 'no expiry'}{v.uses ? ` · used ${v.uses}×` : ''}</div>
                  {usable && (
                    <Button size="small" className="mt-1.5 w-full" onClick={() => { onDiscountCodeChange(v.code ?? ''); setShowVouchers(false); }}>Apply</Button>
                  )}
                </div>
              );
            })}
            {voucherData.vouchers.length === 0 && <p className="col-span-full text-center text-sm text-gray-400 py-8">This customer has no vouchers.</p>}
          </div>
        )}
      </Modal>

      <div>
        <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">Order notes</label>
        <textarea
          value={orderNotes}
          onChange={(e) => onOrderNotesChange(e.target.value)}
          placeholder="e.g. No onions, extra napkins"
          rows={2}
          className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary resize-none"
        />
      </div>
    </>
  );
};

export default CustomerPanel;
