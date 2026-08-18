import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../../../utils/apiClient';
import SearchableSelect from '../../../../components/SearchableSelect';
import { hrService } from '../../../../services/api/hrService';

export const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
export const labelClass =
  'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

export const mutationError = (fallback: string) => (err: unknown) => {
  const message =
    (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
      ?.message ?? fallback;
  toast.error(Array.isArray(message) ? message[0] : message);
};

/** Decimal columns arrive as strings. */
export const num = (v: string | number | null | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const useBranches = () =>
  useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

export const useDesignations = () =>
  useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrService.listDesignations(),
  });

/**
 * Scope picker shared by every rule form.
 *
 * "All branches" is not a convenience label — it is the tenant default row, the
 * one a branch row overrides. Saying so on the control stops someone creating a
 * branch rule when they meant to change the default for everybody.
 */
export const ScopeFields: React.FC<{
  branchId: number | '';
  designationId?: number | '';
  onBranch: (v: number | '') => void;
  onDesignation?: (v: number | '') => void;
}> = ({ branchId, designationId, onBranch, onDesignation }) => {
  const { data: branches = [] } = useBranches();
  const { data: designations = [] } = useDesignations();

  return (
    <>
      <div>
        <label className={labelClass}>Applies to</label>
        <SearchableSelect
          value={branchId === '' ? '' : String(branchId)}
          onChange={(v) => onBranch(v === '' ? '' : Number(v))}
          options={[
            { value: '', label: 'All branches (tenant default)' },
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
          placeholder="All branches (tenant default)"
          searchPlaceholder="Search branches…"
          ariaLabel="Branch scope"
        />
      </div>
      {onDesignation && (
        <div>
          <label className={labelClass}>Designation</label>
          <SearchableSelect
            value={designationId === '' || designationId == null ? '' : String(designationId)}
            onChange={(v) => onDesignation(v === '' ? '' : Number(v))}
            options={[
              { value: '', label: 'Every designation' },
              ...designations.map((d) => ({
                value: String(d.id),
                label: `${d.name} (level ${d.level})`,
              })),
            ]}
            placeholder="Every designation"
            searchPlaceholder="Search designations…"
            ariaLabel="Designation scope"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            A rule for one designation beats a branch-wide one.
          </p>
        </div>
      )}
    </>
  );
};

export const Toggle: React.FC<{
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
}> = ({ label, checked, hint, onChange }) => (
  <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
    <input
      type="checkbox"
      className="mt-1"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      {label}
      {hint && (
        <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      )}
    </span>
  </label>
);

export const scopeLabel = (
  branchId: number | null,
  branches: Array<{ id: number; name: string }>,
) =>
  branchId == null
    ? 'All branches'
    : (branches.find((b) => b.id === branchId)?.name ?? `Branch #${branchId}`);

export const TableShell: React.FC<{
  headers: string[];
  children: React.ReactNode;
}> = ({ headers, children }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
      <thead className="bg-gray-50 dark:bg-slate-800">
        <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {headers.map((h) => (
            <th key={h} className="px-3 py-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
        {children}
      </tbody>
    </table>
  </div>
);

export const EmptyHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
    <p className="text-sm text-gray-600 dark:text-gray-400">{children}</p>
  </div>
);
