import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import Modal from './Modal';
import Button from './Button';
import { formatCurrency } from '../utils/currency';

export type SettleMethod = 'cash' | 'card' | 'online_transfer';

const METHOD_LABELS: Record<SettleMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  online_transfer: 'Online transfer',
};

/** Body of the 409 the server answers when an unpaid till order is completed. */
export interface PaymentRequired {
  code: 'PAYMENT_REQUIRED';
  message: string;
  order_id: number;
  order_number: string | null;
  total_amount: number;
  outstanding: number;
  tax_basis: string | null;
  /** Only tenders matching the GST the order was taxed at. */
  payment_methods: SettleMethod[];
}

/** The PAYMENT_REQUIRED refusal inside an API error; null for any other error. */
export function paymentRequiredFrom(error: unknown): PaymentRequired | null {
  const res = (error as { response?: { status?: number; data?: Partial<PaymentRequired> } })?.response;
  if (res?.status !== 409 || res.data?.code !== 'PAYMENT_REQUIRED') return null;
  return res.data as PaymentRequired;
}

interface PaymentRequiredModalProps {
  /** Open while set. */
  payment: PaymentRequired | null;
  /** More unpaid orders waiting behind this one (bulk complete). */
  remaining?: number;
  onClose: () => void;
  /** Complete the order, settling it by `method`. */
  onSettle: (method: SettleMethod) => Promise<unknown>;
}

/**
 * Asked when someone completes a till order whose payment never landed: the
 * order cannot complete until the money is recorded, so this takes the method
 * and completes it with that tender in one request — the server records the
 * outstanding balance through the same payment flow checkout uses.
 */
const PaymentRequiredModal: React.FC<PaymentRequiredModalProps> = ({
  payment,
  remaining = 0,
  onClose,
  onSettle,
}) => {
  const [method, setMethod] = useState<SettleMethod | ''>('');
  const [saving, setSaving] = useState(false);

  // A fresh order resets the choice; a single allowed method is preselected.
  useEffect(() => {
    const methods = payment?.payment_methods ?? [];
    setMethod(methods.length === 1 ? methods[0] : '');
  }, [payment?.order_id, payment?.payment_methods]);

  const save = async () => {
    if (!payment || !method) return;
    setSaving(true);
    try {
      await onSettle(method);
      toast.success(`Order #${payment.order_number ?? payment.order_id} paid by ${METHOD_LABELS[method].toLowerCase()} and completed`);
    } catch (error) {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save the payment');
    } finally {
      setSaving(false);
    }
  };

  const label = payment ? `#${payment.order_number ?? payment.order_id}` : '';
  return (
    <Modal isOpen={payment != null} onClose={saving ? () => undefined : onClose} title="Payment missing" size="small" elevated>
      {payment && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Order <span className="font-semibold">{label}</span> is missing payment of{' '}
            <span className="font-semibold">{formatCurrency(payment.outstanding)}</span>. Select a payment method before
            marking this order as completed.
          </p>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Payment method</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as SettleMethod | '')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              aria-label="Payment method"
            >
              <option value="" disabled>
                Select payment method
              </option>
              {payment.payment_methods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </label>
          {payment.payment_methods.length < 3 && (
            <p className="text-xs text-gray-500">
              Only methods matching the tax this order was billed at are shown.
            </p>
          )}
          {remaining > 0 && (
            <p className="text-xs text-amber-700">
              {remaining} more unpaid {remaining === 1 ? 'order' : 'orders'} after this one.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {remaining > 0 ? 'Skip' : 'Cancel'}
            </Button>
            <Button variant="primary" onClick={save} disabled={!method || saving} isLoading={saving}>
              Save &amp; complete
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

/**
 * Wires the modal into a page's existing "complete order" action. Hand
 * `ask` the error from a completion; it returns true (and queues the modal)
 * when the order only needs its payment, so the caller skips its own toast.
 * Unpaid orders from a bulk complete queue up and are asked for one by one.
 */
export function usePaymentRequiredPrompt(opts: {
  /** The page's own completion call, now carrying the settling tender. */
  complete: (orderId: number, method: SettleMethod) => Promise<unknown>;
  /** Refresh the page's data once an order is settled and completed. */
  onCompleted?: (orderId: number) => void;
}) {
  const [queue, setQueue] = useState<PaymentRequired[]>([]);
  const { complete, onCompleted } = opts;

  const ask = useCallback((error: unknown): boolean => {
    const payment = paymentRequiredFrom(error);
    if (!payment) return false;
    setQueue((q) => (q.some((p) => p.order_id === payment.order_id) ? q : [...q, payment]));
    return true;
  }, []);

  const current = queue[0] ?? null;
  const next = () => setQueue((q) => q.slice(1));
  const modal = (
    <PaymentRequiredModal
      payment={current}
      remaining={Math.max(queue.length - 1, 0)}
      onClose={next}
      onSettle={async (method) => {
        if (!current) return;
        await complete(current.order_id, method);
        onCompleted?.(current.order_id);
        next();
      }}
    />
  );
  return { ask, modal };
}

export default PaymentRequiredModal;
