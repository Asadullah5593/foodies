import React, { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
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
import SearchableSelect from '../../../components/SearchableSelect';
import FetchingOverlay from '../../../components/FetchingOverlay';

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
  // '' = every brand, 'shared' = the ones with no brand at all.
  const [brandId, setBrandId] = useState<number | '' | 'shared'>('');
  const [status, setStatus] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  const params: EmployeeListParams = useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      branch_id: branchId === '' ? undefined : Number(branchId),
      brand_id:
        brandId === '' || brandId === 'shared' ? undefined : Number(brandId),
      unassigned_brand: brandId === 'shared' || undefined,
      designation_id: designationId === '' ? undefined : Number(designationId),
      status: status || undefined,
      include_inactive: includeInactive || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [
      debouncedSearch,
      branchId,
      brandId,
      designationId,
      status,
      includeInactive,
      page,
    ],
  );

  const { data, isLoading, isError, isPlaceholderData } = useQuery({
    queryKey: ['hr-employees', params],
    queryFn: () => hrService.listEmployees(params),
    placeholderData: keepPreviousData,
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

  const { data: brands = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-brands'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/brands');
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

        <SearchableSelect
          ariaLabel="Branch"
          value={branchId === '' ? '' : String(branchId)}
          onChange={(v) => resetPageAnd(setBranchId)(v === '' ? '' : Number(v))}
          options={[
            { value: '', label: 'All branches' },
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
          placeholder="All branches"
          searchPlaceholder="Search branches…"
        />

        <SearchableSelect
          ariaLabel="Brand"
          value={brandId === '' ? '' : String(brandId)}
          onChange={(v) =>
            resetPageAnd(setBrandId)(
              v === '' ? '' : v === 'shared' ? 'shared' : Number(v),
            )
          }
          options={[
            { value: '', label: 'All brands' },
            ...brands.map((b) => ({ value: String(b.id), label: b.name })),
            // Cleaners, guards, anyone who works for the branch rather than one
            // brand. They show as "Shared" in the table.
            { value: 'shared', label: 'Shared (no brand)' },
          ]}
          placeholder="All brands"
          searchPlaceholder="Search brands…"
        />

        <SearchableSelect
          ariaLabel="Designation"
          value={designationId === '' ? '' : String(designationId)}
          onChange={(v) => resetPageAnd(setDesignationId)(v === '' ? '' : Number(v))}
          options={[
            { value: '', label: 'All designations' },
            ...designations.map((d) => ({ value: String(d.id), label: d.name })),
          ]}
          placeholder="All designations"
          searchPlaceholder="Search designations…"
        />

        <SearchableSelect
          ariaLabel="Status"
          value={status}
          onChange={(v) => resetPageAnd(setStatus)(v)}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            // `on_leave` and `suspended` are omitted on purpose: nothing in the
            // system ever sets them. Approving leave writes attendance days and
            // leaves the employee active, and there is no suspension flow at
            // all — so offering them would filter on a state that never occurs.
            { value: 'notice_period', label: 'Serving notice' },
            { value: 'resigned', label: 'Resigned' },
            { value: 'terminated', label: 'Terminated' },
          ]}
          placeholder="All statuses"
          searchPlaceholder="Search statuses…"
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => resetPageAnd(setIncludeInactive)(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Include past employees
          {['resigned', 'terminated'].includes(status) && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              (already shown by this status)
            </span>
          )}
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
          <FetchingOverlay active={isPlaceholderData} label="Updating employees…" className="rounded-lg">
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  {['#', 'Code', 'Name', 'Designation', 'Branch', 'Brand', 'Joined', 'Status', ''].map((h) => (
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
                {rows.map((e, idx) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    {/* Running number across pages, so "the 27th row" means
                        something when someone reads it out. */}
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-400">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>
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
                    {/* An explicit action: relying on the name being a link is
                        not discoverable, and this is where salary is set. */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        to={`/admin/hr/employees/${e.id}`}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
                      >
                        Open / salary
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </FetchingOverlay>

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
          brands={brands}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
};

export default Employees;
