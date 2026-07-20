import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { AnimatePresence } from 'framer-motion';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { useHasPermission } from '../../hooks/useHasPermission';
import { Brand } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { formatCurrency } from '../../utils/currency';
import { confirmDialog } from '../../utils/sweetAlert';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');

function fullImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}

const initialFormData = { name: '', logo_url: '', description: '', status: 'active' as 'active' | 'inactive', delivery_flat_fee: '' };

const Brands: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  /** Brand admins see only their own brand and may edit it (rules like the
   *  delivery fee) but cannot create or delete brands. */
  const isBrandLocked = user?.allowed_brand_ids != null;
  const canCreate = useHasPermission('brands:create');
  const canEdit = useHasPermission('brands:edit');
  const canDelete = useHasPermission('brands:delete');
  const canToggleOpen = useHasPermission('brands:toggle-open');
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [formData, setFormData] = useState<{ name: string; logo_url: string; description: string; status: 'active' | 'inactive'; delivery_flat_fee: string }>(initialFormData);
  const [uploading, setUploading] = useState(false);
  const [filterTenantId, setFilterTenantId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');
  const debouncedFilterSearch = useDebouncedValue(filterSearch, 300);
  const [page, setPage] = useState(1);

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string }[]>('/admin/tenants');
      return response.data;
    },
    enabled: isSuperAdmin,
  });

  const { data: brands, isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Brand[]>('/admin/brands');
      return response.data;
    },
  });

  const filteredBrands = React.useMemo(() => {
    if (!brands) return [];
    return brands.filter((b) => {
      if (filterTenantId && b.tenant_id !== Number(filterTenantId)) return false;
      if (filterStatus && b.status !== filterStatus) return false;
      if (debouncedFilterSearch.trim()) {
        const q = debouncedFilterSearch.trim().toLowerCase();
        if (!b.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [brands, filterTenantId, filterStatus, debouncedFilterSearch]);

  const paginatedBrands = React.useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredBrands.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredBrands, page]);
  React.useEffect(() => setPage(1), [filterTenantId, filterStatus, debouncedFilterSearch]);

  const brandSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedFilterSearch,
    options: (brands ?? []).map((b: any) => ({ id: String(b.id), label: b.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const clearFilters = () => {
    setFilterTenantId('');
    setFilterStatus('');
    setFilterSearch('');
  };

  const openCreate = () => {
    setEditingBrand(null);
    setFormData(initialFormData);
    setShowForm(true);
  };

  const openEdit = (brand: Brand) => {
    setEditingBrand(brand);
    setFormData({
      name: brand.name,
      logo_url: brand.logo_url ?? '',
      description: brand.description ?? '',
      status: brand.status === 'inactive' ? 'inactive' : 'active',
      delivery_flat_fee:
        brand.delivery_flat_fee != null ? String(brand.delivery_flat_fee) : '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingBrand(null);
    setFormData(initialFormData);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPEG, GIF, WebP).');
      return;
    }
    setUploading(true);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      formDataUpload.append('folder', 'brands');
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', formDataUpload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFormData((prev) => ({ ...prev, logo_url: data.url }));
      toast.success('Image uploaded.');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof initialFormData) => {
      const response = await apiClient.post('/admin/brands', {
        name: data.name,
        logo_url: data.logo_url || undefined,
        description: data.description || undefined,
        status: data.status,
        delivery_flat_fee: data.delivery_flat_fee !== '' ? parseFloat(data.delivery_flat_fee) : undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      closeForm();
      toast.success('Brand created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create brand');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof initialFormData }) => {
      const response = await apiClient.put(`/admin/brands/${id}`, {
        name: data.name,
        logo_url: data.logo_url || undefined,
        description: data.description || undefined,
        status: data.status,
        delivery_flat_fee: data.delivery_flat_fee !== '' ? parseFloat(data.delivery_flat_fee) : undefined,
      });
      return response.data;
    },
    onSuccess: (updatedBrand: Brand) => {
      queryClient.setQueryData(['brands'], (prev: Brand[] | undefined) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((b) => (b.id === updatedBrand.id ? { ...b, ...updatedBrand } : b));
      });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      closeForm();
      toast.success('Brand updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update brand');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/brands/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast.success('Brand deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete brand');
    },
  });

  // Open/close a brand's online ordering across ALL its branches.
  const availabilityMutation = useMutation({
    mutationFn: async ({ id, is_open }: { id: number; is_open: boolean }) => {
      const res = await apiClient.patch(`/admin/brands/${id}/availability`, { is_open });
      return res.data as { updated: number };
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      queryClient.invalidateQueries({ queryKey: ['brand-branch-availability'] });
      toast.success(`${vars.is_open ? 'Opened' : 'Closed'} online at ${data.updated} branch(es)`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update availability');
    },
  });

  // Toggle active/inactive directly from the row.
  const activeMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiClient.put(`/admin/brands/${id}`, { status: active ? 'active' : 'inactive' });
      return res.data as Brand;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      toast.success('Brand status updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
  });

  // Multi-branch online picker.
  const [onlinePickerBrand, setOnlinePickerBrand] = useState<Brand | null>(null);
  const { data: pickerBranches } = useQuery({
    queryKey: ['brand-branch-availability', onlinePickerBrand?.id],
    queryFn: async () => {
      const res = await apiClient.get<{ branch_id: number; branch_name: string | null; is_open: boolean }[]>(
        `/admin/brands/${onlinePickerBrand!.id}/branch-availability`,
      );
      return res.data;
    },
    enabled: onlinePickerBrand != null,
  });
  const branchAvailMutation = useMutation({
    mutationFn: ({ branchId, brandId, is_open }: { branchId: number; brandId: number; is_open: boolean }) =>
      apiClient.patch(`/admin/branches/${branchId}/brands/${brandId}/availability`, { is_open }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-branch-availability', onlinePickerBrand?.id] });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed to update'),
  });

  // Single online toggle on the row: direct toggle for a one-branch brand,
  // otherwise open the per-branch picker so the user chooses which branch.
  const handleOnlineToggle = (brand: Brand) => {
    const count = brand.online_branch_count ?? 0;
    if (count <= 1) {
      availabilityMutation.mutate({ id: brand.id, is_open: brand.online_status !== 'open' });
    } else {
      setOnlinePickerBrand(brand);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading brands...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Brands</h1>
        {!isBrandLocked && canCreate && (
          <Button onClick={openCreate} variant="primary">Add Brand</Button>
        )}
      </div>

      <Card className="mb-6 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap items-end gap-4">
          {isSuperAdmin && tenants && tenants.length > 0 && (
            <SearchableSelect
              label="Tenant"
              value={filterTenantId}
              onChange={setFilterTenantId}
              options={[
                { value: '', label: 'All tenants' },
                ...tenants.map((t) => ({ value: String(t.id), label: t.name })),
              ]}
              placeholder="All tenants"
              minWidth="min-w-[180px]"
            />
          )}
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
              onFocus={() => brandSearchTypeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = brandSearchTypeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  brandSearchTypeahead.setActiveIndex(Math.min(brandSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  brandSearchTypeahead.setActiveIndex(Math.max(brandSearchTypeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[brandSearchTypeahead.activeIndex];
                  if (opt?.label) setFilterSearch(opt.label);
                  brandSearchTypeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  brandSearchTypeahead.setOpen(false);
                }
              }}
              placeholder="Brand name..."
              className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500/50 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 min-w-[200px] placeholder-gray-400 dark:placeholder-slate-500"
            />
            <TypeaheadDropdown
              open={brandSearchTypeahead.open && filterSearch.trim().length >= 2}
              suggestions={brandSearchTypeahead.suggestions}
              activeIndex={brandSearchTypeahead.activeIndex}
              onHoverIndex={brandSearchTypeahead.setActiveIndex}
              onSelect={(opt) => {
                setFilterSearch(opt.label);
                brandSearchTypeahead.setOpen(false);
              }}
              onClose={() => brandSearchTypeahead.setOpen(false)}
            />
          </div>
          <ClearFiltersButton onClick={clearFilters} />
        </div>
      </Card>

      <Modal
        isOpen={showForm}
        onClose={closeForm}
        title={editingBrand ? 'Edit Brand' : 'Create Brand'}
        size="medium"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editingBrand) {
              updateMutation.mutate({ id: editingBrand.id, data: formData });
            } else {
              createMutation.mutate(formData);
            }
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Enter brand name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : 'Upload image'}
              </Button>
              {formData.logo_url && (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                  <img
                    src={fullImageUrl(formData.logo_url)}
                    alt="Logo preview"
                    className="w-full h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Fee (flat)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.delivery_flat_fee}
              onChange={(e) => setFormData({ ...formData, delivery_flat_fee: e.target.value })}
              placeholder="0.00"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Charged on every delivery order of this brand. A customer ordering from two brands pays each brand's fee.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: (e.target.value === 'inactive' ? 'inactive' : 'active') })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createMutation.isPending || updateMutation.isPending}
            >
              {editingBrand ? 'Update Brand' : 'Create Brand'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Listing: accented rows — left color bar, avatar, typography, actions */}
      <div className="w-full space-y-3">
        {brands && brands.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No brands found. Create your first brand!</p>
          </Card>
        ) : filteredBrands.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No brands match the current filters.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              <AnimatePresence mode="popLayout">
                {paginatedBrands.map((brand, i) => (
                  <AccentedListRow
                    key={brand.id}
                    accent={brand.status === 'active' ? 'active' : 'inactive'}
                    imageUrl={brand.logo_url ? fullImageUrl(brand.logo_url) : null}
                    initial={brand.name.charAt(0)}
                    title={brand.name}
                    subtitle={
                      <div className="space-y-0.5">
                        {brand.tenant_name ? (
                          <span className="block text-gray-600 dark:text-slate-400">{brand.tenant_name}</span>
                        ) : null}
                        <span className="block text-xs text-gray-500 dark:text-slate-500">
                          Customer ratings (all orders):{' '}
                          {(brand.rating_count ?? 0) > 0 ? (
                            <>
                              <strong className="text-gray-700 dark:text-slate-300">
                                {brand.rating_average != null ? `${brand.rating_average.toFixed(1)} / 5` : '—'}
                              </strong>
                              <span> · {brand.rating_count} rating{brand.rating_count === 1 ? '' : 's'}</span>
                            </>
                          ) : (
                            <span>no ratings yet</span>
                          )}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-slate-500">
                          Delivery fee:{' '}
                          <strong className="text-gray-700 dark:text-slate-300">
                            {formatCurrency(brand.delivery_flat_fee ?? 0)}
                          </strong>
                          <span> · per delivery order</span>
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-slate-500">
                          Online orders:{' '}
                          <strong className={
                            brand.online_status === 'open' ? 'text-green-600 dark:text-green-400'
                            : brand.online_status === 'closed' ? 'text-red-600 dark:text-red-400'
                            : brand.online_status === 'partial' ? 'text-amber-600 dark:text-amber-400'
                            : 'text-gray-500 dark:text-slate-400'
                          }>
                            {brand.online_status === 'open' ? 'Open'
                              : brand.online_status === 'closed' ? 'Closed'
                              : brand.online_status === 'partial' ? 'Partial (some branches closed)'
                              : 'No branches'}
                          </strong>
                          {(brand.online_branch_count ?? 0) > 0 && <span> · {brand.online_branch_count} branch{brand.online_branch_count === 1 ? '' : 'es'}</span>}
                        </span>
                      </div>
                    }
                    statusLabel={brand.status}
                    statusVariant={brand.status === 'active' ? 'active' : 'inactive'}
                    animationIndex={i}
                    actions={
                      <>
                        {canEdit && <Button size="small" variant="edit" onClick={() => openEdit(brand)} disabled={updateMutation.isPending}>
                          Edit
                        </Button>}
                        {canEdit && <Button
                          size="small"
                          variant={brand.status === 'active' ? 'outline' : 'primary'}
                          title="Toggle whether this branch/brand is active (an inactive brand is hidden from customers everywhere)"
                          onClick={() => activeMutation.mutate({ id: brand.id, active: brand.status !== 'active' })}
                          isLoading={activeMutation.isPending}
                        >
                          {brand.status === 'active' ? 'Set inactive' : 'Set active'}
                        </Button>}
                        {canToggleOpen && <Button
                          size="small"
                          variant="outline"
                          title="Open/close this brand's online ordering (app/web/kiosk). POS is unaffected."
                          disabled={(brand.online_branch_count ?? 0) === 0}
                          onClick={() => handleOnlineToggle(brand)}
                          isLoading={availabilityMutation.isPending}
                        >
                          {(brand.online_branch_count ?? 0) > 1
                            ? 'Manage online'
                            : brand.online_status === 'open'
                              ? 'Close online'
                              : 'Open online'}
                        </Button>}
                        {!isBrandLocked && canDelete && (
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => {
                              (async () => {
                                const ok = await confirmDialog({
                                  title: `Delete brand "${brand.name}"?`,
                                  text: 'This action cannot be undone.',
                                  confirmText: 'Delete',
                                });
                                if (!ok) return;
                                deleteMutation.mutate(brand.id);
                              })();
                            }}
                            isLoading={deleteMutation.isPending}
                          >
                            Delete
                          </Button>
                        )}
                      </>
                    }
                  />
                ))}
              </AnimatePresence>
            </AccentedList>
            <PaginationBar
              totalCount={filteredBrands.length}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              onPageChange={setPage}
              itemLabel="brands"
            />
          </>
        )}
      </div>

      <Modal
        isOpen={onlinePickerBrand != null}
        onClose={() => setOnlinePickerBrand(null)}
        title={onlinePickerBrand ? `Online availability — ${onlinePickerBrand.name}` : 'Online availability'}
      >
        {onlinePickerBrand && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-slate-400">
              Choose which branch to open/close for online orders (app/web/kiosk). POS is unaffected.
            </p>
            <div className="flex gap-2">
              <Button size="small" variant="outline" onClick={() => availabilityMutation.mutate({ id: onlinePickerBrand.id, is_open: true })} isLoading={availabilityMutation.isPending}>Open all</Button>
              <Button size="small" variant="outline" onClick={() => availabilityMutation.mutate({ id: onlinePickerBrand.id, is_open: false })} isLoading={availabilityMutation.isPending}>Close all</Button>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-slate-700">
              {(pickerBranches ?? []).map((br) => (
                <div key={br.branch_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{br.branch_name ?? `Branch ${br.branch_id}`}</span>
                  <div className="flex items-center gap-2">
                    <span className={br.is_open ? 'text-xs font-semibold text-green-600 dark:text-green-400' : 'text-xs font-semibold text-amber-600 dark:text-amber-400'}>
                      {br.is_open ? 'Open' : 'Closed'}
                    </span>
                    <Button
                      size="small"
                      variant={br.is_open ? 'danger' : 'primary'}
                      onClick={() => branchAvailMutation.mutate({ branchId: br.branch_id, brandId: onlinePickerBrand.id, is_open: !br.is_open })}
                      isLoading={branchAvailMutation.isPending}
                    >
                      {br.is_open ? 'Close' : 'Open'}
                    </Button>
                  </div>
                </div>
              ))}
              {(pickerBranches?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-500 dark:text-slate-400 py-2">No branches.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Brands;
