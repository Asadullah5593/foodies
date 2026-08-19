import React, { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { MdOutlinePriceCheck, MdWarningAmber } from 'react-icons/md';
import apiClient from '../../../utils/apiClient';
import { hrService, LabourCostRow } from '../../../services/api/hrService';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import FetchingOverlay from '../../../components/FetchingOverlay';
import { rupees } from './Payroll';

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const monthEnd = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(
    last.getDate(),
  ).padStart(2, '0')}`;
};

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

/**
 * Colour by how the figure reads operationally, not by an arbitrary scale.
 * Restaurant labour typically runs 20–30% of net sales; past 35% is a problem
 * somebody should already know about.
 */
const percentClass = (p: number | null) => {
  if (p == null) return 'text-gray-500 dark:text-gray-400';
  if (p >= 35) return 'font-semibold text-red-600 dark:text-red-400';
  if (p >= 30) return 'font-semibold text-amber-600 dark:text-amber-400';
  return 'font-semibold text-green-700 dark:text-green-400';
};

const brandLabel = (row: LabourCostRow) =>
  row.brand_name ?? 'Shared (no brand)';

/**
 * Labour cost against sales, per branch and per brand.
 *
 * Two things on this screen are deliberate and easy to misread otherwise:
 * a dash instead of 0% where there were no sales, and a "Shared (no brand)" row
 * for staff who cannot be attributed to one brand. Their cost is real and in the
 * total, but spreading it across brands would quietly distort every brand's
 * percentage.
 */
const LabourCost: React.FC = () => {
  const [filters, setFilters] = useState({
    from: monthStart(),
    to: monthEnd(),
    branch_id: '' as number | '',
  });

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['hr-labour-cost', filters],
    queryFn: () =>
      hrService.labourCostReport({
        from: filters.from,
        to: filters.to,
        branch_id: filters.branch_id === '' ? undefined : Number(filters.branch_id),
      }),
    enabled: filters.from <= filters.to,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex items-center gap-2">
        <MdOutlinePriceCheck className="text-2xl text-gray-700 dark:text-gray-200" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Labour cost vs sales
        </h1>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelClass}>From</label>
          <input
            type="date"
            className={field}
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </div>
        <div>
          <label className={labelClass}>To</label>
          <input
            type="date"
            className={field}
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Branch</label>
          <SearchableSelect
            value={filters.branch_id === '' ? '' : String(filters.branch_id)}
            onChange={(v) =>
              setFilters((f) => ({ ...f, branch_id: v === '' ? '' : Number(v) }))
            }
            options={[
              { value: '', label: 'All branches' },
              ...branches.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            placeholder="All branches"
            searchPlaceholder="Search branches…"
          />
        </div>
      </div>

      {filters.from > filters.to && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">
          The start date is after the end date.
        </p>
      )}

      {isLoading ? (
        <Loader />
      ) : error ? (
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          Could not load the report.
        </p>
      ) : !data ? null : (
        <FetchingOverlay active={isPlaceholderData} label="Updating labour cost…" className="rounded-lg">
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Labour cost', value: rupees(data.totals.labour_cost) },
              { label: 'Net sales', value: rupees(data.totals.net_sales) },
              {
                label: 'Labour %',
                value:
                  data.totals.labour_percent == null
                    ? '—'
                    : `${data.totals.labour_percent}%`,
                tone: percentClass(data.totals.labour_percent),
              },
              { label: 'People paid', value: String(data.totals.headcount) },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {tile.label}
                </div>
                <div
                  className={`mt-1 text-xl ${
                    tile.tone ?? 'font-semibold text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {tile.value}
                </div>
              </div>
            ))}
          </div>

          {data.rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No approved payroll and no completed sales in this period.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Branch</th>
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-3 py-2 text-right">Labour cost</th>
                    <th className="px-3 py-2 text-right">Net sales</th>
                    <th className="px-3 py-2 text-right">Labour %</th>
                    <th className="px-3 py-2 text-right">People</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {data.rows.map((r) => (
                    <tr
                      key={`${r.branch_id}:${r.brand_id ?? 'shared'}`}
                      className="hover:bg-gray-50 dark:hover:bg-slate-800"
                    >
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                        {r.branch_name ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            r.brand_id == null
                              ? 'italic text-gray-500 dark:text-gray-400'
                              : 'text-gray-800 dark:text-gray-200'
                          }
                        >
                          {brandLabel(r)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">
                        {rupees(r.labour_cost)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">
                        {rupees(r.net_sales)}
                      </td>
                      <td className={`px-3 py-2 text-right ${percentClass(r.labour_percent)}`}>
                        {r.labour_percent == null ? '—' : `${r.labour_percent}%`}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                        {r.headcount || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.excluded_partial_runs.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <MdWarningAmber className="mt-0.5 shrink-0 text-lg" />
              <div>
                <p>
                  {data.excluded_partial_runs.length} payroll run
                  {data.excluded_partial_runs.length === 1 ? '' : 's'} straddle this date
                  range and {data.excluded_partial_runs.length === 1 ? 'is' : 'are'} left
                  out — pro-rating a run would invent a number.
                </p>
                <ul className="mt-1 text-xs">
                  {data.excluded_partial_runs.map((r) => (
                    <li key={r.id}>
                      {r.branch_name ?? 'Branch'} · {r.period_from} → {r.period_to}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Labour cost is net payable from <strong>approved and paid</strong> payroll runs
            whose period falls inside the range — a run still being argued over is not a
            cost yet. Sales are completed orders by placed date, before tax and delivery,
            matching the sales reports. Staff with no brand are their own row rather than
            spread across brands.
          </p>
        </FetchingOverlay>
      )}
    </div>
  );
};

export default LabourCost;
