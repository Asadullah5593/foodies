import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdLogin, MdLogout } from 'react-icons/md';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import { hrService } from '../../../services/api/hrService';

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
const DayPunchesModal: React.FC<Props> = ({ dayId, onClose }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['hr-day-punches', dayId],
    queryFn: () => hrService.getDayPunches(dayId),
  });

  return (
    <Modal isOpen onClose={onClose} title="Punch history" size="large">
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
