import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { useAuth } from '../../contexts/AuthContext';
import { MenuAddon } from '../../types';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import Loader from '../../components/Loader';
import FetchingOverlay from '../../components/FetchingOverlay';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import { useHasPermission } from '../../hooks/useHasPermission';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';
import { labelWithStatus } from '../../utils/entityStatus';

const MenuAddons: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  const canCreate = useHasPermission('addons:create');
  const canEdit = useHasPermission('addons:edit');
  const canDelete = useHasPermission('addons:delete');
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editingAddon, setEditingAddon] = useState<MenuAddon | null>(null);
  const [formData, setFormData] = useState({
    brand_id: '',
    name: '',
    price: '',
    is_active: true,
  });
  // Deep-link from the Menu Items page: ?brand_id= pre-filters the list.
  const [filters, setFilters] = useState<{
    brand_id: string;
    status: string;
    search: string;
  }>({ brand_id: searchParams.get('brand_id') ?? '', status: '', search: '' });
  const debouncedAddonSearch = useDebouncedValue(filters.search, 300);
  const [page, setPage] = useState(1);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string; tenant_name?: string }[]>('/admin/brands');
      return response.data;
    },
  });

  const effectiveBrandId = filters.brand_id ? +filters.brand_id : null;

  const filterParams = useMemo(() => {
    const p: { brand_id?: number; is_active?: boolean; search?: string } = {};
    if (effectiveBrandId != null) p.brand_id = effectiveBrandId;
    if (filters.status === 'active') p.is_active = true;
    if (filters.status === 'inactive') p.is_active = false;
    if (debouncedAddonSearch.trim()) p.search = debouncedAddonSearch.trim();
    return p;
  }, [effectiveBrandId, filters.status, debouncedAddonSearch]);

  const addonsKey = ['addons', filterParams];
  const { data: addons, isLoading, isFetching } = useQuery({
    queryKey: addonsKey,
    queryFn: () => adminService.getAddons(Object.keys(filterParams).length ? filterParams : undefined),
    enabled: true,
    placeholderData: keepPreviousData,
  });
  const addonsRefreshing = useResultsRefreshing(addonsKey, isFetching);

  const addonList = addons ?? [];
  const addonSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedAddonSearch,
    options: addonList.map((a: any) => ({ id: String(a.id), label: labelWithStatus(a.name ?? '', a) })),
    minChars: 2,
    limit: 8,
  });
  const paginatedAddons = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return addonList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [addonList, page]);
  React.useEffect(() => setPage(1), [filters.brand_id, filters.status, debouncedAddonSearch]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<MenuAddon> & { brand_id: number }) => adminService.createAddon(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addons'] });
      setShowForm(false);
      setFormData({ brand_id: '', name: '', price: '', is_active: true });
      toast.success('Addon created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create addon');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MenuAddon> }) =>
      adminService.updateAddon(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addons'] });
      setShowForm(false);
      setEditingAddon(null);
      toast.success('Addon updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update addon');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteAddon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['addons'] });
      toast.success('Addon deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete addon');
    },
  });

  const handleEdit = (addon: MenuAddon) => {
    setEditingAddon(addon);
    const isActive = addon.is_active ?? addon.isActive;
    const brandId = (addon as MenuAddon & { brand_id?: number }).brand_id;
    setFormData({
      brand_id: brandId != null ? String(brandId) : '',
      name: addon.name ?? '',
      price: String(addon.price ?? 0),
      is_active: isActive !== false,
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.brand_id) {
      toast.error('Select a brand first');
      return;
    }
    const data = {
      name: formData.name.trim(),
      price: parseFloat(formData.price),
      is_active: formData.is_active,
      brand_id: parseInt(formData.brand_id),
    };

    if (editingAddon) {
      updateMutation.mutate({ id: editingAddon.id, data });
    } else {
      createMutation.mutate({ ...data, brand_id: data.brand_id });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (((addons == null || (addons as any[]).length === 0) && isLoading) || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading addons...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Menu Addons</h1>
        {canCreate && <Button
          onClick={() => {
            setEditingAddon(null);
            setFormData({ brand_id: '', name: '', price: '', is_active: true });
            setShowForm(true);
          }}
        >
          Add Addon
        </Button>}
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Brand"
            value={filters.brand_id}
            onChange={(v) => setFilters((f) => ({ ...f, brand_id: v }))}
            options={[
              { value: '', label: 'Select brand' },
              ...(brands ?? []).map((b) => ({
                value: String(b.id),
                label: b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name,
              })),
            ]}
            placeholder="Select brand"
            minWidth="min-w-[180px]"
          />
          <SearchableSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="All"
            minWidth="min-w-[120px]"
          />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search by name</label>
            <div className="relative">
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                onFocus={() => addonSearchTypeahead.setOpen(true)}
                onKeyDown={(e) => {
                  const suggestions = addonSearchTypeahead.suggestions;
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    addonSearchTypeahead.setActiveIndex(Math.min(addonSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    addonSearchTypeahead.setActiveIndex(Math.max(addonSearchTypeahead.activeIndex - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const opt = suggestions[addonSearchTypeahead.activeIndex];
                    if (opt?.label) setFilters((f) => ({ ...f, search: opt.label }));
                    addonSearchTypeahead.setOpen(false);
                  } else if (e.key === 'Escape') {
                    addonSearchTypeahead.setOpen(false);
                  }
                }}
                placeholder="Addon name..."
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
              />
              <TypeaheadDropdown
                open={addonSearchTypeahead.open && filters.search.trim().length >= 2}
                suggestions={addonSearchTypeahead.suggestions}
                activeIndex={addonSearchTypeahead.activeIndex}
                onHoverIndex={addonSearchTypeahead.setActiveIndex}
                onSelect={(opt) => {
                  setFilters((f) => ({ ...f, search: opt.label }));
                  addonSearchTypeahead.setOpen(false);
                }}
                onClose={() => addonSearchTypeahead.setOpen(false)}
              />
            </div>
          </div>
          {isFetching && (
            <span className="text-xs text-gray-500 dark:text-slate-400 pb-1">
              Updating…
            </span>
          )}
          <ClearFiltersButton onClick={() => setFilters({ brand_id: '', status: '', search: '' })} />
        </div>
      </Card>

      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingAddon(null);
        }}
        title={editingAddon ? 'Edit Addon' : 'Create Addon'}
        size="medium"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
            <select
              value={formData.brand_id}
              onChange={(e) => setFormData({ ...formData, brand_id: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select brand</option>
              {brands?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Addon Name *</label>
            <input
              type="text"
              value={formData.name ?? ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Extra Cheese, Extra Sauce"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.price ?? ''}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
              placeholder="0.00"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active === true}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
              Active
            </label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingAddon(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editingAddon ? 'Update' : 'Create'} Addon
            </Button>
          </div>
        </form>
      </Modal>

      <FetchingOverlay active={addonsRefreshing} label="Updating addons…" className="rounded-xl">
      <div className="w-full space-y-3">
        {addonList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No addons found. Create your first addon!</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedAddons.map((addon, i) => {
                const addonBrandId = (addon as MenuAddon & { brand_id?: number }).brand_id;
                const brandName = addonBrandId != null ? (brands?.find((b) => b.id === addonBrandId)?.name ?? `#${addonBrandId}`) : null;
                const isActive = (addon.is_active ?? addon.isActive) !== false;
                return (
                  <AccentedListRow
                    key={addon.id}
                    accent={isActive ? 'active' : 'inactive'}
                    initial={addon.name?.charAt(0) ?? 'A'}
                    title={addon.name}
                    subtitle={<><p>{brandName != null ? `Brand: ${brandName}` : null}</p><p>{formatCurrency(Number(addon.price ?? 0))}</p>{isSuperAdmin && (addon as MenuAddon & { tenant_name?: string }).tenant_name && <p>Tenant: {(addon as MenuAddon & { tenant_name?: string }).tenant_name}</p>}</>}
                    statusLabel={isActive ? 'Active' : 'Inactive'}
                    statusVariant={isActive ? 'active' : 'inactive'}
                    animationIndex={i}
                    actions={
                      <>
                        {canEdit && <Button size="small" variant="edit" onClick={() => handleEdit(addon)}>Edit</Button>}
                        {canEdit && <Button
                          size="small"
                          variant={isActive ? 'outline' : 'primary'}
                          isLoading={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: addon.id, data: { is_active: !isActive } })}
                        >
                          {isActive ? 'Set inactive' : 'Set active'}
                        </Button>}
                        {canDelete && <Button
                          size="small"
                          variant="danger"
                          onClick={() => {
                            (async () => {
                              const ok = await confirmDialog({
                                title: `Delete addon "${addon.name}"?`,
                                text: 'This action cannot be undone.',
                                confirmText: 'Delete',
                              });
                              if (!ok) return;
                              deleteMutation.mutate(addon.id);
                            })();
                          }}
                          isLoading={deleteMutation.isPending}
                        >
                          Delete
                        </Button>}
                      </>
                    }
                  />
                );
              })}
            </AccentedList>
            <PaginationBar totalCount={addonList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="addons" />
          </>
        )}
      </div>
      </FetchingOverlay>
    </div>
  );
};

export default MenuAddons;
