import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import {
  hrService,
  ScheduleTemplateFull,
} from '../../../../services/api/hrService';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import {
  EmptyHint,
  ScopeFields,
  TableShell,
  Toggle,
  field,
  labelClass,
  mutationError,
  scopeLabel,
  useBranches,
} from './settingsShared';

const RESOURCE = 'schedule-templates';

const blank = () => ({
  id: undefined as number | undefined,
  branchId: '' as number | '',
  designationId: '' as number | '',
  name: '',
  startTime: '11:00',
  endTime: '20:00',
  breakMinutes: 60,
  graceMinutes: 15,
  halfDayAfterLateMinutes: 120 as number | '',
  minMinutesFullDay: 480,
  minMinutesHalfDay: 270,
  overtimeAfterMinutes: 30,
  attributionLeadHours: 6,
  attributionTrailHours: 6,
  isDefault: false,
});

type Form = ReturnType<typeof blank>;

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Shift templates — what attendance is judged against.
 *
 * `crossesMidnight` is deliberately absent from this form: the server derives it
 * from the times. A template wrongly flagged as crossing midnight computes a
 * 33-hour scheduled day, which zeroes everyone's overtime, and that has already
 * happened once from a seed.
 */
const SchedulesTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);
  const { data: branches = [] } = useBranches();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () => hrService.settingsList<ScheduleTemplateFull>(RESOURCE, true),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        branchId: form.branchId === '' ? null : Number(form.branchId),
        designationId:
          form.designationId === '' ? null : Number(form.designationId),
        name: form.name.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        breakMinutes: form.breakMinutes,
        graceMinutes: form.graceMinutes,
        halfDayAfterLateMinutes:
          form.halfDayAfterLateMinutes === ''
            ? null
            : Number(form.halfDayAfterLateMinutes),
        minMinutesFullDay: form.minMinutesFullDay,
        minMinutesHalfDay: form.minMinutesHalfDay,
        overtimeAfterMinutes: form.overtimeAfterMinutes,
        attributionLeadHours: form.attributionLeadHours,
        attributionTrailHours: form.attributionTrailHours,
        isDefault: form.isDefault,
      }),
    onSuccess: () => {
      toast.success('Shift template saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-templates'] });
    },
    onError: mutationError('Could not save the template'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hrService.settingsRemove(RESOURCE, id),
    onSuccess: () => {
      toast.success('Template deactivated');
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not deactivate the template'),
  });

  const openEdit = (row: ScheduleTemplateFull) =>
    setEditing({
      id: row.id,
      branchId: row.branchId ?? '',
      designationId: row.designationId ?? '',
      name: row.name,
      startTime: hhmm(row.startTime),
      endTime: hhmm(row.endTime),
      breakMinutes: row.breakMinutes,
      graceMinutes: row.graceMinutes,
      halfDayAfterLateMinutes: row.halfDayAfterLateMinutes ?? '',
      minMinutesFullDay: row.minMinutesFullDay,
      minMinutesHalfDay: row.minMinutesHalfDay,
      overtimeAfterMinutes: row.overtimeAfterMinutes,
      attributionLeadHours: row.attributionLeadHours,
      attributionTrailHours: row.attributionTrailHours,
      isDefault: row.isDefault,
    });

  const crossesMidnight =
    editing != null && editing.endTime < editing.startTime;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          The hours an employee is expected to work, and the thresholds attendance is
          scored against.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New shift
          </button>
        )}
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyHint>
          No shift templates. Attendance cannot be scored without one — every day
          would read as &ldquo;no schedule&rdquo;.
        </EmptyHint>
      ) : (
        <TableShell
          headers={[
            'Name',
            'Applies to',
            'Hours',
            'Grace',
            'Half day after',
            'Full day',
            'OT after',
            '',
          ]}
        >
          {rows.map((r) => (
            <tr
              key={r.id}
              className={r.isActive ? '' : 'opacity-50'}
            >
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {r.name}
                </div>
                {r.isDefault && (
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    Branch default
                  </span>
                )}
                {!r.isActive && (
                  <span className="ml-1 text-xs text-gray-500">· inactive</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {scopeLabel(r.branchId, branches)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-gray-800 dark:text-gray-200">
                {hhmm(r.startTime)}–{hhmm(r.endTime)}
                {r.crossesMidnight && (
                  <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                    +1d
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.graceMinutes}m
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.halfDayAfterLateMinutes ? `${r.halfDayAfterLateMinutes}m` : '—'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.minMinutesFullDay}m
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.overtimeAfterMinutes}m
              </td>
              <td className="px-3 py-2 text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                      aria-label={`Edit ${r.name}`}
                    >
                      <MdEdit />
                    </button>
                    {r.isActive && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(r.id)}
                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label={`Deactivate ${r.name}`}
                      >
                        <MdDelete />
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit shift template' : 'New shift template'}
          size="xlarge"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Name *</label>
              <input
                className={field}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="e.g. Morning 11:00–20:00"
              />
            </div>

            <ScopeFields
              branchId={editing.branchId}
              designationId={editing.designationId}
              onBranch={(v) => setEditing({ ...editing, branchId: v })}
              onDesignation={(v) => setEditing({ ...editing, designationId: v })}
            />

            <div>
              <label className={labelClass} htmlFor="shift-start">
                Starts *
              </label>
              <input
                id="shift-start"
                type="time"
                className={field}
                value={editing.startTime}
                onChange={(e) =>
                  setEditing({ ...editing, startTime: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="shift-end">
                Ends *
              </label>
              <input
                id="shift-end"
                type="time"
                className={field}
                value={editing.endTime}
                onChange={(e) =>
                  setEditing({ ...editing, endTime: e.target.value })
                }
              />
              {crossesMidnight && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Ends the next day — punches are attributed to the day the shift
                  started.
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>Unpaid break (minutes)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.breakMinutes}
                onChange={(e) =>
                  setEditing({ ...editing, breakMinutes: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className={labelClass}>Grace (minutes)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.graceMinutes}
                onChange={(e) =>
                  setEditing({ ...editing, graceMinutes: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Arriving inside this window is not late at all.
              </p>
            </div>

            <div>
              <label className={labelClass}>Half day after (minutes late)</label>
              <input
                type="number"
                min={1}
                className={field}
                value={editing.halfDayAfterLateMinutes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    halfDayAfterLateMinutes:
                      e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="Blank disables the rule"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Applies regardless of hours worked — staying late does not undo
                nobody covering the counter at opening.
              </p>
            </div>
            <div>
              <label className={labelClass}>Overtime after (minutes)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.overtimeAfterMinutes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    overtimeAfterMinutes: Number(e.target.value),
                  })
                }
              />
            </div>

            <div>
              <label className={labelClass}>Minutes for a full day</label>
              <input
                type="number"
                min={1}
                className={field}
                value={editing.minMinutesFullDay}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    minMinutesFullDay: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className={labelClass}>Minutes for a half day</label>
              <input
                type="number"
                min={1}
                className={field}
                value={editing.minMinutesHalfDay}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    minMinutesHalfDay: Number(e.target.value),
                  })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Below this still counts as half a day — somebody who showed up is
                never marked absent.
              </p>
            </div>

            <div>
              <label className={labelClass}>Punch window before (hours)</label>
              <input
                type="number"
                min={0}
                max={23}
                className={field}
                value={editing.attributionLeadHours}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    attributionLeadHours: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className={labelClass}>Punch window after (hours)</label>
              <input
                type="number"
                min={0}
                max={23}
                className={field}
                value={editing.attributionTrailHours}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    attributionTrailHours: Number(e.target.value),
                  })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                How long after the shift a clock-out still belongs to it — the
                setting that makes a 02:00 close work.
              </p>
            </div>

            <div className="sm:col-span-2">
              <Toggle
                label="Use as the default for this scope"
                hint="Employees with no template of their own fall back to it."
                checked={editing.isDefault}
                onChange={(v) => setEditing({ ...editing, isDefault: v })}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={editing.name.trim() === '' || save.isPending}
              onClick={() => save.mutate(editing)}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default SchedulesTab;
