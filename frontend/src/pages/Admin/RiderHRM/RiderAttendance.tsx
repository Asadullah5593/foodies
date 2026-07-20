import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import { adminService } from '../../../services/api/adminService';
import { RiderOnDuty } from '../../../types';
import RiderHrmHeader from './RiderHrmHeader';
import {
  inputClass,
  labelClass,
  useBranches,
  useBranchesById,
  useRiders,
  useRidersById,
} from './shared';

const RiderAttendance: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('rider-attendance:manage');

  const [attendanceForm, setAttendanceForm] = useState({
    rider_user_id: '',
    branch_id: '',
    notes: '',
  });

  const { data: branchesList } = useBranches();
  const { data: riders, isLoading } = useRiders();

  const { data: onDuty } = useQuery({
    queryKey: ['rider-on-duty'],
    queryFn: () => adminService.getOnDutyRiders(),
    refetchInterval: 30000,
  });

  const ridersById = useRidersById(riders);
  const branchesById = useBranchesById(branchesList);

  const checkInMutation = useMutation({
    mutationFn: () =>
      adminService.adminCheckInRider({
        rider_user_id: Number(attendanceForm.rider_user_id),
        branch_id: Number(attendanceForm.branch_id),
        notes: attendanceForm.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-on-duty'] });
      toast.success('Rider checked in');
      setAttendanceForm((prev) => ({ ...prev, notes: '' }));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to check in rider');
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (riderUserId: number) =>
      adminService.adminCheckOutRider({ rider_user_id: riderUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-on-duty'] });
      toast.success('Rider checked out');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to check out rider');
    },
  });

  if (isLoading) {
    return <Loader fullScreen text="Loading attendance..." />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Attendance & On-Duty"
        subtitle="Check riders in at a branch and monitor live on-duty presence. A checked-in, un-paused rider with a fresh heartbeat is required for automatic order assignment."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Attendance & On-Duty
          </h2>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            required for auto-assignment
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Rider</label>
            <select
              value={attendanceForm.rider_user_id}
              onChange={(e) =>
                setAttendanceForm((prev) => ({ ...prev, rider_user_id: e.target.value }))
              }
              className={inputClass}
            >
              <option value="">Select rider</option>
              {(riders ?? []).map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Branch</label>
            <select
              value={attendanceForm.branch_id}
              onChange={(e) =>
                setAttendanceForm((prev) => ({ ...prev, branch_id: e.target.value }))
              }
              className={inputClass}
            >
              <option value="">Select branch</option>
              {(branchesList ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Notes</label>
            <input
              value={attendanceForm.notes}
              onChange={(e) => setAttendanceForm((prev) => ({ ...prev, notes: e.target.value }))}
              className={inputClass}
              placeholder="Optional check-in note"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          {canManage && <Button
            variant="primary"
            isLoading={checkInMutation.isPending}
            disabled={!attendanceForm.rider_user_id || !attendanceForm.branch_id}
            onClick={() => checkInMutation.mutate()}
          >
            Check in rider
          </Button>}
        </div>

        <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
          {(onDuty ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No riders are currently on duty.
            </p>
          ) : (
            (onDuty ?? []).map((entry: RiderOnDuty) => {
              const rider = ridersById.get(entry.rider_user_id);
              const branch = branchesById.get(entry.branch_id);
              return (
                <div
                  key={`${entry.rider_user_id}-${entry.branch_id}`}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {rider?.name ?? `Rider #${entry.rider_user_id}`}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                      {branch?.name ?? `Branch #${entry.branch_id}`} · heartbeat {entry.last_heartbeat_at ? new Date(entry.last_heartbeat_at).toLocaleTimeString() : '—'} · location {entry.last_location_at ? new Date(entry.last_location_at).toLocaleTimeString() : '—'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                      Coordinates:{' '}
                      {entry.last_latitude != null && entry.last_longitude != null
                        ? `${entry.last_latitude.toFixed(5)}, ${entry.last_longitude.toFixed(5)}`
                        : 'waiting for rider browser GPS'}
                    </p>
                    {entry.last_latitude != null && entry.last_longitude != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${entry.last_latitude},${entry.last_longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Open current rider location
                      </a>
                    ) : null}
                  </div>
                  {canManage && <Button
                    size="small"
                    variant="outline"
                    isLoading={checkOutMutation.isPending}
                    onClick={() => checkOutMutation.mutate(entry.rider_user_id)}
                  >
                    Check out
                  </Button>}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
};

export default RiderAttendance;
