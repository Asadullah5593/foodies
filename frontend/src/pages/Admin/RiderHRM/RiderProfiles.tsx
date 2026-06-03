import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import Loader from '../../../components/Loader';
import { adminService } from '../../../services/api/adminService';
import { RiderProfile } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import RiderHrmHeader from './RiderHrmHeader';
import { inputClass, labelClass, useRiders } from './shared';

const RiderProfiles: React.FC = () => {
  const queryClient = useQueryClient();

  const [profileForm, setProfileForm] = useState({
    user_id: '',
    employment_status: 'active',
    salary_type: 'hybrid',
    employee_code: '',
    base_salary: '',
    default_per_ride_commission: '',
    max_active_orders: '1',
    min_rating: '',
    min_timely_rate: '',
    is_active: true,
  });

  const { data: riders, isLoading } = useRiders();

  const { data: profiles } = useQuery({
    queryKey: ['rider-profiles'],
    queryFn: () => adminService.getRiderProfiles(),
  });

  const upsertProfileMutation = useMutation({
    mutationFn: () =>
      adminService.upsertRiderProfile({
        user_id: Number(profileForm.user_id),
        employment_status: profileForm.employment_status,
        salary_type: profileForm.salary_type,
        employee_code: profileForm.employee_code || undefined,
        base_salary: profileForm.base_salary ? Number(profileForm.base_salary) : 0,
        default_per_ride_commission: profileForm.default_per_ride_commission
          ? Number(profileForm.default_per_ride_commission)
          : 0,
        max_active_orders: profileForm.max_active_orders
          ? Number(profileForm.max_active_orders)
          : 1,
        min_rating: profileForm.min_rating ? Number(profileForm.min_rating) : undefined,
        min_timely_rate: profileForm.min_timely_rate
          ? Number(profileForm.min_timely_rate)
          : undefined,
        is_active: profileForm.is_active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-profiles'] });
      toast.success('Rider profile saved');
      setProfileForm((prev) => ({
        ...prev,
        employee_code: '',
        base_salary: '',
        default_per_ride_commission: '',
        min_rating: '',
        min_timely_rate: '',
      }));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save rider profile');
    },
  });

  if (isLoading) {
    return <Loader fullScreen text="Loading rider profiles..." />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Rider Profiles"
        subtitle="Employment records and pay terms — salary type, base salary, per-ride commission and the rating / timeliness thresholds used by dispatch."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Rider Profiles
          </h2>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            salary + dispatch thresholds
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Rider</label>
            <select
              value={profileForm.user_id}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, user_id: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select rider</option>
              {(riders ?? []).map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.name} {rider.phone ? `· ${rider.phone}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Salary type</label>
            <select
              value={profileForm.salary_type}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, salary_type: e.target.value }))}
              className={inputClass}
            >
              <option value="fixed">Fixed salary</option>
              <option value="commission">Commission only</option>
              <option value="hybrid">Base + per ride + extras</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Employment status</label>
            <select
              value={profileForm.employment_status}
              onChange={(e) =>
                setProfileForm((prev) => ({ ...prev, employment_status: e.target.value }))
              }
              className={inputClass}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Employee code</label>
            <input
              value={profileForm.employee_code}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, employee_code: e.target.value }))}
              className={inputClass}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className={labelClass}>Base salary</label>
            <input
              type="number"
              value={profileForm.base_salary}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, base_salary: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Per-ride commission</label>
            <input
              type="number"
              value={profileForm.default_per_ride_commission}
              onChange={(e) =>
                setProfileForm((prev) => ({
                  ...prev,
                  default_per_ride_commission: e.target.value,
                }))
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Max active orders</label>
            <input
              type="number"
              min="1"
              value={profileForm.max_active_orders}
              onChange={(e) =>
                setProfileForm((prev) => ({ ...prev, max_active_orders: e.target.value }))
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Minimum rating</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="5"
              value={profileForm.min_rating}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, min_rating: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Minimum timely rate %</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={profileForm.min_timely_rate}
              onChange={(e) =>
                setProfileForm((prev) => ({ ...prev, min_timely_rate: e.target.value }))
              }
              className={inputClass}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={profileForm.is_active}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, is_active: e.target.checked }))}
            />
            HRM profile active
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            isLoading={upsertProfileMutation.isPending}
            disabled={!profileForm.user_id}
            onClick={() => upsertProfileMutation.mutate()}
          >
            Save rider profile
          </Button>
        </div>
        <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
          {(profiles ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No rider HR profiles yet.
            </p>
          ) : (
            (profiles ?? []).map((profile: RiderProfile) => (
              <div
                key={profile.id}
                className="rounded-lg border border-gray-200 dark:border-slate-700 p-3"
              >
                <div className="flex justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {profile.user_name ?? `Rider #${profile.user_id}`}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                      {profile.salary_type} · base {formatCurrency(profile.base_salary)} · ride {formatCurrency(profile.default_per_ride_commission)}
                    </p>
                  </div>
                  <span className={`text-xs font-medium ${profile.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {profile.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default RiderProfiles;
