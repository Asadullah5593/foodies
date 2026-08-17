import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdOutlineSchool } from 'react-icons/md';
import {
  EmployeeTrainingRow,
  hrService,
} from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Modal from '../../../components/Modal';
import SearchableSelect from '../../../components/SearchableSelect';

interface Props {
  employeeId: number;
}

const today = () => new Date().toISOString().slice(0, 10);

const badge = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';

const statusClass = (status: string) => {
  if (status === 'completed')
    return `${badge} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300`;
  if (status === 'in_progress')
    return `${badge} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`;
  if (status === 'failed' || status === 'expired')
    return `${badge} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300`;
  return `${badge} bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300`;
};

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

const mutationError = (fallback: string) => (err: unknown) => {
  const message =
    (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
      ?.message ?? fallback;
  toast.error(Array.isArray(message) ? message[0] : message);
};

/**
 * One employee's training record.
 *
 * This is what the review form's readiness panel reads, so recording a
 * completion here is what makes a promotion stop warning. Re-assigning an
 * expired or failed program restarts the same row rather than adding a second
 * one — "have they done it" stays a single answer.
 */
const EmployeeTrainingSection: React.FC<Props> = ({ employeeId }) => {
  const queryClient = useQueryClient();
  const canView = useHasPermission('training:view');
  const canRecord = useHasPermission('training:record');
  const [assigning, setAssigning] = useState(false);
  const [programId, setProgramId] = useState<number | ''>('');
  const [recording, setRecording] = useState<EmployeeTrainingRow | null>(null);
  const [outcome, setOutcome] = useState({
    status: 'completed' as 'in_progress' | 'completed' | 'failed',
    completed_on: today(),
    score: '' as number | '',
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-employee-trainings', employeeId],
    queryFn: () => hrService.listEmployeeTrainings(employeeId),
    enabled: canView,
  });

  const { data: programs = [] } = useQuery({
    queryKey: ['hr-training-programs'],
    queryFn: () => hrService.listTrainingPrograms(),
    enabled: canView && assigning,
  });

  const assign = useMutation({
    mutationFn: () => hrService.assignTraining(employeeId, Number(programId)),
    onSuccess: (result) => {
      toast.success(result.restarted ? 'Program restarted' : 'Program assigned');
      setAssigning(false);
      setProgramId('');
      queryClient.invalidateQueries({ queryKey: ['hr-employee-trainings', employeeId] });
    },
    onError: mutationError('Could not assign the program'),
  });

  const record = useMutation({
    mutationFn: () =>
      hrService.recordTraining(recording!.id, {
        status: outcome.status,
        completed_on:
          outcome.status === 'completed' ? outcome.completed_on : undefined,
        score: outcome.score === '' ? undefined : Number(outcome.score),
      }),
    onSuccess: (result) => {
      toast.success(
        result.expires_on
          ? `Recorded — valid until ${result.expires_on}`
          : 'Recorded',
      );
      setRecording(null);
      queryClient.invalidateQueries({ queryKey: ['hr-employee-trainings', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] });
    },
    onError: mutationError('Could not record the outcome'),
  });

  if (!canView) return null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
          <MdOutlineSchool className="text-base" /> Training
        </h2>
        {canRecord && (
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            Assign program
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No training assigned yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="py-2 pr-3">Program</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Completed</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2 pr-3">Expires</th>
                {canRecord && <th className="py-2 text-right">Record</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                    {r.program.name ?? `#${r.program.id}`}
                    {r.program.level != null && (
                      <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                        L{r.program.level}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={statusClass(r.status)}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                    {r.completed_on ?? '—'}
                  </td>
                  <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                    {r.score ?? '—'}
                  </td>
                  <td className="py-2 pr-3">
                    {r.expires_on ? (
                      <span
                        className={
                          r.expiring_soon
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-gray-600 dark:text-gray-300'
                        }
                      >
                        {r.expires_on}
                        {r.expiring_soon && ' · soon'}
                      </span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">—</span>
                    )}
                  </td>
                  {canRecord && (
                    <td className="py-2 text-right">
                      {['expired', 'failed'].includes(r.status) ? (
                        <button
                          type="button"
                          onClick={() => {
                            setProgramId(r.program.id);
                            setAssigning(true);
                          }}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
                        >
                          Restart
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRecording(r);
                            setOutcome({
                              status: 'completed',
                              completed_on: today(),
                              score: r.score ?? '',
                            });
                          }}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
                        >
                          Update
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <Modal isOpen onClose={() => setAssigning(false)} title="Assign a training program">
          <label className={labelClass}>Program *</label>
          <SearchableSelect
            value={programId === '' ? '' : String(programId)}
            onChange={(v) => setProgramId(v === '' ? '' : Number(v))}
            options={programs.map((p) => ({
              value: String(p.id),
              label: `${p.name}${p.category ? ` · ${p.category}` : ''} (L${p.level})`,
            }))}
            placeholder="Select a program"
            searchPlaceholder="Search programs…"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAssigning(false)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={programId === '' || assign.isPending}
              onClick={() => assign.mutate()}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {assign.isPending ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </Modal>
      )}

      {recording && (
        <Modal
          isOpen
          onClose={() => setRecording(null)}
          title={`Record — ${recording.program.name ?? 'training'}`}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Outcome *</label>
              <SearchableSelect
                value={outcome.status}
                onChange={(v) =>
                  setOutcome((o) => ({
                    ...o,
                    status: v as 'in_progress' | 'completed' | 'failed',
                  }))
                }
                options={[
                  { value: 'in_progress', label: 'Started / in progress' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />
            </div>
            {outcome.status === 'completed' && (
              <div>
                <label className={labelClass}>Completed on</label>
                <input
                  type="date"
                  className={field}
                  value={outcome.completed_on}
                  onChange={(e) =>
                    setOutcome((o) => ({ ...o, completed_on: e.target.value }))
                  }
                />
              </div>
            )}
            {outcome.status !== 'in_progress' && (
              <div>
                <label className={labelClass}>Score</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={field}
                  value={outcome.score}
                  onChange={(e) =>
                    setOutcome((o) => ({
                      ...o,
                      score: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                  placeholder="Optional"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Compared against any minimum a designation requires.
                </p>
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRecording(null)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={record.isPending}
              onClick={() => record.mutate()}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {record.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default EmployeeTrainingSection;
