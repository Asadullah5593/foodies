import React, { useState } from 'react';
import { MdOutlineLocationOn } from 'react-icons/md';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { riderService, RiderOrder } from '../../services/api/riderService';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { formatCurrency } from '../../utils/currency';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';

const ORDER_STATUS_LABELS: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DELIVERY_STATUS_OPTIONS = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'delivery_failed', label: 'Delivery Failed' },
];

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  delivery_failed: 'Delivery Failed',
};

/** When order is already assigned/accepted, rider cannot "accept" again – next step is Picked Up. */
function getStatusOptions(currentStatus: string | null | undefined) {
  if (currentStatus === 'accepted' || currentStatus === 'assigned' || !currentStatus) {
    return DELIVERY_STATUS_OPTIONS.filter((o) => o.value !== 'accepted');
  }
  if (currentStatus === 'picked_up') {
    return DELIVERY_STATUS_OPTIONS.filter((o) => o.value === 'delivered' || o.value === 'delivery_failed');
  }
  return DELIVERY_STATUS_OPTIONS;
}

const RiderOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusModal, setStatusModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [failedReason, setFailedReason] = useState('');
  const [navigatingBack, setNavigatingBack] = useState(false);

  const orderId = id ? parseInt(id, 10) : 0;

  const { data: order, isLoading } = useQuery({
    queryKey: ['rider-order', orderId],
    queryFn: () => riderService.getOrder(orderId),
    enabled: orderId > 0,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      delivery_status,
      delivery_failed_reason,
    }: {
      delivery_status: string;
      delivery_failed_reason?: string;
    }) =>
      riderService.updateDeliveryStatus(
        orderId,
        delivery_status,
        delivery_failed_reason
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['rider-orders'] });
      setStatusModal(false);
      setSelectedStatus('');
      setFailedReason('');
      toast.success('Status updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update status');
    },
  });

  const handleUpdateStatus = () => {
    if (!selectedStatus) return;
    if (selectedStatus === 'delivery_failed' && !failedReason.trim()) {
      toast.error('Please provide a reason for delivery failure');
      return;
    }
    updateStatusMutation.mutate({
      delivery_status: selectedStatus,
      ...(selectedStatus === 'delivery_failed' && {
        delivery_failed_reason: failedReason.trim(),
      }),
    });
  };

  const isSubmitting = updateStatusMutation.isPending;
  if (isLoading || !order || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Updating...' : 'Loading order...'} />;
  }

  const o = order as RiderOrder;
  const canUpdateStatus =
    o.delivery_status &&
    o.delivery_status !== 'delivered' &&
    o.delivery_status !== 'delivery_failed';

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <Button
          type="button"
          variant="outline"
          size="small"
          disabled={navigatingBack}
          onClick={async () => {
            setNavigatingBack(true);
            try {
              await queryClient.prefetchQuery({ queryKey: ['rider-orders'], queryFn: () => riderService.getOrders() });
              navigate('/rider');
            } finally {
              setNavigatingBack(false);
            }
          }}
        >
          {navigatingBack ? 'Loading…' : '← Back to deliveries'}
        </Button>
      </div>

      <Card className="overflow-hidden dark:bg-slate-800 dark:border-slate-700">
        <div className="bg-gray-50 dark:bg-slate-700/50 px-4 py-3 border-b border-gray-100 dark:border-slate-600">
          <div className="flex justify-between items-start flex-wrap gap-2">
            <h1 className="text-xl font-bold text-gray-800 dark:text-slate-100">
              #{o.order_number}
              {o.brand_name ? ` · ${o.brand_name}` : ''}
            </h1>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Order:</span>
              <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-xs font-medium">
                {ORDER_STATUS_LABELS[o.status ?? ''] ?? o.status ?? 'Placed'}
              </span>
              <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Delivery:</span>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  o.delivery_status === 'delivered'
                    ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200'
                    : o.delivery_status === 'delivery_failed'
                    ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200'
                    : 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200'
                }`}
              >
                {DELIVERY_STATUS_LABELS[o.delivery_status ?? ''] ?? o.delivery_status ?? 'Assigned'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <section>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Delivery address & receiver
            </h2>
            <div className="bg-white dark:bg-slate-700/50 border border-gray-100 dark:border-slate-600 rounded-lg p-3 space-y-1">
              {o.delivery_address && (
                <p className="text-gray-800 dark:text-slate-100">
                  <MdOutlineLocationOn className="inline h-4 w-4 mr-1 align-text-bottom" />
                  {o.delivery_address}
                </p>
              )}
              {o.customer_name && (
                <p className="text-gray-700 dark:text-slate-300">
                  <span className="text-gray-500 dark:text-slate-400">Name:</span> {o.customer_name}
                </p>
              )}
              {o.customer_phone && (
                <p className="text-gray-700 dark:text-slate-300">
                  <span className="text-gray-500 dark:text-slate-400">Phone:</span>{' '}
                  <a
                    href={`tel:${o.customer_phone}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {o.customer_phone}
                  </a>
                </p>
              )}
              {o.branch?.name && (
                <p className="text-gray-500 dark:text-slate-400 text-sm">
                  Pick up: {o.branch.name}
                  {o.branch.address && ` · ${o.branch.address}`}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
              Items
            </h2>
            <ul className="border border-gray-100 dark:border-slate-600 rounded-lg divide-y divide-gray-50 dark:divide-slate-600">
              {o.items?.map((item) => (
                <li
                  key={item.id}
                  className="px-3 py-2 flex justify-between text-sm text-gray-800 dark:text-slate-200"
                >
                  <span>
                    {item.name_snapshot} × {item.quantity}
                  </span>
                  <span className="text-gray-500 dark:text-slate-400">
                    {formatCurrency(item.unit_price * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-right font-semibold text-gray-800 dark:text-slate-100 mt-2">
              Total: {formatCurrency(o.total_amount)}
            </p>
          </section>

          {o.delivery_failed_reason && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">
                Delivery failed reason
              </h2>
              <p className="text-gray-600 dark:text-slate-400 text-sm">{o.delivery_failed_reason}</p>
            </section>
          )}

          {canUpdateStatus && (
            <div className="pt-2">
              <Button
                variant="primary"
                onClick={() => setStatusModal(true)}
                className="w-full"
                size="large"
              >
                Update delivery status
              </Button>
            </div>
          )}
        </div>
      </Card>

      {statusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <Card className="w-full max-w-md p-6 dark:bg-slate-800 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">
              Update status
            </h3>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                New status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select...</option>
                {getStatusOptions(o.delivery_status).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {selectedStatus === 'delivery_failed' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mt-2">
                    Reason (required)
                  </label>
                  <textarea
                    value={failedReason}
                    onChange={(e) => setFailedReason(e.target.value)}
                    placeholder="e.g. Customer not available, wrong address"
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 mt-1"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setStatusModal(false);
                  setSelectedStatus('');
                  setFailedReason('');
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleUpdateStatus}
                disabled={
                  !selectedStatus ||
                  (selectedStatus === 'delivery_failed' && !failedReason.trim()) ||
                  updateStatusMutation.isPending
                }
                isLoading={updateStatusMutation.isPending}
                className="flex-1"
              >
                Update
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default RiderOrderDetail;
