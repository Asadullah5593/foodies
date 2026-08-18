import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import SearchableSelect from '../../../../components/SearchableSelect';
import { hrService, OffsPolicyRow } from '../../../../services/api/hrService';
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

const RESOURCE = 'offs-policies';

const SELECTION = [
  { value: 'floating', label: 'Floating — the employee picks the day' },
  { value: 'fixed_weekday', label: 'Fixed weekday' },
];

const BEYOND = [
  { value: 'unpaid', label: 'Unpaid — the day is granted but not paid' },
  { value: 'refuse', label: 'Refuse the request' },
];

const blank = () => ({
  id: undefined as number | undefined,
  branchId: '' as number | '',
  designationId: '' as number | '',
  offsPerMonth: 4,
  offsArePaid: true,
  carryForward: false,
  encashUnused: true,
  offSelection: 'floating',
  beyondQuotaTreatment: 'unpaid',
});

type Form = ReturnType<typeof blank>;

const thisYear = () => new Date().getFullYear();

/**
 * Monthly offs and public holidays.
 *
 * The client's policy is deliberate and unusual: 4 offs a month, paid, no carry
 * forward, and unused ones ENCASHED at the daily rate. Carry-forward and
 * encashment together would pay for the same day twice, so the server refuses
 * that combination rather than quietly preferring one.
 */
const OffsTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);
  const [holiday, setHoliday] = useState<{
    holiday_date: string;
    name: string;
    branch_id: number | '';
    is_paid: boolean;
  } | null>(null);
  const { data: branches = [] } = useBranches();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () => hrService.settingsList<OffsPolicyRow>(RESOURCE, true),
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['hr-public-holidays', thisYear()],
    queryFn: () => hrService.listPublicHolidays(thisYear()),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        branchId: form.branchId === '' ? null : Number(form.branchId),
        designationId:
          form.designationId === '' ? null : Number(form.designationId),
        offsPerMonth: form.offsPerMonth,
        offsArePaid: form.offsArePaid,
        carryForward: form.carryForward,
        encashUnused: form.encashUnused,
        offSelection: form.offSelection,
        beyondQuotaTreatment: form.beyondQuotaTreatment,
      }),
    onSuccess: () => {
      toast.success('Offs policy saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not save the policy'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hrService.settingsRemove(RESOURCE, id),
    onSuccess: () => {
      toast.success('Policy deactivated');
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not deactivate the policy'),
  });

  const addHoliday = useMutation({
    mutationFn: () =>
      hrService.createPublicHoliday({
        holiday_date: holiday!.holiday_date,
        name: holiday!.name.trim(),
        branch_id:
          holiday!.branch_id === '' ? undefined : Number(holiday!.branch_id),
        is_paid: holiday!.is_paid,
      }),
    onSuccess: () => {
      toast.success('Holiday added');
      setHoliday(null);
      queryClient.invalidateQueries({ queryKey: ['hr-public-holidays'] });
    },
    onError: mutationError('Could not add the holiday'),
  });

  const deleteHoliday = useMutation({
    mutationFn: (id: number) => hrService.deletePublicHoliday(id),
    onSuccess: () => {
      toast.success('Holiday removed');
      queryClient.invalidateQueries({ queryKey: ['hr-public-holidays'] });
    },
    onError: mutationError('Could not remove the holiday'),
  });

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            The monthly off entitlement every employee accrues.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setEditing(blank())}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              New offs policy
            </button>
          )}
        </div>

        {isLoading ? (
          <Loader />
        ) : rows.length === 0 ? (
          <EmptyHint>
            No offs policy — nobody accrues monthly offs, and there is nothing to
            encash.
          </EmptyHint>
        ) : (
          <TableShell
            headers={[
              'Applies to',
              'Offs / month',
              'Paid',
              'Unused',
              'Selection',
              'Beyond quota',
              '',
            ]}
          >
            {rows.map((r) => (
              <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
                <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                  {scopeLabel(r.branchId, branches)}
                </td>
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                  {r.offsPerMonth}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {r.offsArePaid ? 'Yes' : 'No'}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {r.encashUnused
                    ? 'Encashed'
                    : r.carryForward
                      ? 'Carried forward'
                      : 'Lapse'}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {r.offSelection === 'floating' ? 'Floating' : 'Fixed weekday'}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {r.beyondQuotaTreatment === 'unpaid' ? 'Unpaid' : 'Refused'}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            id: r.id,
                            branchId: r.branchId ?? '',
                            designationId: r.designationId ?? '',
                            offsPerMonth: r.offsPerMonth,
                            offsArePaid: r.offsArePaid,
                            carryForward: r.carryForward,
                            encashUnused: r.encashUnused,
                            offSelection: r.offSelection,
                            beyondQuotaTreatment: r.beyondQuotaTreatment,
                          })
                        }
                        className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                        aria-label="Edit offs policy"
                      >
                        <MdEdit />
                      </button>
                      {r.isActive && (
                        <button
                          type="button"
                          onClick={() => remove.mutate(r.id)}
                          className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          aria-label="Deactivate offs policy"
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
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
              Public holidays {thisYear()}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              A paid holiday is not deducted and does not consume a monthly off.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() =>
                setHoliday({
                  holiday_date: new Date().toISOString().slice(0, 10),
                  name: '',
                  branch_id: '',
                  is_paid: true,
                })
              }
              className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Add holiday
            </button>
          )}
        </div>

        {holidays.length === 0 ? (
          <EmptyHint>No public holidays recorded for {thisYear()}.</EmptyHint>
        ) : (
          <TableShell headers={['Date', 'Name', 'Applies to', 'Paid', '']}>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td className="px-3 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">
                  {h.holidayDate}
                </td>
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                  {h.name}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {scopeLabel(h.branchId, branches)}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {h.isPaid ? 'Paid' : 'Unpaid'}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => deleteHoliday.mutate(h.id)}
                      className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      aria-label={`Remove ${h.name}`}
                    >
                      <MdDelete />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
        )}
      </section>

      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit offs policy' : 'New offs policy'}
          size="xlarge"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ScopeFields
              branchId={editing.branchId}
              designationId={editing.designationId}
              onBranch={(v) => setEditing({ ...editing, branchId: v })}
              onDesignation={(v) => setEditing({ ...editing, designationId: v })}
            />

            <div>
              <label className={labelClass}>Offs per month</label>
              <input
                type="number"
                min={0}
                max={31}
                className={field}
                value={editing.offsPerMonth}
                onChange={(e) =>
                  setEditing({ ...editing, offsPerMonth: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Pro-rated for anyone who joined or left mid-month.
              </p>
            </div>

            <div>
              <label className={labelClass}>How the day is chosen</label>
              <SearchableSelect
                value={editing.offSelection}
                onChange={(v) => setEditing({ ...editing, offSelection: v })}
                options={SELECTION}
                placeholder="Floating"
                ariaLabel="Off selection"
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Days taken beyond the quota</label>
              <SearchableSelect
                value={editing.beyondQuotaTreatment}
                onChange={(v) =>
                  setEditing({ ...editing, beyondQuotaTreatment: v })
                }
                options={BEYOND}
                placeholder="Unpaid"
                ariaLabel="Beyond quota"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Refusing does not stop the absence — it just moves the argument
                somewhere payroll cannot see.
              </p>
            </div>

            <div className="sm:col-span-2 space-y-3">
              <Toggle
                label="Offs are paid"
                checked={editing.offsArePaid}
                onChange={(v) => setEditing({ ...editing, offsArePaid: v })}
              />
              <Toggle
                label="Unused offs are encashed at the daily rate"
                hint="The client's policy. Cannot be combined with carry-forward — that would pay for the same day twice."
                checked={editing.encashUnused}
                onChange={(v) =>
                  setEditing({
                    ...editing,
                    encashUnused: v,
                    carryForward: v ? false : editing.carryForward,
                  })
                }
              />
              <Toggle
                label="Unused offs carry forward to next month"
                checked={editing.carryForward}
                onChange={(v) =>
                  setEditing({
                    ...editing,
                    carryForward: v,
                    encashUnused: v ? false : editing.encashUnused,
                  })
                }
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
              disabled={save.isPending}
              onClick={() => save.mutate(editing)}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {holiday && (
        <Modal isOpen onClose={() => setHoliday(null)} title="Add a public holiday" size="large">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Date *</label>
              <input
                type="date"
                className={field}
                value={holiday.holiday_date}
                onChange={(e) =>
                  setHoliday({ ...holiday, holiday_date: e.target.value })
                }
              />
            </div>
            <div>
              <label className={labelClass}>Name *</label>
              <input
                className={field}
                value={holiday.name}
                onChange={(e) => setHoliday({ ...holiday, name: e.target.value })}
                placeholder="e.g. Eid al-Fitr"
              />
            </div>
            <div className="sm:col-span-2">
              <ScopeFields
                branchId={holiday.branch_id}
                onBranch={(v) => setHoliday({ ...holiday, branch_id: v })}
              />
            </div>
            <div className="sm:col-span-2">
              <Toggle
                label="Paid holiday"
                checked={holiday.is_paid}
                onChange={(v) => setHoliday({ ...holiday, is_paid: v })}
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setHoliday(null)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={holiday.name.trim() === '' || addHoliday.isPending}
              onClick={() => addHoliday.mutate()}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {addHoliday.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default OffsTab;
