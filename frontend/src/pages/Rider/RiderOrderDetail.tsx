import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { riderService, RiderOrder } from '../../services/api/riderService';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { formatCurrency } from '../../utils/currency';

const DELIVERY_STATUS_OPTIONS = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'delivery_failed', label: 'Delivery Failed' },
];

const RiderOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusModal, setStatusModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [failedReason, setFailedReason] = useState('');

  const orderId = id ? parseInt(id, 10) : 0;

  const { data: order, isLoading } = useQuery({
    queryKey: ['rider-order', orderId],
    queryFn: () => riderService.getOrder(orderId),
    enabled: orderId > 0,
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

  if (isLoading || !order) {
    return <Loader fullScreen text="Loading order..." />;
  }

  const o = order as RiderOrder;
  const canUpdateStatus =
    o.delivery_status &&
    o.delivery_status !== 'delivered' &&
    o.delivery_status !== 'delivery_failed';

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/rider')}
          className="text-blue-600 hover:underline text-sm"
        >
          ← Back to deliveries
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h1 className="text-xl font-bold text-gray-800">
              #{o.order_number}
              {o.brand_name ? ` · ${o.brand_name}` : ''}
            </h1>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                o.delivery_status === 'delivered'
                  ? 'bg-emerald-100 text-emerald-800'
                  : o.delivery_status === 'delivery_failed'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {o.delivery_status ?? 'Assigned'}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Delivery address & receiver
            </h2>
            <div className="bg-white border border-gray-100 rounded-lg p-3 space-y-1">
              {o.delivery_address && (
                <p className="text-gray-800">📍 {o.delivery_address}</p>
              )}
              {o.customer_name && (
                <p className="text-gray-700">
                  <span className="text-gray-500">Name:</span> {o.customer_name}
                </p>
              )}
              {o.customer_phone && (
                <p className="text-gray-700">
                  <span className="text-gray-500">Phone:</span>{' '}
                  <a
                    href={`tel:${o.customer_phone}`}
                    className="text-blue-600 hover:underline"
                  >
                    {o.customer_phone}
                  </a>
                </p>
              )}
              {o.branch?.name && (
                <p className="text-gray-500 text-sm">
                  Pick up: {o.branch.name}
                  {o.branch.address && ` · ${o.branch.address}`}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Items
            </h2>
            <ul className="border border-gray-100 rounded-lg divide-y divide-gray-50">
              {o.items?.map((item) => (
                <li
                  key={item.id}
                  className="px-3 py-2 flex justify-between text-sm"
                >
                  <span>
                    {item.name_snapshot} × {item.quantity}
                  </span>
                  <span className="text-gray-500">
                    {formatCurrency(item.unit_price * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-right font-semibold text-gray-800 mt-2">
              Total: {formatCurrency(o.total_amount)}
            </p>
          </section>

          {o.delivery_failed_reason && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-1">
                Delivery failed reason
              </h2>
              <p className="text-gray-600 text-sm">{o.delivery_failed_reason}</p>
            </section>
          )}

          {canUpdateStatus && (
            <div className="pt-2">
              <Button
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
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              Update status
            </h3>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                New status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select...</option>
                {DELIVERY_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {selectedStatus === 'delivery_failed' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mt-2">
                    Reason (required)
                  </label>
                  <textarea
                    value={failedReason}
                    onChange={(e) => setFailedReason(e.target.value)}
                    placeholder="e.g. Customer not available, wrong address"
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 mt-1"
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
