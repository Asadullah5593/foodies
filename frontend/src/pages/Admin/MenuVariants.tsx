import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Brand, MenuVariant } from '../../types';
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
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import { confirmDialog } from '../../utils/sweetAlert';
import { useHasPermission } from '../../hooks/useHasPermission';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';

const MenuVariants: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('variants:create');
  const canEdit = useHasPermission('variants:edit');
  const canDelete = useHasPermission('variants:delete');
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Pick<MenuVariant, 'id' | 'menu_item_id' | 'name' | 'price_modifier' | 'is_default' | 'sort_order' | 'size_key'> | null>(null);
  // Deep-link from the Menu Items page: ?brand_id= & ?item_id= pre-filter.
  const [selectedMenuItem, setSelectedMenuItem] = useState<number | null>(() => {
    const v = searchParams.get('item_id');
    return v ? Number(v) : null;
  });
  const [filterBrandId, setFilterBrandId] = useState<number | null>(() => {
    const v = searchParams.get('brand_id');
    return v ? Number(v) : null;
  });
  const [searchVariant, setSearchVariant] = useState('');
  const [page, setPage] = useState(1);
  const [formData, setFormData] = useState({
    menu_item_id: '',
    name: '',
    price_modifier: '',
    is_default: false,
    sort_order: '0',
    size_key: '',
  });

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Brand[]>('/admin/brands');
      return response.data;
    },
  });

  const { data: menuItems } = useQuery({
    queryKey: ['menuItems', filterBrandId],
    queryFn: () =>
      adminService.getMenuItems(filterBrandId != null ? { brand_id: filterBrandId } : undefined),
    enabled: true,
  });

  const variantsKey = ['variants', selectedMenuItem, filterBrandId];
  const { data: variants, isLoading, isFetching } = useQuery({
    queryKey: variantsKey,
    queryFn: () =>
      adminService.getVariants(selectedMenuItem ?? undefined, filterBrandId ?? undefined),
    enabled: true,
    placeholderData: keepPreviousData,
  });
  const variantsRefreshing = useResultsRefreshing(variantsKey, isFetching);

  const debouncedSearchVariant = useDebouncedValue(searchVariant, 300);
  const variantList = Array.isArray(variants) ? variants : [];
  const variantTypeahead = useTypeaheadSuggestions({
    query: searchVariant,
    options: variantList.map((v) => ({ id: String(v.id), label: v.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const filteredVariants = useMemo(() => {
    if (!variantList.length) return [];
    if (!debouncedSearchVariant.trim()) return variantList;
    const q = debouncedSearchVariant.trim().toLowerCase();
    return variantList.filter((v) => (v.name || '').toLowerCase().includes(q));
  }, [variantList, debouncedSearchVariant]);

  const paginatedVariants = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredVariants.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredVariants, page]);
  React.useEffect(() => setPage(1), [filterBrandId, debouncedSearchVariant]);

  const prevFilterBrandIdRef = React.useRef<number | null>(filterBrandId);
  React.useEffect(() => {
    if (prevFilterBrandIdRef.current !== filterBrandId) {
      prevFilterBrandIdRef.current = filterBrandId;
      setSelectedMenuItem(null);
    }
  }, [filterBrandId]);

  const createMutation = useMutation({
    mutationFn: adminService.createVariant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variants'] });
      setShowForm(false);
      setFormData({
        menu_item_id: '',
        name: '',
        price_modifier: '',
        is_default: false,
        sort_order: '0',
        size_key: '',
      });
      toast.success('Variant created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create variant');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteVariant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variants'] });
      toast.success('Variant deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete variant');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; price_modifier?: number; is_default?: boolean; menu_item_id?: number; sort_order?: number; size_key?: string | null } }) =>
      adminService.updateVariant(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variants'] });
      setEditingVariant(null);
      toast.success('Variant updated!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update variant');
    },
  });

  const [editVariantForm, setEditVariantForm] = useState({ menu_item_id: '', name: '', price_modifier: '', is_default: false, sort_order: '0', size_key: '' });
  React.useEffect(() => {
    if (editingVariant) {
      setEditVariantForm({
        menu_item_id: String(editingVariant.menu_item_id ?? ''),
        name: editingVariant.name,
        price_modifier: String(editingVariant.price_modifier ?? 0),
        is_default: editingVariant.is_default ?? false,
        sort_order: String(editingVariant.sort_order ?? 0),
        size_key: editingVariant.size_key ?? '',
      });
    }
  }, [editingVariant]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.menu_item_id) {
      toast.error('Select a menu item');
      return;
    }
    createMutation.mutate({
      menu_item_id: parseInt(formData.menu_item_id),
      name: formData.name,
      price_modifier: parseFloat(formData.price_modifier),
      is_default: formData.is_default,
      sort_order: parseInt(formData.sort_order),
      size_key: formData.size_key.trim() || null,
    });
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading variants...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Menu Variants</h1>
        {canCreate && <Button onClick={() => setShowForm(true)}>Add Variant</Button>}
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Brand"
            value={filterBrandId != null ? String(filterBrandId) : ''}
            onChange={(v) => setFilterBrandId(v ? parseInt(v, 10) : null)}
            options={[
              { value: '', label: 'Select brand' },
              ...(brands ?? []).map((b: Brand & { tenant_name?: string }) => ({
                value: String(b.id),
                label: b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name,
              })),
            ]}
            placeholder="Select brand"
            minWidth="min-w-[180px]"
          />
          <SearchableSelect
            label="Menu Item"
            value={selectedMenuItem != null ? String(selectedMenuItem) : ''}
            onChange={(v) => setSelectedMenuItem(v ? parseInt(v, 10) : null)}
            options={[
              { value: '', label: 'Select a menu item' },
              ...(menuItems ?? []).map((item: { id: number; name: string }) => ({
                value: String(item.id),
                label: item.name,
              })),
            ]}
            placeholder="Select a menu item"
            minWidth="min-w-[160px]"
            disabled={!filterBrandId}
          />
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Search variant name</label>
            <div className="relative">
              <input
                type="text"
                value={searchVariant}
                onChange={(e) => setSearchVariant(e.target.value)}
                onFocus={() => variantTypeahead.setOpen(true)}
                onKeyDown={(e) => {
                  const suggestions = variantTypeahead.suggestions;
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    variantTypeahead.setActiveIndex(Math.min(variantTypeahead.activeIndex + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    variantTypeahead.setActiveIndex(Math.max(variantTypeahead.activeIndex - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const opt = suggestions[variantTypeahead.activeIndex];
                    if (opt?.label) setSearchVariant(opt.label);
                    variantTypeahead.setOpen(false);
                  } else if (e.key === 'Escape') {
                    variantTypeahead.setOpen(false);
                  }
                }}
                placeholder="Variant name..."
                className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
              />
              <TypeaheadDropdown
                open={variantTypeahead.open && searchVariant.trim().length >= 2}
                suggestions={variantTypeahead.suggestions}
                activeIndex={variantTypeahead.activeIndex}
                onHoverIndex={variantTypeahead.setActiveIndex}
                onSelect={(opt) => {
                  setSearchVariant(opt.label);
                  variantTypeahead.setOpen(false);
                }}
                onClose={() => variantTypeahead.setOpen(false)}
              />
            </div>
          </div>
          <ClearFiltersButton
            onClick={() => {
              setFilterBrandId(null);
              setSelectedMenuItem(null);
              setSearchVariant('');
            }}
          />
        </div>
      </Card>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Create Variant" size="medium">
        <form onSubmit={handleSubmit} className="space-y-4">
          <SearchableSelect
            label="Menu Item *"
            value={formData.menu_item_id}
            onChange={(v) => setFormData({ ...formData, menu_item_id: v })}
            options={[
              { value: '', label: 'Select Menu Item' },
              ...(menuItems ?? []).map((item: { id: number; name: string }) => ({
                value: String(item.id),
                label: item.name,
              })),
            ]}
            placeholder="Select Menu Item"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Variant Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Small, Medium, Large"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Modifier *</label>
            <input
              type="number"
              step="0.01"
              value={formData.price_modifier}
              onChange={(e) => setFormData({ ...formData, price_modifier: e.target.value })}
              required
              placeholder="0.00"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Positive for increase, negative for decrease</p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_default"
              checked={formData.is_default}
              onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_default" className="ml-2 text-sm text-gray-700">
              Set as default variant
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
            <input
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Size Key</label>
            <input
              type="text"
              value={formData.size_key}
              onChange={(e) => setFormData({ ...formData, size_key: e.target.value })}
              placeholder='e.g. 7, 10, 12, 14 (pizza sizes)'
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Normalized size shared across items. Enables per-size topping pricing &amp; "first N free". Leave blank for non-pizza items.</p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create Variant
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!editingVariant}
        onClose={() => setEditingVariant(null)}
        title={editingVariant ? `Edit variant: ${editingVariant.name}` : 'Edit Variant'}
        size="medium"
      >
        {editingVariant && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({
                id: editingVariant.id,
                data: {
                  menu_item_id: editVariantForm.menu_item_id ? parseInt(editVariantForm.menu_item_id) : undefined,
                  name: editVariantForm.name.trim(),
                  price_modifier: parseFloat(editVariantForm.price_modifier),
                  is_default: editVariantForm.is_default,
                  sort_order: parseInt(editVariantForm.sort_order, 10),
                  size_key: editVariantForm.size_key.trim() || null,
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <SearchableSelect
                label="Menu Item (Brand)"
                value={editVariantForm.menu_item_id}
                onChange={(v) => setEditVariantForm((f) => ({ ...f, menu_item_id: v }))}
                options={[
                  { value: '', label: 'Select menu item' },
                  ...(menuItems ?? []).map((item: { id: number; name: string }) => ({
                    value: String(item.id),
                    label: item.name,
                  })),
                ]}
                placeholder="Select menu item"
              />
              <p className="text-xs text-gray-500 mt-1">Changing the menu item moves this variant to another product (and brand).</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Variant Name *</label>
              <input
                type="text"
                value={editVariantForm.name}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price Modifier *</label>
              <input
                type="number"
                step="0.01"
                value={editVariantForm.price_modifier}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, price_modifier: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="edit_is_default"
                checked={editVariantForm.is_default}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, is_default: e.target.checked }))}
                className="h-4 w-4 text-blue-600 rounded border-gray-300"
              />
              <label htmlFor="edit_is_default" className="ml-2 text-sm text-gray-700">Default variant</label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
              <input
                type="number"
                value={editVariantForm.sort_order}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, sort_order: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Size Key</label>
              <input
                type="text"
                value={editVariantForm.size_key}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, size_key: e.target.value }))}
                placeholder='e.g. 7, 10, 12, 14 (pizza sizes)'
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Enables per-size topping pricing. Leave blank for non-pizza items.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingVariant(null)}>Cancel</Button>
              <Button type="submit" isLoading={updateMutation.isPending}>Update</Button>
            </div>
          </form>
        )}
      </Modal>

      <FetchingOverlay active={variantsRefreshing} label="Updating variants…" className="rounded-xl">
      <div className="w-full space-y-3">
        {(!filteredVariants || filteredVariants.length === 0) ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No variants found. Adjust filters or create your first variant!</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedVariants.map((variant: any, i) => {
                const priceMod = Number(variant.priceModifier ?? variant.price_modifier ?? 0);
                const sortOrder = Number(variant.sortOrder ?? variant.sort_order ?? 0);
                const menuItemId = variant.menuItemId ?? variant.menu_item_id;
                const menuItem = menuItems?.find((i: any) => i.id === menuItemId);
                const menuItemName = variant.menuItem?.name ?? (variant as { menu_item_name?: string }).menu_item_name ?? menuItem?.name ?? 'N/A';
                const brandId = variant.menuItem?.brand_id ?? menuItem?.brand_id;
                const brandName = brandId != null ? (brands?.find((b) => b.id === brandId)?.name ?? `#${brandId}`) : null;
                return (
                  <AccentedListRow
                    key={variant.id}
                    accent="active"
                    initial={variant.name?.charAt(0) ?? 'V'}
                    title={variant.name}
                    subtitle={<><p>{brandName != null ? `Brand: ${brandName}` : null}</p><p>Menu item: {menuItemName}</p><p>Price: {priceMod >= 0 ? '+' : ''}{formatCurrency(Math.abs(priceMod))}</p><p>Sort: {sortOrder}</p></>}
                    statusLabel={(variant.is_default ?? variant.isDefault) ? 'Default' : undefined}
                    statusVariant="active"
                    animationIndex={i}
                    actions={
                      <>
                        {canEdit && <Button size="small" variant="edit" onClick={() => setEditingVariant({ id: variant.id, menu_item_id: menuItemId, name: variant.name, price_modifier: priceMod, is_default: variant.is_default ?? variant.isDefault ?? false, sort_order: sortOrder, size_key: variant.size_key ?? variant.sizeKey ?? null })}>Edit</Button>}
                        {canDelete && <Button
                          size="small"
                          variant="danger"
                          onClick={() => {
                            (async () => {
                              const ok = await confirmDialog({
                                title: `Delete variant "${variant.name}"?`,
                                text: 'This action cannot be undone.',
                                confirmText: 'Delete',
                              });
                              if (!ok) return;
                              deleteMutation.mutate(variant.id);
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
            <PaginationBar totalCount={filteredVariants.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="variants" />
          </>
        )}
      </div>
      </FetchingOverlay>
    </div>
  );
};

export default MenuVariants;
