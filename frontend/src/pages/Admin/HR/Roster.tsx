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

const DEFAULT = '';
const OFF = 'off';
const HOLIDAY = 'holiday';

const parseValue = (raw: string): CellValue =>
  raw === DEFAULT
    ? null
    : raw === OFF
      ? { templateId: null, off: true, holiday: false }
      : raw === HOLIDAY
        ? { templateId: null, off: false, holiday: true }
        : { templateId: Number(raw), off: false, holiday: false };

const serializeValue = (v: CellValue): string => {
  if (v == null) return DEFAULT;
  if (v.holiday) return HOLIDAY;
  if (v.off) return OFF;
  return v.templateId != null ? String(v.templateId) : DEFAULT;
};

/**
 * The weekly roster.
 *
 * Cells are SELECTED and then set from one control, rather than each cell being
 * its own dropdown. Two reasons: rostering is bulk work — "everyone off on
 * Sunday" is one action, not twelve — and a per-cell dropdown panel would be
 * clipped by the grid's own horizontal scroll container.
 *
 * An empty cell is not "unrostered": it means the employee's own default
 * template applies, which is exactly what the attendance engine does when there
 * is no roster row. Setting a cell back to Default therefore DELETES its row
 * rather than storing a blank one that would shadow the default.
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingValue, setPendingValue] = useState<string>(DEFAULT);

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

  // A week or branch change abandons unsaved edits rather than carrying them
  // onto rows they were never meant for.
  useEffect(() => {
    setDraft({});
    setSelected(new Set());
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

  const templateName = (id: number | null) =>
    templates.find((t) => t.id === id)?.name ?? 'Shift';

  const cellLabel = (v: CellValue) => {
    if (v == null) return 'Default';
    if (v.holiday) return 'Holiday';
    if (v.off) return 'Day off';
    return templateName(v.templateId);
  };

  const cellClass = (v: CellValue, isSelected: boolean) => {
    const base = isSelected ? 'ring-2 ring-blue-500 ' : '';
    if (v == null)
      return `${base}bg-white text-gray-500 dark:bg-slate-900 dark:text-gray-400`;
    if (v.holiday)
      return `${base}bg-purple-50 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300`;
    if (v.off)
      return `${base}bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-200`;
    return `${base}bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200`;
  };

  const toggleCell = (key: string) => {
    if (!canEdit) return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleMany = (keys: string[]) => {
    if (!canEdit) return;
    setSelected((s) => {
      const next = new Set(s);
      const allSelected = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const applyToSelection = () => {
    if (selected.size === 0) return;
    const value = parseValue(pendingValue);
    setDraft((d) => {
      const next = { ...d };
      for (const key of selected) next[key] = value;
      return next;
    });
    setSelected(new Set());
  };

  const changedKeys = Object.keys(draft).filter(
    (key) => serializeValue(draft[key]) !== serializeValue(saved.get(key) ?? null),
  );

  const save = useMutation({
    mutationFn: () =>
      hrService.saveRoster({
        branch_id: Number(branchId),
        cells: changedKeys.map((key) => {
          const [employeeId, workDate] = key.split('|');
          const value = draft[key];
          return {
            employee_id: Number(employeeId),
            work_date: workDate,
            template_id: value?.templateId ?? null,
            is_weekly_off: value?.off ?? false,
            is_holiday: value?.holiday ?? false,
          };
        }),
      }),
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

  const valueOptions = [
    { value: DEFAULT, label: 'Default shift (clears the cell)' },
    ...templates.map((t) => ({
      value: String(t.id),
      label: `${t.name} (${t.startTime.slice(0, 5)}–${t.endTime.slice(0, 5)})`,
    })),
    { value: OFF, label: 'Day off' },
    { value: HOLIDAY, label: 'Holiday' },
  ];

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
            disabled={changedKeys.length === 0 || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {save.isPending
              ? 'Saving…'
              : changedKeys.length === 0
                ? 'No changes'
                : `Save ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}`}
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
            ariaLabel="Branch"
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

      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
          <div className="min-w-[260px]">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Set selected cells to
            </label>
            <SearchableSelect
              value={pendingValue}
              onChange={setPendingValue}
              options={valueOptions}
              placeholder="Choose a shift"
              searchPlaceholder="Search shifts…"
              ariaLabel="Value to apply"
            />
          </div>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={applyToSelection}
            className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            Apply to {selected.size} cell{selected.size === 1 ? '' : 's'}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Clear selection
            </button>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Click cells to select. Click a day heading or a name to take the whole column
            or row.
          </p>
        </div>
      )}

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
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() =>
                          toggleMany(
                            (data?.employees ?? []).map((e) => cellKey(e.id, d)),
                          )
                        }
                        className="w-full rounded px-1 py-0.5 hover:bg-gray-200 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-700"
                        title="Select this whole day"
                      >
                        <div>{weekday}</div>
                        <div className="text-sm font-normal text-gray-700 dark:text-gray-300">
                          {day}
                        </div>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {data!.employees.map((emp) => (
                <tr key={emp.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-slate-900">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        toggleMany(dates.map((d) => cellKey(emp.id, d)))
                      }
                      className="text-left disabled:cursor-default"
                      title="Select this whole week for this employee"
                    >
                      <div className="whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                        {emp.full_name}
                      </div>
                      <div className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {emp.employee_code}
                        {emp.designation_name && ` · ${emp.designation_name}`}
                      </div>
                    </button>
                  </td>
                  {dates.map((d) => {
                    const key = cellKey(emp.id, d);
                    const v = valueOf(emp.id, d);
                    const isSelected = selected.has(key);
                    return (
                      <td key={d} className="px-1 py-1 text-center align-middle">
                        <button
                          type="button"
                          disabled={!canEdit}
                          aria-pressed={isSelected}
                          onClick={() => toggleCell(key)}
                          className={`w-full min-w-[6.5rem] rounded border border-gray-200 px-1.5 py-2 text-xs disabled:cursor-default dark:border-slate-600 ${cellClass(
                            v,
                            isSelected,
                          )}`}
                        >
                          {cellLabel(v)}
                        </button>
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
        <strong>Default</strong> is not a gap — it means the employee&apos;s own template
        applies, which is how nearly everyone is scheduled today. Setting a cell back to
        Default deletes its roster row. A day off or holiday shows as such on the register
        and is not deducted; somebody who punches on it is still recorded as having worked,
        and the day is flagged.
      </p>
    </div>
  );
};

export default Roster;
