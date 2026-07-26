import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Card from '../../../components/Card';
import Loader from '../../../components/Loader';
import { adminService } from '../../../services/api/adminService';
import { RiderProfile } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import RiderHrmHeader from './RiderHrmHeader';

/**
 * UNROUTED — superseded by RiderProfilesTable.tsx (the one-page base-salary
 * CRUD). Kept for an easy restore: re-add a route/nav entry in App.tsx.
 *
 * Read-only list of saved rider HR profiles — originally split out of the
 * Rider Profiles form page.
 */
const RiderProfilesList: React.FC = () => {
  const { data: profiles, isLoading } = useQuery({
    queryKey: ['rider-profiles'],
    queryFn: () => adminService.getRiderProfiles(),
  });

  if (isLoading) {
    return <Loader fullScreen text="Loading rider profiles..." />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Rider Profile List"
        subtitle="Every saved rider profile — pay terms, brand links and dispatch state."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="space-y-3">
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
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        profile.owner_brand_id
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {profile.owner_brand_id
                        ? `Owned · ${profile.owner_brand_name}`
                        : 'Foodies pool'}
                    </span>
                    <span className={`text-xs font-medium ${profile.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {profile.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(profile.brands ?? []).length === 0 ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      No brands linked — not dispatchable
                    </span>
                  ) : (
                    (profile.brands ?? []).map((b) => (
                      <span
                        key={b.brand_id ?? b.id}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200"
                      >
                        {b.brand_name ?? b.name}
                        {b.source === 'shared' ? ' · shared' : ''}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default RiderProfilesList;
