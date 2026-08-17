import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  MdChevronRight,
  MdOutlineDescription,
  MdOutlineNotificationsActive,
  MdOutlineRateReview,
  MdOutlineSchool,
  MdOutlineVerifiedUser,
} from 'react-icons/md';
import { HrAlertRow, hrService } from '../../../services/api/hrService';
import Loader from '../../../components/Loader';

const today = () => new Date().toISOString().slice(0, 10);

/** Days until the date; negative once it has passed. */
const daysAway = (date: string) =>
  Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() -
      new Date(`${today()}T00:00:00Z`).getTime()) /
      86_400_000,
  );

const Countdown: React.FC<{ date: string }> = ({ date }) => {
  const d = daysAway(date);
  if (d < 0)
    return (
      <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
        {Math.abs(d)}d overdue
      </span>
    );
  if (d === 0)
    return (
      <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
        Today
      </span>
    );
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        d <= 7
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
          : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300'
      }`}
    >
      in {d}d
    </span>
  );
};

const Group: React.FC<{
  title: string;
  icon: React.ReactNode;
  empty: string;
  rows: HrAlertRow[];
  onOpen: (row: HrAlertRow) => void;
}> = ({ title, icon, empty, rows, onOpen }) => (
  <section className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
        {icon}
        {title}
      </h2>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          rows.length === 0
            ? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        }`}
      >
        {rows.length}
      </span>
    </div>
    {rows.length === 0 ? (
      <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">{empty}</p>
    ) : (
      <ul className="divide-y divide-gray-100 dark:divide-slate-700">
        {rows.map((r) => (
          <li key={r.dedupeKey}>
            <button
              type="button"
              onClick={() => onOpen(r)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium capitalize text-gray-900 dark:text-gray-100">
                  {r.label}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {r.employeeCode}
                  {r.detail && ` · ${r.detail}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Countdown date={r.date} />
                <MdChevronRight className="text-gray-400" />
              </div>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/**
 * What lapses soon.
 *
 * The same rows drive the admin bell — one endpoint, so the screen and the
 * notifications cannot drift apart. Expired items stay listed rather than
 * dropping off the day they lapse: the ones nobody acted on are exactly the ones
 * worth seeing.
 */
const Alerts: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['hr-alerts'],
    queryFn: () => hrService.listHrAlerts(),
  });

  if (isLoading) return <Loader />;

  const byDate = (rows: HrAlertRow[] = []) =>
    [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const documents = byDate(data?.documents);
  const trainings = byDate(data?.trainings);
  const probations = byDate(data?.probations);
  const reviews = byDate(data?.reviews);
  const total =
    documents.length + trainings.length + probations.length + reviews.length;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex items-center gap-2">
        <MdOutlineNotificationsActive className="text-2xl text-gray-700 dark:text-gray-200" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          HR alerts
        </h1>
        {total > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {total} needing attention
          </span>
        )}
      </div>

      {total === 0 && (
        <p className="mb-4 rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-slate-600 dark:text-gray-400">
          Nothing is lapsing, nobody is stuck on probation, and no scheduled review is
          overdue.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Group
          title="Documents expiring"
          icon={<MdOutlineDescription className="text-base" />}
          empty="No document expires in the next 30 days."
          rows={documents}
          onOpen={(r) => navigate(r.link)}
        />
        <Group
          title="Certificates lapsing"
          icon={<MdOutlineSchool className="text-base" />}
          empty="No training certificate lapses in the next 30 days."
          rows={trainings}
          onOpen={(r) => navigate(r.link)}
        />
        <Group
          title="Probations ending"
          icon={<MdOutlineVerifiedUser className="text-base" />}
          empty="Nobody's probation ends in the next 14 days."
          rows={probations}
          onOpen={(r) => navigate(r.link)}
        />
        <Group
          title="Overdue reviews"
          icon={<MdOutlineRateReview className="text-base" />}
          empty="Every scheduled review is on time."
          rows={reviews}
          onOpen={(r) => navigate(r.link)}
        />
      </div>

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Overdue counts scheduled cycles only — an ad-hoc review is extra and never
        represents a missed cadence. These same conditions are swept nightly into the
        admin bell and clear themselves once resolved.
      </p>
    </div>
  );
};

export default Alerts;
