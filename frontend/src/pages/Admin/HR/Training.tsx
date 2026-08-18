import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { MdDelete, MdOutlineSchool, MdWarningAmber } from 'react-icons/md';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import Modal from '../../../components/Modal';
import SearchableSelect from '../../../components/SearchableSelect';

const TABS = [
  { key: 'programs', label: 'Programs' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'expiring', label: 'Expiring certificates' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

const mutationError = (fallback: string) => (err: unknown) => {
  const message =
    (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
      ?.message ?? fallback;
  toast.error(Array.isArray(message) ? message[0] : message);
};

/** New program. Code is derived from the name unless the client wants their own. */
const ProgramModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    category: '',
    level: 1,
    duration_hours: 0,
    validity_months: '' as number | '',
    is_mandatory: false,
  });

  const mutation = useMutation({
    mutationFn: () =>
      hrService.createTrainingProgram({
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        level: form.level,
        duration_hours: form.duration_hours,
        validity_months:
          form.validity_months === '' ? undefined : Number(form.validity_months),
        is_mandatory: form.is_mandatory,
      }),
    onSuccess: () => {
      toast.success('Program created');
      queryClient.invalidateQueries({ queryKey: ['hr-training-programs'] });
      onClose();
    },
    onError: mutationError('Could not create the program'),
  });

  return (
    <Modal isOpen onClose={onClose} title="New training program" size="xlarge">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Name *</label>
          <input
            className={field}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Food handling & hygiene"
          />
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <input
            className={field}
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="e.g. Compliance"
          />
        </div>
        <div>
          <label className={labelClass}>Level</label>
          <input
            type="number"
            min={1}
            className={field}
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Orders the ladder — level 2 normally follows level 1.
          </p>
        </div>
        <div>
          <label className={labelClass}>Duration (hours)</label>
          <input
            type="number"
            min={0}
            step="0.5"
            className={field}
            value={form.duration_hours}
            onChange={(e) =>
              setForm((f) => ({ ...f, duration_hours: Number(e.target.value) }))
            }
          />
        </div>
        <div>
          <label className={labelClass}>Valid for (months)</label>
          <input
            type="number"
            min={1}
            className={field}
            value={form.validity_months}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                validity_months: e.target.value === '' ? '' : Number(e.target.value),
              }))
            }
            placeholder="Leave blank if it never expires"
          />
        </div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={form.is_mandatory}
            onChange={(e) => setForm((f) => ({ ...f, is_mandatory: e.target.checked }))}
          />
          Mandatory for all staff
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={form.name.trim() === '' || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {mutation.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Modal>
  );
};

/**
 * Training programs, what each designation requires, and what is about to lapse.
 *
 * Requirements are what make the review form's readiness panel mean anything —
 * with none configured, every promotion reads as "ready". They warn, never block
 * (decision #16).
 */
