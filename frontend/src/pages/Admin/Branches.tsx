import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { Branch } from '../../types';
import { useHasPermission } from '../../hooks/useHasPermission';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';

const Branches: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('branches:create');
  const canEdit = useHasPermission('branches:edit');
  const canDelete = useHasPermission('branches:delete');
  const [filterBrandId, setFilterBrandId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');
  const debouncedFilterSearch = useDebouncedValue(filterSearch, 300);
  const [page, setPage] = useState(1);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/brands');
      return response.data;
    },
  });

  const { data: branches, isLoading } = useQuery({
    queryKey: ['branches', filterBrandId || null],
    queryFn: async () => {
      const params = filterBrandId ? { brand_id: filterBrandId } : {};
      const response = await apiClient.get<Branch[]>('/admin/branches', { params });
      return response.data;
    },
  });

  const filteredBranches = React.useMemo(() => {
    if (!branches) return [];
    return branches.filter((b) => {
      if (filterStatus && b.status !== filterStatus) return false;
      if (debouncedFilterSearch.trim()) {
        const q = debouncedFilterSearch.trim().toLowerCase();
        if (!b.name.toLowerCase().includes(q) && !(b.code || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [branches, filterStatus, debouncedFilterSearch]);

  const paginatedBranches = React.useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredBranches.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredBranches, page]);
  React.useEffect(() => setPage(1), [filterStatus, debouncedFilterSearch]);

  const branchSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedFilterSearch,
    options: (branches ?? []).map((b: any) => ({ id: String(b.id), label: b.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const clearFilters = () => {
    setFilterBrandId('');
    setFilterStatus('');
    setFilterSearch('');
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/branches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch deleted successfully!');
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to delete branch');
    },
  });

  // Toggle active/inactive directly from the row.
  const activeMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      await apiClient.put(`/admin/branches/${id}`, { is_active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch status updated');
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to update status');
    },
  });

  const isSubmitting = deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Deleting...' : 'Loading branches...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Branches</h1>
        {canCreate && <Button variant="primary" onClick={() => navigate('/admin/branches/new')}>Add Branch</Button>}
      </div>

      <Card className="mb-6 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap items-end gap-4">
          <SearchableSelect
            label="Brand"
            value={filterBrandId}
            onChange={setFilterBrandId}
            options={[
              { value: '', label: 'All brands' },
              ...(brands ?? []).map((brand: { id: number; name: string; tenant_name?: string }) => ({
                value: String(brand.id),
                label: brand.tenant_name ? `${brand.name} (${brand.tenant_name})` : brand.name,
              })),
            ]}
            placeholder="All brands"
            minWidth="min-w-[200px]"
          />
          <SearchableSelect
            label="Status"
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="All"
            minWidth="min-w-[120px]"
          />
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Search</label>
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              onFocus={() => branchSearchTypeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = branchSearchTypeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  branchSearchTypeahead.setActiveIndex(Math.min(branchSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  branchSearchTypeahead.setActiveIndex(Math.max(branchSearchTypeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[branchSearchTypeahead.activeIndex];
                  if (opt?.label) setFilterSearch(opt.label);
                  branchSearchTypeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  branchSearchTypeahead.setOpen(false);
                }
              }}
              placeholder="Name or code..."
              className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 min-w-[200px] bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
            />
            <TypeaheadDropdown
              open={branchSearchTypeahead.open && filterSearch.trim().length >= 2}
              suggestions={branchSearchTypeahead.suggestions}
              activeIndex={branchSearchTypeahead.activeIndex}
              onHoverIndex={branchSearchTypeahead.setActiveIndex}
              onSelect={(opt) => {
                setFilterSearch(opt.label);
                branchSearchTypeahead.setOpen(false);
              }}
              onClose={() => branchSearchTypeahead.setOpen(false)}
            />
          </div>
          <ClearFiltersButton onClick={clearFilters} />
        </div>
      </Card>

      <div className="w-full space-y-3">
        {branches && branches.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No branches found. Create your first branch!</p>
          </Card>
        ) : filteredBranches.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No branches match the current filters.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedBranches.map((branch, i) => (
                <AccentedListRow
                  key={branch.id}
                  accent={branch.status === 'active' ? 'active' : 'inactive'}
                  initial={branch.name.charAt(0)}
                  title={branch.name}
                  subtitle={
                    <>
                      {(branch.tenant_name || (branch.brand_names?.length ?? 0) > 0) && (
                        <p>
                          {branch.tenant_name && <span className="font-medium text-indigo-600 dark:text-indigo-400">{branch.tenant_name}</span>}
                          {branch.tenant_name && branch.brand_names?.length && ' → '}
                          {branch.brand_names?.length ? <span>{branch.brand_names.join(', ')}</span> : null}
                        </p>
                      )}
                      <p>Code: <span className="font-mono font-medium">{branch.code}</span></p>
                      {branch.address && <p>Address: {branch.address}</p>}
                      {branch.delivery_radius_km != null && <p>Delivery radius: {Number(branch.delivery_radius_km)} km</p>}
                      {(branch.latitude != null || branch.longitude != null) && (
                        <p>
                          Coordinates: {branch.latitude != null ? Number(branch.latitude) : '—'}, {branch.longitude != null ? Number(branch.longitude) : '—'}
                        </p>
                      )}
                    </>
                  }
                  statusLabel={branch.status}
                  statusVariant={branch.status === 'active' ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      {canEdit && <Button size="small" variant="edit" onClick={() => navigate(`/admin/branches/${branch.id}`)}>Edit</Button>}
                      {canEdit && <Button
                        size="small"
                        variant={branch.status === 'active' ? 'outline' : 'primary'}
                        title="An inactive branch is hidden from customers and takes no orders (online and POS)."
                        onClick={() => activeMutation.mutate({ id: branch.id, is_active: branch.status !== 'active' })}
                        isLoading={activeMutation.isPending}
                      >
                        {branch.status === 'active' ? 'Set inactive' : 'Set active'}
                      </Button>}
                      {canDelete && <Button
                        size="small"
                        variant="danger"
                        onClick={() => {
                          (async () => {
                            const ok = await confirmDialog({
                              title: `Delete branch "${branch.name}"?`,
                              text: 'This action cannot be undone.',
                              confirmText: 'Delete',
                            });
                            if (!ok) return;
                            deleteMutation.mutate(branch.id);
                          })();
                        }}
                        isLoading={deleteMutation.isPending}
                      >
                        Delete
                      </Button>}
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={filteredBranches.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="branches" />
          </>
        )}
      </div>
    </div>
  );
};

export default Branches;
