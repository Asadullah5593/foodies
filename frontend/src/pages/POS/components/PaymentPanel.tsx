import React from 'react';
import { motion } from 'framer-motion';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';

export type PaymentPanelProps = {
  subtotal: number;
  quote: {
    subtotal?: number;
    total_amount?: number;
    auto_discount_amount?: number;
    coupon_discount_amount?: number;
    loyalty_discount?: number;
    discount_amount?: number;
    discount_code?: string | null;
    tax_amount?: number;
    delivery_fee?: number;
  } | null | undefined;
  paymentMode: 'cash' | 'card' | 'multipay';
  onPaymentModeChange: (mode: 'cash' | 'card' | 'multipay') => void;
  paymentCashAmount: string;
  paymentCardAmount: string;
  onPaymentCashAmountChange: (v: string) => void;
  onPaymentCardAmountChange: (v: string) => void;
  onCreateOrder: () => void;
  isSubmitting: boolean;
  itemCount: number;
  lastOrderGroupId: string | null;
  onViewInvoice: () => void;
};

const PaymentPanel: React.FC<PaymentPanelProps> = ({
  subtotal,
  quote,
  paymentMode,
  onPaymentModeChange,
  paymentCashAmount,
  paymentCardAmount,
  onPaymentCashAmountChange,
  onPaymentCardAmountChange,
  onCreateOrder,
  isSubmitting,
  itemCount,
  lastOrderGroupId,
  onViewInvoice,
}) => {
  const total = quote?.total_amount ?? subtotal;
  const taxAmount = Number(quote?.tax_amount ?? 0);
  const deliveryFee = Number(quote?.delivery_fee ?? 0);
  return (
    <div className="mt-auto rounded-2xl border border-foodies-border dark:border-slate-600 bg-foodies-surface dark:bg-slate-800 p-5 shadow-lg">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-foodies-textSecondary dark:text-slate-400">
          <span>Subtotal</span>
          <span>{formatCurrency(quote?.subtotal ?? subtotal)}</span>
        </div>
        {(quote?.auto_discount_amount ?? 0) > 0 && (
          <div className="flex justify-between text-foodies-cta">
            <span>Discount (auto)</span>
            <span>-{formatCurrency(quote!.auto_discount_amount!)}</span>
          </div>
        )}
        {(quote?.coupon_discount_amount ?? 0) > 0 && (
          <div className="flex justify-between text-foodies-cta">
            <span>Coupon{quote?.discount_code ? ` (${quote.discount_code})` : ''}</span>
            <span>-{formatCurrency(quote!.coupon_discount_amount!)}</span>
          </div>
        )}
        {(quote?.loyalty_discount ?? 0) > 0 && (
          <div className="flex justify-between text-foodies-cta">
            <span>Loyalty</span>
            <span>-{formatCurrency(quote!.loyalty_discount!)}</span>
          </div>
        )}
        {((quote?.auto_discount_amount ?? 0) > 0 || (quote?.coupon_discount_amount ?? 0) > 0 || (quote?.loyalty_discount ?? 0) > 0) ? null : (
          <div className={`flex justify-between ${(quote?.discount_amount ?? 0) > 0 ? 'text-foodies-cta' : 'text-foodies-textSecondary'}`}>
            <span>Discount</span>
            <span>{(quote?.discount_amount ?? 0) > 0 ? `-${formatCurrency(quote?.discount_amount ?? 0)}` : formatCurrency(0)}</span>
          </div>
        )}
        {(taxAmount > 0 || deliveryFee > 0) && (
          <>
            {taxAmount > 0 && (
              <div className="flex justify-between text-foodies-textSecondary dark:text-slate-400">
                <span>Tax</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-foodies-textSecondary dark:text-slate-400">
                <span>Delivery fee</span>
                <span>{formatCurrency(deliveryFee)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between font-bold pt-3 mt-2 border-t-2 border-foodies-border dark:border-slate-600 text-foodies-textPrimary dark:text-slate-100 text-base">
          <span>Total</span>
          <span className="text-foodies-cta dark:text-red-400">{formatCurrency(total)}</span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-foodies-border dark:border-slate-600">
        <label className="block text-sm font-medium text-foodies-textPrimary dark:text-slate-200 mb-2">Payment *</label>
        <div className="flex flex-wrap gap-2">
          {(['cash', 'card', 'multipay'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onPaymentModeChange(mode)}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors ${
                paymentMode === mode
                  ? 'border-foodies-primary bg-red-50 dark:bg-red-900/40 text-red-800 dark:text-red-200'
                  : 'border-foodies-border dark:border-slate-600 bg-foodies-surfaceMuted dark:bg-slate-700 text-foodies-textPrimary dark:text-slate-200 hover:border-foodies-primary hover:bg-red-50/50 dark:hover:bg-red-900/30'
              }`}
            >
              {mode === 'cash' ? 'Cash' : mode === 'card' ? 'Card' : 'Cash + Card'}
            </button>
          ))}
        </div>
        {paymentMode === 'multipay' && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <label className="block text-xs font-medium text-foodies-textSecondary dark:text-slate-400 mb-1">Cash amount</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={paymentCashAmount}
                onChange={(e) => onPaymentCashAmountChange(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-foodies-border dark:border-slate-600 rounded-xl bg-foodies-surface dark:bg-slate-800 text-foodies-textPrimary dark:text-slate-100 text-sm focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foodies-textSecondary dark:text-slate-400 mb-1">Card amount</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={paymentCardAmount}
                onChange={(e) => onPaymentCardAmountChange(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-foodies-border dark:border-slate-600 rounded-xl bg-foodies-surface dark:bg-slate-800 text-foodies-textPrimary dark:text-slate-100 text-sm focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
              />
            </div>
            <p className="col-span-2 text-xs text-foodies-textSecondary dark:text-slate-400">
              Sum must equal {formatCurrency(total)}
            </p>
          </div>
        )}
      </div>

      <motion.div whileTap={{ scale: isSubmitting || itemCount === 0 ? 1 : 0.98 }} whileHover={{ scale: isSubmitting || itemCount === 0 ? 1 : 1.01 }} transition={{ type: 'tween', duration: 0.15 }}>
        <Button
          variant="gradient"
          onClick={onCreateOrder}
          disabled={isSubmitting || itemCount === 0}
          isLoading={isSubmitting}
          className="w-full mt-4 font-semibold py-3 rounded-xl"
          size="large"
        >
          Create Order
        </Button>
      </motion.div>
      {lastOrderGroupId && (
        <Button
          variant="view"
          className="w-full mt-2 rounded-xl"
          onClick={onViewInvoice}
        >
          View customer invoice
        </Button>
      )}
    </div>
  );
};

export default PaymentPanel;
