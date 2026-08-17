import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdCalendarMonth, MdChevronLeft, MdChevronRight } from 'react-icons/md';
import apiClient from '../../../utils/apiClient';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';

const BRANCH_KEY = 'hr_roster_branch';

/** Monday of the week containing `date`. */
const weekStart = (date: Date) => {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
};

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    day: d.getDate(),
  };
};

/** What a cell is set to. `null` means "not set" — the default template applies. */
type CellValue = { templateId: number | null; off: boolean; holiday: boolean } | null;

const cellKey = (employeeId: number, date: string) => `${employeeId}|${date}`;

const OFF = 'off';
const HOLIDAY = 'holiday';
const DEFAULT = '';

/**
 * The weekly roster.
 *
 * Nearly every employee here works fixed timings, so most cells are meant to stay
 * empty: an empty cell is not "unrostered", it means the employee's own default
 * template applies — exactly what the attendance engine does when there is no
 * roster row. Saving an empty cell therefore DELETES its row rather than storing
 * a blank one, which is why "Default" is an option rather than a gap.
 *
 * Marking a day off or a holiday makes the register show it as such and stops
 * payroll deducting for it. Someone who punches anyway is still recorded as
 * having worked — the day is flagged, not erased.
 */
const Roster: React.FC = () => {
  const queryClient = useQueryClient();
  const canEdit = useHasPermission('hr-settings:manage');

  const [branchId, setBranchId] = useState<number | ''>(() => {
    const saved = localStorage.getItem(BRANCH_KEY);
    return saved ? Number(saved) : '';
  });
  const [from, setFrom] = useState(() => isoOf(weekStart(new Date())));
  const [draft, setDraft] = useState<Record<string, CellValue>>({});

  const to = addDays(from, 6);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(from, i)),
    [from],
  );

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  // Owners and GMs have no single branch, so the picker is remembered rather
  // than inferred — the same approach the attendance station uses.
  useEffect(() => {
    if (branchId === '' && branches.length > 0) setBranchId(branches[0].id);
  }, [branches, branchId]);

  useEffect(() => {
    if (branchId !== '') localStorage.setItem(BRANCH_KEY, String(branchId));
  }, [branchId]);

  const { data: templates = [] } = useQuery({
    queryKey: ['hr-schedule-templates', branchId],
    queryFn: () => hrService.listScheduleTemplates(Number(branchId)),
    enabled: branchId !== '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['hr-roster', branchId, from],
    queryFn: () =>
      hrService.getRoster({ branch_id: Number(branchId), from, to }),
    enabled: branchId !== '',
  });

  // A week change or a branch change abandons unsaved edits rather than
  // carrying them onto rows they were never meant for.
  useEffect(() => {
    setDraft({});
  }, [from, branchId]);

  const saved = useMemo(() => {
    const map = new Map<string, CellValue>();
    for (const c of data?.cells ?? []) {
      map.set(cellKey(c.employee_id, c.work_date), {
        templateId: c.template_id,
        off: c.is_weekly_off,
        holiday: c.is_holiday,
      });
    }
    return map;
  }, [data]);

  const valueOf = (employeeId: number, date: string): CellValue => {
    const key = cellKey(employeeId, date);
    if (key in draft) return draft[key];
    return saved.get(key) ?? null;
  };

  const selectValue = (v: CellValue): string => {
    if (v == null) return DEFAULT;
    if (v.holiday) return HOLIDAY;
    if (v.off) return OFF;
    return v.templateId != null ? String(v.templateId) : DEFAULT;
  };

  const setCell = (employeeId: number, date: string, raw: string) => {
    const next: CellValue =
      raw === DEFAULT
        ? null
        : raw === OFF
          ? { templateId: null, off: true, holiday: false }
          : raw === HOLIDAY
            ? { templateId: null, off: false, holiday: true }
            : { templateId: Number(raw), off: false, holiday: false };
    setDraft((d) => ({ ...d, [cellKey(employeeId, date)]: next }));
  };

  const dirtyCount = Object.keys(draft).filter((key) => {
    const current = draft[key];
    const original = saved.get(key) ?? null;
    return selectValue(current) !== selectValue(original);
  }).length;

  const save = useMutation({
    mutationFn: () => {
      const cells = Object.entries(draft)
        .filter(([key, value]) => selectValue(value) !== selectValue(saved.get(key) ?? null))
        .map(([key, value]) => {
          const [employeeId, workDate] = key.split('|');
          return {
            employee_id: Number(employeeId),
            work_date: workDate,
            template_id: value?.templateId ?? null,
            is_weekly_off: value?.off ?? false,
            is_holiday: value?.holiday ?? false,
          };
        });
      return hrService.saveRoster({ branch_id: Number(branchId), cells });
    },
    onSuccess: (result) => {
      toast.success(
        `Roster saved — ${result.written} set, ${result.cleared} back to default`,
      );
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ['hr-roster'] });
      // The register reads the same days.
      queryClient.invalidateQueries({ queryKey: ['hr-attendance-register'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not save the roster';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const options = [
    { value: DEFAULT, label: 'Default shift' },
    ...templates.map((t) => ({
      value: String(t.id),
      label: `${t.name} (${t.startTime.slice(0, 5)}–${t.endTime.slice(0, 5)})`,
    })),
    { value: OFF, label: 'Day off' },
    { value: HOLIDAY, label: 'Holiday' },
  ];

  const cellClass = (v: CellValue) => {
    if (v == null) return 'text-gray-500 dark:text-gray-400';
    if (v.holiday) return 'bg-purple-50 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300';
    if (v.off) return 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-200';
    return 'bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200';
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdCalendarMonth className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Roster</h1>
        </div>
        {canEdit && (
          <button
            type="button"
            disabled={dirtyCount === 0 || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {save.isPending
              ? 'Saving…'
              : dirtyCount === 0
                ? 'No changes'
                : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Branch
          </label>
          <SearchableSelect
            value={branchId === '' ? '' : String(branchId)}
            onChange={(v) => setBranchId(v === '' ? '' : Number(v))}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            placeholder="Select a branch"
            searchPlaceholder="Search branches…"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFrom(addDays(from, -7))}
            className="rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            aria-label="Previous week"
          >
            <MdChevronLeft />
          </button>
          <span className="px-2 text-sm text-gray-700 dark:text-gray-300">
            {from} → {to}
          </span>
          <button
            type="button"
            onClick={() => setFrom(addDays(from, 7))}
            className="rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            aria-label="Next week"
          >
            <MdChevronRight />
          </button>
          <button
            type="button"
            onClick={() => setFrom(isoOf(weekStart(new Date())))}
            className="ml-1 rounded-md border border-gray-300 px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            This week
          </button>
        </div>
      </div>

      {branchId === '' ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Pick a branch to see its roster.
        </p>
      ) : isLoading ? (
        <Loader />
      ) : (data?.employees.length ?? 0) === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Nobody is assigned to this branch in this week.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 dark:bg-slate-800">
                  Employee
                </th>
                {dates.map((d) => {
                  const { weekday, day } = dayLabel(d);
                  return (
                    <th key={d} className="px-2 py-2 text-center">
                      <div>{weekday}</div>
                      <div className="text-sm font-normal text-gray-700 dark:text-gray-300">
                        {day}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {data!.employees.map((emp) => (
                <tr key={emp.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-slate-900">
                    <div className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                      {emp.full_name}
                    </div>
                    <div className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                      {emp.employee_code}
                      {emp.designation_name && ` · ${emp.designation_name}`}
                    </div>
                  </td>
                  {dates.map((d) => {
                    const v = valueOf(emp.id, d);
                    return (
                      <td key={d} className="px-1 py-1 align-top">
                        <select
                          disabled={!canEdit}
                          value={selectValue(v)}
                          onChange={(e) => setCell(emp.id, d, e.target.value)}
                          className={`w-full min-w-[7.5rem] rounded border border-gray-200 px-1.5 py-1 text-xs disabled:opacity-70 dark:border-slate-600 ${cellClass(v)}`}
                        >
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        <strong>Default shift</strong> is not a gap — it means the employee&apos;s own
        template applies, which is how nearly everyone is scheduled today. Saving a cell
        back to Default deletes its roster row. A day off or holiday shows as such on the
        register and is not deducted; somebody who punches on it is still recorded as
        having worked, and the day is flagged.
      </p>
    </div>
  );
};

export default Roster;
