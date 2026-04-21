import React from 'react';
import CustomerSearchSelect from '../../../components/CustomerSearchSelect';
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
  onAddCustomerClick: () => void;
  loyaltyBalance: { balance: number; displayName: string } | null | undefined;
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;
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
  loyaltyPointsToRedeem,
  onLoyaltyPointsToRedeemChange,
  discountCode,
  onDiscountCodeChange,
  orderNotes,
  onOrderNotesChange,
  quote,
}) => {
  const effectiveOrderType = orderType;
  return (
    <>
      {effectiveOrderType === 'dine_in' && (
        <div>
          <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">Table number</label>
          <input
            type="text"
            value={tableNumber}
            onChange={(e) => onTableNumberChange(e.target.value)}
            placeholder="e.g. 5"
            className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foodies-textPrimary mb-1.5">Customer *</label>
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
          <textarea
            value={deliveryAddress}
            onChange={(e) => onDeliveryAddressChange(e.target.value)}
            placeholder="Street, area, city"
            rows={2}
            className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary resize-none"
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
      </div>

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
