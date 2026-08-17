import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MdOutlineBadge, MdOutlineSearch, MdPersonAddAlt1 } from 'react-icons/md';
import { hrService, EmployeeListParams } from '../../../services/api/hrService';
import apiClient from '../../../utils/apiClient';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import PaginationBar from '../../../components/PaginationBar';
import Loader from '../../../components/Loader';
import EmployeeFormModal from './EmployeeFormModal';
import { statusBadgeClass, statusLabel } from './hrShared';

const PAGE_SIZE = 25;

/**
 * The staff roster.
 *
 * Scoping is entirely server-side, including the rule that brand-locked
 * managers also see brand-null (shared) staff at their branches — so this
 * screen never filters for safety, only for the user's convenience.
 */
const Employees: React.FC = () => {
  const canCreate = useHasPermission('employees:create');

  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [designationId, setDesignationId] = useState<number | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  const params: EmployeeListParams = useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      branch_id: branchId === '' ? undefined : Number(branchId),
      designation_id: designationId === '' ? undefined : Number(designationId),
      include_inactive: includeInactive || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, branchId, designationId, includeInactive, page],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hr-employees', params],
    queryFn: () => hrService.listEmployees(params),
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrService.listDesignations(),
  });

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return data ?? [];
    },
  });

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  const resetPageAnd = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <MdOutlineBadge className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Employees</h1>
          {total > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">({total})</span>
          )}
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <MdPersonAddAlt1 className="text-lg" />
            Add employee
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <MdOutlineSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => resetPageAnd(setSearch)(e.target.value)}
            placeholder="Name, code, phone or CNIC"
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
          />
        </div>

        <select
          value={branchId}
          onChange={(e) => resetPageAnd(setBranchId)(e.target.value === '' ? '' : Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
        >
          <option value="">All branches</option>
          {branches.map((b: { id: number; name: string }) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <select
          value={designationId}
          onChange={(e) =>
            resetPageAnd(setDesignationId)(e.target.value === '' ? '' : Number(e.target.value))
          }
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
        >
          <option value="">All designations</option>
          {designations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => resetPageAnd(setIncludeInactive)(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Include past employees
        </label>
      </div>

      {isLoading ? (
        <Loader />
      ) : isError ? (
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          Could not load employees. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No employees yet.
            {canCreate && ' Use “Add employee” to create the first record.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  {['Code', 'Name', 'Designation', 'Branch', 'Brand', 'Joined', 'Status'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {e.employee_code}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Link
                        to={`/admin/hr/employees/${e.id}`}
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {e.full_name}
                      </Link>
                      {e.has_login && (
                        <span
                          className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-600 dark:bg-slate-700 dark:text-gray-300"
                          title="This employee also has a system login"
                        >
                          login
                        </span>
                      )}
                      {e.phone && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{e.phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {e.designation?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {e.branch?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {/* Blank brand is meaningful: shared branch staff (cleaner,
                          security) belong to the branch, not to a brand. */}
                      {e.brand?.name ?? (
                        <span className="text-xs italic text-gray-400">Shared</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {e.date_of_joining}
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClass(e.status)}>{statusLabel(e.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={total}
            onPageChange={setPage}
            itemLabel="employees"
          />
        </>
      )}

      {showCreate && (
        <EmployeeFormModal
          designations={designations}
          branches={branches}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
};

export default Employees;
