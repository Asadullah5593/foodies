import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import Loader from '../../../components/Loader';
import SearchableMultiSelect from '../../../components/SearchableMultiSelect';
import apiClient from '../../../utils/apiClient';
import { adminService } from '../../../services/api/adminService';
import { useAuth } from '../../../contexts/AuthContext';
import { RiderWithBrands } from '../../../types';
import RiderHrmHeader from './RiderHrmHeader';

type BrandOption = { id: number; name: string };

const RiderPoolSharing: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwnerGM =
    user?.tenant_id != null &&
    (user?.allowed_brand_ids == null || user?.allowed_brand_ids.length === 0);

  const [managing, setManaging] = useState<RiderWithBrands | null>(null);
  const [selectedBrandIds, setSelectedBrandIds] = useState<number[]>([]);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<BrandOption[]>('/admin/brands');
      return res.data ?? [];
    },
    enabled: isOwnerGM,
  });
  const brandOptions = useMemo(
    () => (brands ?? []).map((b) => ({ id: b.id, name: b.name })),
    [brands],
  );

  const { data: riders, isLoading: ridersLoading } = useQuery({
    queryKey: ['rider-pool-owner'],
    queryFn: () => adminService.getPoolRidersForOwner(),
    enabled: isOwnerGM,
  });

  const { data: requests, isLoading: requestsLoading } = useQuery({
    queryKey: ['rider-share-requests-owner', 'pending'],
    queryFn: () => adminService.getShareRequestsForOwner('pending'),
    enabled: isOwnerGM,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['rider-pool-owner'] });
    queryClient.invalidateQueries({ queryKey: ['rider-share-requests-owner'] });
    queryClient.invalidateQueries({ queryKey: ['rider-profiles'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) => adminService.approveShareRequest(id),
    onSuccess: () => {
      toast.success('Request approved — rider linked');
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Failed to approve'),
  });

  const declineMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      adminService.declineShareRequest(id, reason),
    onSuccess: () => {
      toast.success('Request declined');
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Failed to decline'),
  });

  const setBrandsMutation = useMutation({
    mutationFn: ({ riderId, brandIds }: { riderId: number; brandIds: number[] }) =>
      adminService.setRiderBrands(riderId, brandIds),
    onSuccess: () => {
      toast.success('Brand links updated');
      setManaging(null);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || 'Failed to update brand links'),
  });

  const openManage = (rider: RiderWithBrands) => {
    setManaging(rider);
    setSelectedBrandIds(rider.brand_ids ?? []);
  };

  if (!isOwnerGM) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Only the owner / general manager can manage the rider pool. Brand
            admins can request riders from <strong>Request riders</strong>.
          </p>
        </Card>
      </div>
    );
  }

  if (ridersLoading) {
    return <Loader fullScreen text="Loading rider pool..." />;
  }

  const unlinkedCount = (riders ?? []).filter((r) => !r.is_dispatchable).length;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Rider Pool & Sharing"
        subtitle="Link riders to brands and review brands' requests to borrow Foodies-pool riders. A rider must be linked to a brand to be dispatchable for that brand's orders."
      />

      {unlinkedCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {unlinkedCount} rider{unlinkedCount === 1 ? '' : 's'} not linked to any
          brand — they will not be offered for delivery dispatch until linked.
        </div>
      )}

      {/* Incoming requests */}
      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">
          Incoming share requests
        </h2>
        {requestsLoading ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
        ) : (requests ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No pending requests.
          </p>
        ) : (
          <div className="space-y-2">
            {(requests ?? []).map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-slate-700 p-3"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-slate-100">
                    {req.rider_name ?? `Rider #${req.rider_user_id}`} →{' '}
                    {req.brand_name ?? `Brand #${req.requesting_brand_id}`}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    requested by {req.requested_by_name ?? '—'}
                    {req.note ? ` · "${req.note}"` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    isLoading={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(req.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const reason =
                        window.prompt('Reason for declining (optional)') ??
                        undefined;
                      declineMutation.mutate({ id: req.id, reason });
                    }}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* All riders */}
      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-4">
          Riders
        </h2>
        <div className="space-y-2">
          {(riders ?? []).map((rider) => (
            <div
              key={rider.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-slate-700 p-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-slate-100">
                  {rider.name}
                  <span
                    className={`ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      rider.owner_brand_id
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {rider.owner_brand_id
                      ? `Owned · ${rider.owner_brand_name}`
                      : 'Foodies pool'}
                  </span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {rider.brands.length === 0 ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Not dispatchable
                    </span>
                  ) : (
                    rider.brands.map((b) => (
                      <span
                        key={b.id}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200"
                      >
                        {b.name}
                        {b.source === 'shared' ? ' · shared' : ''}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <Button variant="secondary" onClick={() => openManage(rider)}>
                Manage brands
              </Button>
            </div>
          ))}
          {(riders ?? []).length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No riders found. Create riders in Branch Users (rider role).
            </p>
          )}
        </div>
      </Card>

      {/* Manage-brands modal */}
      {managing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              Manage brands · {managing.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
              {managing.owner_brand_id
                ? `Owning brand (${managing.owner_brand_name}) is always kept.`
                : 'Foodies-pool rider — link to any brands they should serve.'}
            </p>
            <SearchableMultiSelect
              options={brandOptions}
              selectedIds={selectedBrandIds}
              onChange={setSelectedBrandIds}
              placeholder="All brands"
              label="Brands this rider serves"
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setManaging(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                isLoading={setBrandsMutation.isPending}
                onClick={() =>
                  setBrandsMutation.mutate({
                    riderId: managing.id,
                    brandIds: selectedBrandIds,
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RiderPoolSharing;
