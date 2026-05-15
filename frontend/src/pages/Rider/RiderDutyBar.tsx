import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Swal from 'sweetalert2';
import { toast } from 'react-hot-toast';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { riderService } from '../../services/api/riderService';
import { confirmDialog } from '../../utils/sweetAlert';

const ATTENDANCE_POLL_MS = 8000;

function errMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string } }; message?: string };
  return err.response?.data?.message || err.message || fallback;
}

export const RiderDutyBar: React.FC = () => {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<number | ''>('');

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['rider-attendance-status'],
    queryFn: () => riderService.getAttendanceStatus(),
    refetchInterval: ATTENDANCE_POLL_MS,
  });

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['rider-my-branches'],
    queryFn: () => riderService.getMyBranches(),
  });

  const selectedBranch = useMemo(
    () => (branches ?? []).find((b) => b.id === branchId),
    [branches, branchId]
  );

  const checkInMutation = useMutation({
    mutationFn: (payload: { branch_id: number }) => riderService.checkIn(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-attendance-status'] });
      toast.success('Checked in');
    },
    onError: (e: unknown) => {
      toast.error(errMessage(e, 'Check-in failed'));
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: () => riderService.checkOut(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-attendance-status'] });
      setBranchId('');
      toast.success('Checked out');
    },
    onError: (e: unknown) => {
      toast.error(errMessage(e, 'Check-out failed'));
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (payload: { is_paused: boolean; pause_reason?: string }) =>
      riderService.setAttendancePause(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rider-attendance-status'] });
      toast.success(variables.is_paused ? 'Break started' : 'Back on duty');
    },
    onError: (e: unknown) => {
      toast.error(errMessage(e, 'Could not update break status'));
    },
  });

  const busy =
    checkInMutation.isPending || checkOutMutation.isPending || pauseMutation.isPending;

  const checkedIn = !!status?.is_checked_in;
  const paused = !!status?.is_paused;

  const handleCheckIn = async () => {
    if (busy || branchId === '') return;
    const name = selectedBranch?.name ?? `Branch #${branchId}`;
    const ok = await confirmDialog({
      title: 'Check in for deliveries?',
      text: `You will go on duty at ${name}. You can check out anytime. Confirm only when you are ready to receive work.`,
      confirmText: 'Check in',
      cancelText: 'Cancel',
      icon: 'question',
    });
    if (!ok) return;
    checkInMutation.mutate({ branch_id: Number(branchId) });
  };

  const handleCheckOut = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'Check out?',
      text:
        'You will end this shift, stop live location updates for dispatch, and disappear from the on-duty list until you check in again. This is not limited to once per day — use only when you really mean to leave.',
      confirmText: 'Check out',
      cancelText: 'Stay on duty',
      icon: 'warning',
    });
    if (!ok) return;
    checkOutMutation.mutate();
  };

  const handleStartBreak = async () => {
    if (busy) return;
    const pre = await confirmDialog({
      title: 'Start a break?',
      text:
        'While on break you stay checked in but you will not be picked for new auto-assignments until you end the break. Confirm to avoid tapping by mistake.',
      confirmText: 'Continue',
      cancelText: 'Cancel',
      icon: 'warning',
    });
    if (!pre) return;

    const res = await Swal.fire({
      title: 'Break details',
      html:
        '<p style="margin:0 0 12px;text-align:left;font-size:14px;line-height:1.5;color:#334155">Optional reason helps your manager (e.g. lunch, fuel).</p>',
      input: 'text',
      inputPlaceholder: 'Reason (optional)',
      showCancelButton: true,
      confirmButtonText: 'Start break',
      cancelButtonText: 'Back',
      confirmButtonColor: '#B91C1C',
      icon: 'info',
    });
    if (!res.isConfirmed) return;

    const reason =
      typeof res.value === 'string' && res.value.trim() ? res.value.trim() : undefined;
    pauseMutation.mutate({ is_paused: true, ...(reason ? { pause_reason: reason } : {}) });
  };

  const handleEndBreak = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'End break?',
      text: 'You will return to normal on-duty availability for new deliveries.',
      confirmText: 'Resume',
      cancelText: 'Cancel',
      icon: 'question',
    });
    if (!ok) return;
    pauseMutation.mutate({ is_paused: false });
  };

  const statusPillClass = !checkedIn
    ? 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-100'
    : paused
      ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100'
      : 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100';

  const statusLabel = !checkedIn ? 'Off duty' : paused ? 'On break' : 'On duty';

  return (
    <Card className="mb-4 overflow-hidden dark:bg-slate-800 dark:border-slate-700 border border-gray-200 shadow-sm">
      <div className="bg-gradient-to-r from-slate-50 to-red-50/40 dark:from-slate-800 dark:to-slate-800/90 px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            Shift &amp; availability
          </h2>
          <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5 max-w-xl">
            Check in at your branch to receive assignments. Use a break when you step away; check out when your shift ends.
          </p>
        </div>
        {!statusLoading && (
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusPillClass}`}
          >
            {statusLabel}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {statusLoading ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">Loading your status…</p>
        ) : (
          <>
            {checkedIn && (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-sm text-gray-700 dark:text-slate-200">
                <span className="font-medium text-gray-900 dark:text-slate-100">Location: </span>
                {status?.branch_name ?? '—'}
                {paused && status?.pause_reason != null && (
                  <span className="block mt-1 text-amber-800 dark:text-amber-200">
                    Break note: {status.pause_reason}
                  </span>
                )}
              </div>
            )}

            {!checkedIn && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-800 dark:text-slate-200">
                  Choose branch, then check in
                </p>
                {branchesLoading ? (
                  <p className="text-sm text-gray-500">Loading branches…</p>
                ) : !branches?.length ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    You are not assigned as a rider on any branch yet. Ask an admin to add you in Branch Users with the rider role.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(branches ?? []).map((b) => {
                      const selected = branchId === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          disabled={busy}
                          onClick={() => setBranchId(b.id)}
                          className={[
                            'text-left rounded-xl border px-3 py-3 transition-colors',
                            selected
                              ? 'border-red-500 ring-2 ring-red-400/50 bg-red-50/80 dark:bg-red-950/30 dark:border-red-500'
                              : 'border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700/50',
                          ].join(' ')}
                        >
                          <span className="font-medium text-gray-900 dark:text-slate-100 block">
                            {b.name}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{b.code}</span>
                          {b.address ? (
                            <span className="text-xs text-gray-500 dark:text-slate-500 block mt-1 line-clamp-2">
                              {b.address}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="large"
                  className="w-full sm:w-auto min-w-[200px]"
                  isLoading={checkInMutation.isPending}
                  disabled={busy || branchId === '' || !branches?.length}
                  onClick={() => void handleCheckIn()}
                >
                  Check in to start shift
                </Button>
              </div>
            )}

            {checkedIn && !paused && (
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="medium"
                  className="w-full sm:flex-1"
                  disabled={busy}
                  isLoading={pauseMutation.isPending}
                  onClick={() => void handleStartBreak()}
                >
                  Take a break
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="medium"
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  disabled={busy}
                  isLoading={checkOutMutation.isPending}
                  onClick={() => void handleCheckOut()}
                >
                  Check out
                </Button>
              </div>
            )}

            {checkedIn && paused && (
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <Button
                  type="button"
                  variant="primary"
                  size="medium"
                  className="w-full sm:flex-1"
                  disabled={busy}
                  isLoading={pauseMutation.isPending}
                  onClick={() => void handleEndBreak()}
                >
                  End break &amp; resume
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="medium"
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  disabled={busy}
                  isLoading={checkOutMutation.isPending}
                  onClick={() => void handleCheckOut()}
                >
                  Check out
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

export default RiderDutyBar;
