import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { adminService } from '../../../services/api/adminService';
import { RiderProfile } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import RiderHrmHeader from './RiderHrmHeader';
import { inputClass, useRiders } from './shared';
import { useSensitivePageView } from '../../../hooks/useSensitivePageView';

/**
 * One-page base-salary CRUD: every rider in a table with their current salary,
 * edited through a prefilled dialog. Only user_id + base_salary are ever sent
 * (the upsert is partial), so a rider's other HR fields — hidden from the UI
 * for now — are never touched. Supersedes the RiderProfiles form +
 * RiderProfilesList pair; both files are kept unrouted for an easy restore.
 */

/** A table row: an assignable rider, or an orphan profile (see rows memo). */
type SalaryRow = {
  id: number;
  name: string;
  phone: string | null;
  /** Saved profile exists but the rider is no longer active/brand-linked. */
  orphan: boolean;
};

// The Modal panel is always white (no dark variant), so the dialog uses
// light-theme classes only — the shared dark:-classed ones would render
// light-gray-on-white text and a dark input box in dark mode.
const dialogLabelClass = 'block text-sm font-medium text-gray-700 mb-1';
const dialogInputClass =
  'w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-red-500';

const RiderProfilesTable: React.FC = () => {
  // Opening this screen is itself worth recording — see the hook.
  useSensitivePageView('rider-profiles');
  const queryClient = useQueryClient();
  const canEdit = useHasPermission('rider-profiles:edit');

  const {
    data: riders,
    isLoading: ridersLoading,
    isError: ridersError,
    refetch: refetchRiders,
  } = useRiders();
  const {
    data: profiles,
    isLoading: profilesLoading,
    isError: profilesError,
    refetch: refetchProfiles,
  } = useQuery({
    queryKey: ['rider-profiles'],
    queryFn: () => adminService.getRiderProfiles(),
  });

  const profileByUserId = useMemo(() => {
    const map = new Map<number, RiderProfile>();
    for (const p of profiles ?? []) map.set(p.user_id, p);
    return map;
  }, [profiles]);

  // Assignable riders first, then "orphan" profiles — saved salaries whose
  // rider the riders endpoint no longer returns (deactivated user or all
  // brand links removed). Without these rows an existing salary would be
  // invisible and uneditable here while payroll still uses it.
  const rows = useMemo<SalaryRow[]>(() => {
    const out: SalaryRow[] = (riders ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      orphan: false,
    }));
    const known = new Set(out.map((r) => r.id));
    for (const p of profiles ?? []) {
      if (!known.has(p.user_id)) {
        out.push({
          id: p.user_id,
          name: p.user_name ?? `Rider #${p.user_id}`,
          phone: null,
          orphan: true,
        });
      }
    }
    return out;
  }, [riders, profiles]);

  const [search, setSearch] = useState('');
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.phone ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  /** Rider being edited (dialog open) and the salary input value. */
  const [editing, setEditing] = useState<SalaryRow | null>(null);
  const [salaryInput, setSalaryInput] = useState('');

  const openEditor = (row: SalaryRow) => {
    const current = profileByUserId.get(row.id)?.base_salary;
    setSalaryInput(current != null ? String(current) : '');
    setEditing(row);
  };
  const closeEditor = () => setEditing(null);

  const salaryNumber = Number(salaryInput);
  const salaryValid = salaryInput.trim() !== '' && Number.isFinite(salaryNumber) && salaryNumber >= 0;

  const saveMutation = useMutation({
    mutationFn: (vars: { userId: number; baseSalary: number }) =>
      adminService.upsertRiderProfile({
        user_id: vars.userId,
        base_salary: vars.baseSalary,
      }),
    // Await the refetch before closing so an immediate re-open prefills the
    // NEW value (the Save button keeps its spinner until then), and only
    // close the dialog if it still belongs to the rider that was saved —
    // never one the admin has since opened for someone else.
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['rider-profiles'] });
      toast.success('Base salary saved');
      setEditing((cur) => (cur && cur.id === vars.userId ? null : cur));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save base salary');
    },
  });

  if (ridersLoading || profilesLoading) {
    return <Loader fullScreen text="Loading rider profiles..." />;
  }

  // A failed load must not render an editable page: with the saved salaries
  // unknown, every rider would show "not set" and a save could blindly
  // overwrite a real salary the admin was never shown.
  if (ridersError || profilesError) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <RiderHrmHeader
          title="Rider Profiles"
          subtitle="Each rider's base salary — use Edit to set or change it."
        />
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <div className="py-8 text-center space-y-3">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              {profilesError
                ? "Couldn't load the saved salaries."
                : "Couldn't load the rider list."}
            </p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Editing is disabled until the data loads — retry, and if this
              persists check your connection or permissions.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                if (ridersError) void refetchRiders();
                if (profilesError) void refetchProfiles();
              }}
            >
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Rider Profiles"
        subtitle="Each rider's base salary — use Edit to set or change it."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Riders &amp; base salaries
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rider or phone…"
            className={`${inputClass} sm:max-w-xs`}
            aria-label="Search riders"
          />
        </div>

        {visibleRows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">
            {search ? 'No riders match your search.' : 'No riders yet — add rider users first.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 pr-4 font-semibold">Rider</th>
                  <th className="py-2 pr-4 font-semibold">Phone</th>
                  <th className="py-2 pr-4 font-semibold">Base salary</th>
                  {canEdit && <th className="py-2 text-right font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const profile = profileByUserId.get(row.id);
                  const hasSalary = profile != null;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-gray-100 dark:border-slate-700/60 last:border-0"
                    >
                      <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-slate-100">
                        {row.name}
                        {row.orphan && (
                          <span
                            className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            title="This rider is deactivated or linked to no brand — the salary is kept and still counts for payroll."
                          >
                            inactive rider
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600 dark:text-slate-300">
                        {row.phone ?? '—'}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {hasSalary ? (
                          <span className="font-semibold text-gray-900 dark:text-slate-100">
                            {formatCurrency(profile.base_salary)}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500">not set</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="py-2.5 text-right">
                          <Button size="small" variant="view" onClick={() => openEditor(row)}>
                            {hasSalary ? 'Edit' : 'Set salary'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={editing != null}
        onClose={saveMutation.isPending ? () => undefined : closeEditor}
        title={editing ? `Base salary — ${editing.name}` : 'Base salary'}
        size="small"
      >
        {editing && (
          <div className="space-y-4">
            <div>
              <label className={dialogLabelClass}>Base salary</label>
              <input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={salaryInput}
                onChange={(e) => setSalaryInput(e.target.value)}
                className={dialogInputClass}
                placeholder="e.g. 10000"
              />
              {profileByUserId.get(editing.id) == null && (
                <p className="mt-1 text-xs text-gray-500">
                  No salary saved for this rider yet.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={saveMutation.isPending}
                onClick={closeEditor}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!salaryValid}
                isLoading={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({ userId: editing.id, baseSalary: salaryNumber })
                }
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default RiderProfilesTable;
