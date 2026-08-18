import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdLogin, MdLogout } from 'react-icons/md';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';

interface Props {
  dayId: number;
  onClose: () => void;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString();
const mins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * Every punch of one day, and the sessions they pair into.
 *
 * Several in/out pairs a day are normal — breaks, split shifts — and the total
 * is the SUM of the sessions, not last-out minus first-in. Showing both the
 * pairs and the raw punches is how a manager checks a disputed figure, and how a
 * forgotten clock-out becomes obvious.
 */
/** `datetime-local` wants local wall time, not an ISO instant. */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

const DayPunchesModal: React.FC<Props> = ({ dayId, onClose }) => {
  const queryClient = useQueryClient();
  const canCorrect = useHasPermission('attendance:approve');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ first_in_at: '', last_out_at: '', reason: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['hr-day-punches', dayId],
    queryFn: () => hrService.getDayPunches(dayId),
  });

  const correct = useMutation({
    mutationFn: () =>
      hrService.correctDayTimes(dayId, {
        // Sent as instants; the input gives local wall time.
        first_in_at: form.first_in_at
          ? new Date(form.first_in_at).toISOString()
          : undefined,
        last_out_at: form.last_out_at
          ? new Date(form.last_out_at).toISOString()
          : undefined,
        reason: form.reason.trim(),
      }),
    onSuccess: (r) => {
      toast.success(`Corrected — ${r.status.replace('_', ' ')}, ${r.worked_minutes} min`);
      queryClient.invalidateQueries({ queryKey: ['hr-day-punches', dayId] });
      queryClient.invalidateQueries({ queryKey: ['hr-attendance-register'] });
      queryClient.invalidateQueries({ queryKey: ['hr-attendance-exceptions'] });
      setEditing(false);
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not correct the times';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const openEditor = () => {
    const firstIn = data?.sessions[0]?.in_at ?? null;
    const lastOut = data?.sessions[data.sessions.length - 1]?.out_at ?? null;
    setForm({
      first_in_at: toLocalInput(firstIn),
      last_out_at: toLocalInput(lastOut),
      reason: '',
    });
    setEditing(true);
  };

  return (
    <Modal isOpen onClose={onClose} title="Punch history" size="xlarge">
      {isLoading || !data ? (
        <Loader />
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {data.work_date} · {mins(data.worked_minutes)} worked across{' '}
            {data.sessions.length} session(s)
            {data.open_session && ' · one session still open'}
          </p>

          {data.sessions.length > 0 && (
            <div className="mb-5 rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">In</th>
                    <th className="px-3 py-2">Out</th>
                    <th className="px-3 py-2">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {data.sessions.map((s, i) => (
                    <tr key={`${s.in_at}-${i}`}>
                      <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2">{time(s.in_at)}</td>
                      <td className="px-3 py-2">{time(s.out_at)}</td>
                      <td className="px-3 py-2">{mins(s.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            All punches
          </h3>
          <ul className="space-y-2">
            {data.punches.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded border border-gray-200 px-3 py-2 text-sm dark:border-slate-700"
              >
                {p.punch_type === 'in' ? (
                  <MdLogin className="text-green-600" />
                ) : (
                  <MdLogout className="text-gray-500" />
                )}
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {p.punch_type === 'in' ? 'Clock in' : 'Clock out'}
                </span>
                <span className="text-gray-700 dark:text-gray-300">
                  {time(p.punched_at)}
                </span>
                <span className="text-xs text-gray-500">
                  {p.method === 'qr_card'
                    ? 'card'
                    : p.method === 'manager'
                      ? 'recorded by manager'
                      : 'PIN'}
                  {p.station_id != null && ` · device #${p.station_id}`}
                  {p.pos_user && ` · till: ${p.pos_user.name}`}
                </span>
                {p.photo_url && (
                  <a
                    href={p.photo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    photo
                  </a>
                )}
                {p.note && (
                  <span className="text-xs italic text-gray-500">{p.note}</span>
                )}
              </li>
            ))}
          </ul>

          {canCorrect && !editing && (
            <button
              type="button"
              onClick={openEditor}
              className="mt-4 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Correct times
            </button>
          )}

          {editing && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-slate-700">
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                This changes what the DAY says, not what was punched. The original
                punches stay above, and the correction is recorded with your name
                and reason.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs uppercase text-gray-500">
                    Clock in
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
                    value={form.first_in_at}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, first_in_at: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase text-gray-500">
                    Clock out
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
                    value={form.last_out_at}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, last_out_at: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase text-gray-500">
                    Reason *
                  </label>
                  <input
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
                    placeholder="e.g. forgot to clock out"
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    form.reason.trim().length < 3 ||
                    (!form.first_in_at && !form.last_out_at) ||
                    correct.isPending
                  }
                  onClick={() => correct.mutate()}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {correct.isPending ? 'Saving…' : 'Save correction'}
                </button>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Punches are never edited or deleted. Corrections are recorded
            separately against the day, so what the machine saw and what a human
            decided stay independently readable.
          </p>
        </>
      )}
    </Modal>
  );
};

export default DayPunchesModal;
