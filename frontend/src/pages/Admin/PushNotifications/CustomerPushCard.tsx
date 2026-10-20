import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { pushService } from '../../../services/api';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { confirmDialog } from '../../../utils/sweetAlert';
import SegToggle from '../../../components/SegToggle';
import { cu } from '../customersUi';
import { instantLabel, PLATFORM_LABEL } from './pushText';

const STATUS: Record<string, string> = {
  sent: 'Delivered',
  failed: 'Failed',
  unknown: 'Unknown',
  holdout: 'Held back (not sent)',
  pending: 'Waiting',
  sending: 'Sending',
  cancelled: 'Cancelled',
};

/**
 * On a customer's page: the phones they have the app on, the promos they got,
 * and "Stop promo notifications" for a customer who asks. Order-status updates
 * are not affected by the switch. Shown only to holders of push-notifications:view.
 */
const CustomerPushCard: React.FC<{ customerId: number; className: string; titleClassName: string }> = ({
  customerId,
  className,
  titleClassName,
}) => {
  const canView = useHasPermission('push-notifications:view');
  const canSend = useHasPermission('push-notifications:send');
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const { data } = useQuery({
    queryKey: ['push-customer', customerId],
    queryFn: () => pushService.customer(customerId),
    enabled: canView,
  });
  const toggle = useMutation({
    mutationFn: (optOut: boolean) => pushService.setOptOut(customerId, optOut),
    onSuccess: (d) => {
      qc.setQueryData(['push-customer', customerId], d);
      toast.success(d.opt_out ? 'Promo notifications stopped' : 'Promo notifications back on');
    },
    onError: () => toast.error('Could not change it'),
  });

  if (!canView || !data) return null;
  const phones = data.phones.map((p) => PLATFORM_LABEL[p.platform ?? ''] ?? 'phone');
  const history = showAll ? data.history : data.history.slice(0, 5);

  return (
    <div className={className} data-testid="customer-push-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={titleClassName}>Push notifications</h2>
          <p className={`mt-[3px] text-[12.5px] ${cu.muted}`}>
            {phones.length ? `Has the app on ${phones.length === 1 ? 'an' : phones.length} ${phones.join(' and ')} phone${phones.length === 1 ? '' : 's'}.` : 'Has not logged into the app on any phone.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[12.5px] ${cu.text}`}>Promos</span>
          <SegToggle
            on={!data.opt_out}
            ariaLabel="Promo notifications"
            onChange={async (on) => {
              if (!canSend) return;
              if (
                !on &&
                !(await confirmDialog({
                  title: 'Stop promo notifications?',
                  text: 'No promo or announcement will be sent to this customer. Their order-status updates still arrive.',
                  confirmText: 'Stop them',
                }))
              )
                return;
              toggle.mutate(!on);
            }}
          />
        </div>
      </div>
      {data.opt_out && (
        <p className={`mt-2 text-[12px] ${cu.warn}`}>
          Promos stopped{data.opt_out_at ? ` on ${instantLabel(data.opt_out_at)}` : ''}
          {data.opt_out_by ? ` by ${data.opt_out_by}` : ''}.
        </p>
      )}
      {data.history.length > 0 && (
        <ul className="mt-3 divide-y divide-[#F4F5F7] dark:divide-slate-700">
          {history.map((h) => (
            <li key={h.id} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
              <Link to={`/admin/push-notifications/${h.message_id}`} className={`min-w-0 truncate font-semibold ${cu.strong} hover:text-red-600`}>
                {h.name || h.title}
                {h.variant ? <span className={`ml-1 font-normal ${cu.muted}`}>(version {h.variant})</span> : null}
              </Link>
              <span className={`flex-none text-[12px] ${h.status === 'sent' ? cu.muted : cu.warn}`}>
                {STATUS[h.status] ?? h.status} · {instantLabel(h.sent_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.history.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-red-600 hover:underline">
          {showAll ? 'Show fewer' : `Show all ${data.history.length}`}
        </button>
      )}
    </div>
  );
};

export default CustomerPushCard;
