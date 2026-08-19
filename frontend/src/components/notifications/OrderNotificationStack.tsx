import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  MdNotificationsActive,
  MdVolumeUp,
  MdVolumeOff,
} from 'react-icons/md';
import {
  useNotificationsStore,
  type ClientNotification,
  type NotificationAction,
} from '../../stores/notificationsStore';
import { notificationsService } from '../../services/api/notificationsService';
import { useHasRestriction } from '../../hooks/useHasPermission';
import { NO_CANCEL_PERMISSION } from '../../lib/orderStatusPermissions';

/**
 * Persistent, stacked, actionable order notifications. Mounted globally (in
 * NotificationsProvider) so a targeted user sees incoming orders on ANY screen,
 * not just the POS. Cards stay until accepted/rejected; new ones stack on top.
 * Accept/Reject reuse the admin order-status endpoint and then resolve the
 * notification (clearing it for every recipient). A mute toggle silences the
 * repeating chime.
 */
const OrderNotificationStack: React.FC = () => {
  // This stack floats over every screen, so its Reject button is a cancel
  // surface like any other: "Reject and cancel this order?" sets status
  // 'cancelled' through the same admin route. A no-cancel account must not be
  // offered it here either — the server would refuse, and a button that only
  // ever 403s is worse than no button.
  const noCancel = useHasRestriction(NO_CANCEL_PERMISSION);
  const actionAllowed = React.useCallback(
    (action: { kind: string }) => !(noCancel && action.kind === 'order.reject'),
    [noCancel],
  );
  const items = useNotificationsStore((s) => s.items);
  const removeLocal = useNotificationsStore((s) => s.remove);
  const muted = useNotificationsStore((s) => s.muted);
  const setMuted = useNotificationsStore((s) => s.setMuted);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);

  const orders = useMemo(
    () => items.filter((i) => i.category === 'order' && i.status === 'open'),
    [items],
  );

  if (orders.length === 0) return null;

  const handleAction = async (
    n: ClientNotification,
    action: NotificationAction,
  ) => {
    const orderId = n.data?.orderId as number | undefined;
    try {
      setBusy(n.id);
      if (action.kind === 'order.view') {
        if (orderId) navigate(`/admin/orders/${orderId}`);
        return;
      }
      if (action.kind === 'order.reject') {
        if (!window.confirm('Reject and cancel this order?')) return;
        if (orderId) await notificationsService.setOrderStatus(orderId, 'cancelled');
        await notificationsService.act(n.id, action.key);
        removeLocal(n.id);
        toast.success('Order rejected');
        return;
      }
      if (action.kind === 'order.accept') {
        if (orderId) await notificationsService.setOrderStatus(orderId, 'accepted');
        await notificationsService.act(n.id, action.key);
        removeLocal(n.id);
        toast.success(`Order #${n.data?.orderNumber ?? ''} accepted`);
        return;
      }
      // Generic acknowledge fallback.
      await notificationsService.act(n.id, action.key);
      removeLocal(n.id);
    } catch {
      toast.error('Action failed — please retry');
    } finally {
      setBusy(null);
    }
  };

  const btnClass = (style?: string) => {
    if (style === 'primary')
      return 'bg-green-600 hover:bg-green-700 text-white';
    if (style === 'danger') return 'bg-red-600 hover:bg-red-700 text-white';
    return 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600';
  };

  return (
    <div className="fixed top-16 right-4 z-50 flex w-80 max-w-[90vw] flex-col gap-2">
      <div className="flex items-center justify-between rounded-lg bg-red-600 px-3 py-1.5 text-white shadow-lg">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <MdNotificationsActive className="h-4 w-4" />
          {orders.length} new order{orders.length > 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          className="rounded p-1 hover:bg-white/20"
          title={muted ? 'Unmute alert sound' : 'Mute alert sound'}
          aria-label={muted ? 'Unmute alert sound' : 'Mute alert sound'}
        >
          {muted ? (
            <MdVolumeOff className="h-4 w-4" />
          ) : (
            <MdVolumeUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {orders.map((n) => (
        <div
          key={n.id}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl"
        >
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {n.title}
          </p>
          {n.body && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {n.body}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {n.actions.filter(actionAllowed).map((action) => (
              <button
                key={action.key}
                type="button"
                disabled={busy === n.id}
                onClick={() => handleAction(n, action)}
                className={`flex-1 min-w-[4.5rem] rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${btnClass(
                  action.style,
                )}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default OrderNotificationStack;