const Training: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = useHasPermission('training:manage');
  const [tab, setTab] = useState<TabKey>('programs');
  const [showProgram, setShowProgram] = useState(false);
  const [newReq, setNewReq] = useState({
    designation_id: '' as number | '',
    program_id: '' as number | '',
    min_score: '' as number | '',
  });

  const { data: programs = [], isLoading: loadingPrograms } = useQuery({
    queryKey: ['hr-training-programs'],
    queryFn: () => hrService.listTrainingPrograms(),
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrService.listDesignations(),
  });

  const { data: requirements = [], isLoading: loadingReqs } = useQuery({
    queryKey: ['hr-training-requirements'],
    queryFn: () => hrService.listTrainingRequirements(),
    enabled: tab === 'requirements',
  });

  const { data: expiring = [], isLoading: loadingExpiring } = useQuery({
    queryKey: ['hr-training-expiring'],
    queryFn: () => hrService.listExpiringTrainings(60),
    enabled: tab === 'expiring',
  });

  const addRequirement = useMutation({
    mutationFn: () =>
      hrService.setTrainingRequirement({
        designation_id: Number(newReq.designation_id),
        program_id: Number(newReq.program_id),
        required_for: 'promotion_into',
        min_score: newReq.min_score === '' ? undefined : Number(newReq.min_score),
      }),
    onSuccess: (result) => {
      toast.success(result.updated ? 'Requirement updated' : 'Requirement added');
      setNewReq({ designation_id: '', program_id: '', min_score: '' });
      queryClient.invalidateQueries({ queryKey: ['hr-training-requirements'] });
    },
    onError: mutationError('Could not save the requirement'),
  });

  const removeRequirement = useMutation({
    mutationFn: (id: number) => hrService.removeTrainingRequirement(id),
    onSuccess: () => {
      toast.success('Requirement removed');
      queryClient.invalidateQueries({ queryKey: ['hr-training-requirements'] });
    },
    onError: mutationError('Could not remove the requirement'),
  });

  const designationName = useMemo(() => {
    const map = new Map(designations.map((d) => [d.id, d.name]));
    return (id: number) => map.get(id) ?? `#${id}`;
  }, [designations]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdOutlineSchool className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Training
          </h1>
        </div>
        {canManage && tab === 'programs' && (
          <button
            type="button"
            onClick={() => setShowProgram(true)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New program
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === t.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'programs' &&
        (loadingPrograms ? (
          <Loader />
        ) : programs.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              No training programs yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Program</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Level</th>
                  <th className="px-3 py-2">Hours</th>
                  <th className="px-3 py-2">Validity</th>
                  <th className="px-3 py-2">Mandatory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                {programs.map((p, i) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {p.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {p.code}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {p.category ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {p.level}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {p.durationHours || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {p.validityMonths ? `${p.validityMonths} months` : 'No expiry'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                      {p.isMandatory ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'requirements' && (
        <div className="space-y-5">
          {canManage && (
            <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                Require a program for a designation
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className={labelClass}>Designation</label>
                  <SearchableSelect
                    value={
                      newReq.designation_id === '' ? '' : String(newReq.designation_id)
                    }
                    onChange={(v) =>
                      setNewReq((r) => ({
                        ...r,
                        designation_id: v === '' ? '' : Number(v),
                      }))
                    }
                    options={designations.map((d) => ({
                      value: String(d.id),
                      label: `${d.name} (level ${d.level})`,
                    }))}
                    placeholder="Select"
                    searchPlaceholder="Search designations…"
                  />
                </div>
                <div>
                  <label className={labelClass}>Program</label>
                  <SearchableSelect
                    value={newReq.program_id === '' ? '' : String(newReq.program_id)}
                    onChange={(v) =>
                      setNewReq((r) => ({ ...r, program_id: v === '' ? '' : Number(v) }))
                    }
                    options={programs.map((p) => ({
                      value: String(p.id),
                      label: p.name,
                    }))}
                    placeholder="Select"
                    searchPlaceholder="Search programs…"
                  />
                </div>
                <div>
                  <label className={labelClass}>Minimum score</label>
                  <input
                    type="number"
                    min={0}
                    className={field}
                    value={newReq.min_score}
                    onChange={(e) =>
                      setNewReq((r) => ({
                        ...r,
                        min_score: e.target.value === '' ? '' : Number(e.target.value),
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={
                      newReq.designation_id === '' ||
                      newReq.program_id === '' ||
                      addRequirement.isPending
                    }
                    onClick={() => addRequirement.mutate()}
                    className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {addRequirement.isPending ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Shown on the review form when someone is promoted into this designation.
                A gap warns the reviewer; it never blocks the promotion.
              </p>
            </div>
          )}

          {loadingReqs ? (
            <Loader />
          ) : requirements.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No requirements configured — every promotion will read as
                training-ready.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Designation</th>
                    <th className="px-3 py-2">Program</th>
                    <th className="px-3 py-2">Required for</th>
                    <th className="px-3 py-2">Min score</th>
                    {canManage && <th className="px-3 py-2 text-right">Remove</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {requirements.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                        {r.designation?.name ?? designationName(r.designationId)}
                      </td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                        {r.program?.name ?? `#${r.programId}`}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        {r.requiredFor === 'promotion_into'
                          ? 'Promotion into role'
                          : 'Holding the role'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        {r.minScore ?? '—'}
                      </td>
                      {canManage && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeRequirement.mutate(r.id)}
                            className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                            aria-label="Remove requirement"
                          >
                            <MdDelete />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'expiring' &&
        (loadingExpiring ? (
          <Loader />
        ) : expiring.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Nothing lapses in the next 60 days.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <MdWarningAmber className="mt-0.5 shrink-0 text-lg" />
              <p>
                A certificate that lapses stops counting toward a promotion, and for
                compliance courses it stops counting full stop. Re-assign the program to
                restart it.
              </p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Program</th>
                    <th className="px-3 py-2">Expires</th>
                    <th className="px-3 py-2 text-right">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {expiring.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <div className="text-gray-900 dark:text-gray-100">
                          {r.employee?.fullName ?? '—'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {r.employee?.employeeCode}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                        {r.program?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-amber-700 dark:text-amber-400">
                        {r.expiresOn}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.employee && (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/admin/hr/employees/${r.employee!.id}`)
                            }
                            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
                          >
                            Open record
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {showProgram && <ProgramModal onClose={() => setShowProgram(false)} />}
    </div>
  );
};

export default Training;
