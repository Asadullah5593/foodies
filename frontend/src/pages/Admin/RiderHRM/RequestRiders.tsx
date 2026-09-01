import React, { useEffect, useMemo, useState } from 'react';
import { labelWithStatus } from '../../../utils/entityStatus';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import { useHasPermission } from '../../../hooks/useHasPermission';
import apiClient from '../../../utils/apiClient';
import { adminService } from '../../../services/api/adminService';
import { useAuth } from '../../../contexts/AuthContext';
import { RiderShareRequestStatus } from '../../../types';
import { inputClass, labelClass } from './shared';
import RiderHrmHeader from './RiderHrmHeader';

type BrandOption = { id: number; name: string };

const statusBadge: Record<RiderShareRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  declined: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const RequestRiders: React.FC = () => {
  const queryClient = useQueryClient();
  const canRequest = useHasPermission('rider-share:request');
  const { user } = useAuth();
  const isBrandAdmin =
    Array.isArray(user?.allowed_brand_ids) &&
    (user?.allowed_brand_ids?.length ?? 0) > 0;

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<BrandOption[]>('/admin/brands');
      return res.data ?? [];
    },
    enabled: isBrandAdmin,
  });
  const brandOptions = useMemo(() => brands ?? [], [brands]);

  const [brandId, setBrandId] = useState<number | null>(null);
  useEffect(() => {
    if (brandId == null && brandOptions.length > 0) {
      setBrandId(brandOptions[0].id);
    }
  }, [brandOptions, brandId]);

  const { data: poolRiders, isLoading: poolLoading } = useQuery({
    queryKey: ['pool-riders', brandId],
    queryFn: () => adminService.getAvailablePoolRiders(brandId as number),
    enabled: isBrandAdmin && brandId != null,
  });

  const { data: myRequests } = useQuery({
    queryKey: ['my-share-requests'],
    queryFn: () => adminService.getMyShareRequests(),
    enabled: isBrandAdmin,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pool-riders'] });
    queryClient.invalidateQueries({ queryKey: ['my-share-requests'] });
  };

  const requestMutation = useMutation({
    mutationFn: (riderUserId: number) =>
      adminService.createRiderShareRequest({
        brand_id: brandId as number,
        rider_user_id: riderUserId,
      }),
    onSuccess: () => {
      toast.success('Request sent to the owner for approval');
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Failed to send request'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => adminService.cancelRiderShareRequest(id),
    onSuccess: () => {
      toast.success('Request cancelled');
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Failed to cancel'),
  });

  if (!isBrandAdmin) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Requesting riders is for brand admins. Manage the shared pool from{' '}
            <strong>Rider pool &amp; sharing</strong>.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Request Riders"
        subtitle="Browse Foodies-pool riders and request them for your brand. The owner approves before a rider becomes available to you."
      />

      {brandOptions.length > 1 && (
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <label className={labelClass}>Brand</label>
          <select
            value={brandId ?? ''}
            onChange={(e) => setBrandId(Number(e.target.value))}
            className={inputClass}
          >
            {brandOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {labelWithStatus(b.name, b)}
              </option>
            ))}
          </select>
        </Card>
      )}

      {/* Available pool riders */}
      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">
          Available pool riders
        </h2>
        {poolLoading ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
        ) : (poolRiders ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No Foodies-pool riders are available to request right now.
          </p>
        ) : (
          <div className="space-y-2">
            {(poolRiders ?? []).map((rider) => (
              <div
                key={rider.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-slate-700 p-3"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-slate-100">
                    {rider.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {rider.phone ?? 'no phone'}
                    {rider.rating_average != null
                      ? ` · ${rider.rating_average.toFixed(1)}★ (${rider.rating_count})`
                      : ''}
                  </p>
                </div>
                {rider.request_status === 'pending' ? (
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    Requested
                  </span>
                ) : canRequest ? (
                  <Button
                    variant="primary"
                    isLoading={requestMutation.isPending}
                    onClick={() => requestMutation.mutate(rider.id)}
                  >
                    Request
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* My requests */}
      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">
          My requests
        </h2>
        {(myRequests ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            You haven't requested any riders yet.
          </p>
        ) : (
          <div className="space-y-2">
            {(myRequests ?? []).map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-slate-700 p-3"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-slate-100">
                    {req.rider_name ?? `Rider #${req.rider_user_id}`}
                    <span className="text-gray-500 dark:text-slate-400">
                      {' '}
                      → {req.brand_name ?? ''}
                    </span>
                  </p>
                  {req.decline_reason && req.status === 'declined' && (
                    <p className="text-xs text-rose-600 dark:text-rose-400">
                      Declined: {req.decline_reason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${statusBadge[req.status]}`}
                  >
                    {req.status}
                  </span>
                  {req.status === 'pending' && (
                    <Button
                      variant="secondary"
                      isLoading={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(req.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default RequestRiders;
