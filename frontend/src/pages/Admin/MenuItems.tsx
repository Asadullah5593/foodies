import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { getImageFullUrl } from '../../utils/imageUrl';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';

interface MenuItemAddon {
  id: number;
  name: string;
  price: number;
}

interface MenuItem {
  id: number;
  brand_id?: number;
  category_id: number;
  name: string;
  description?: string;
  base_price: number;
  is_active: boolean;
  deal_only?: boolean;
  image_url?: string | null;
  category?: {
    id: number;
    name: string;
  };
  variants?: { id: number; menu_item_id: number; name: string; price_modifier: number; is_default?: boolean }[];
  addons?: MenuItemAddon[];
}

const MenuItems: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [manageAddonsItem, setManageAddonsItem] = useState<MenuItem | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<number[]>([]);
  const [categoryFormData, setCategoryFormData] = useState({ brand_id: '', name: '', description: '' });
  const [formData, setFormData] = useState({
    brand_id: '',
    category_id: '',
    name: '',
    description: '',
    base_price: '',
    is_active: true,
    deal_only: false,
    image_url: '',
  });
  const [imageUploading, setImageUploading] = useState(false);
  const [editImageUploading, setEditImageUploading] = useState(false);
  const [filters, setFilters] = useState<{
    brand_id: string;
    category_id: string;
    status: string;
    search: string;
  }>({ brand_id: '', category_id: '', status: '', search: '' });
  const debouncedMenuItemSearch = useDebouncedValue(filters.search, 300);
  const [menuItemsPage, setMenuItemsPage] = useState(1);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string; tenant_name?: string }[]>('/admin/brands');
      return response.data;
    },
  });

  const effectiveBrandId = filters.brand_id ? +filters.brand_id : null;

  const { data: categories } = useQuery({
    queryKey: ['menuCategories', effectiveBrandId],
    queryFn: () => adminService.getCategories(effectiveBrandId != null ? { brand_id: effectiveBrandId } : undefined),
    enabled: true,
  });

  const filterParams = useMemo(() => {
    const p: { brand_id?: number; category_id?: number; is_active?: boolean } = {};
    if (effectiveBrandId != null) p.brand_id = effectiveBrandId;
    if (filters.category_id) p.category_id = +filters.category_id;
    if (filters.status === 'active') p.is_active = true;
    if (filters.status === 'inactive') p.is_active = false;
    return p;
  }, [effectiveBrandId, filters.brand_id, filters.category_id, filters.status]);

  const categoriesForFilter = useMemo(() => categories ?? [], [categories]);

  const formBrandId = formData.brand_id ? +formData.brand_id : null;
  const { data: categoriesForForm } = useQuery({
    queryKey: ['menuCategories', formBrandId],
    queryFn: () => adminService.getCategories(formBrandId != null ? { brand_id: formBrandId } : undefined),
    enabled: !!formBrandId,
  });

  const { data: menuItems, isLoading } = useQuery({
    queryKey: ['menuItems', filterParams],
    queryFn: () => adminService.getMenuItems(Object.keys(filterParams).length ? filterParams : undefined),
    enabled: true,
  });

  const filteredMenuItems = useMemo(() => {
    const items = menuItems ?? [];
    if (!debouncedMenuItemSearch.trim()) return items;
    const q = debouncedMenuItemSearch.trim().toLowerCase();
    return items.filter(
      (item: MenuItem) =>
        (item.name || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q),
    );
  }, [menuItems, debouncedMenuItemSearch]);

  const paginatedMenuItems = useMemo(() => {
    const start = (menuItemsPage - 1) * DEFAULT_PAGE_SIZE;
    return filteredMenuItems.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredMenuItems, menuItemsPage]);

  useEffect(() => setMenuItemsPage(1), [filters.brand_id, filters.category_id, filters.status, debouncedMenuItemSearch]);

  const menuItemSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedMenuItemSearch,
    options: (menuItems ?? []).map((i: any) => ({ id: String(i.id), label: i.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const addonBrandId = manageAddonsItem?.brand_id ?? effectiveBrandId;
  const { data: allAddons } = useQuery({
    queryKey: ['addons', addonBrandId],
    queryFn: () => adminService.getAddons(addonBrandId != null ? { brand_id: addonBrandId } : undefined),
    enabled: !!manageAddonsItem,
  });
  const addonsForItem = useMemo(() => allAddons ?? [], [allAddons]);

  useEffect(() => {
    if (manageAddonsItem) {
      setSelectedAddonIds(manageAddonsItem.addons?.map((a) => a.id) ?? []);
    }
  }, [manageAddonsItem]);

  const prevBrandIdRef = React.useRef<string>(filters.brand_id);
  useEffect(() => {
    if (prevBrandIdRef.current !== filters.brand_id) {
      prevBrandIdRef.current = filters.brand_id;
      setFilters((f) => ({ ...f, category_id: '' }));
    }
  }, [filters.brand_id]);

  const [editFormData, setEditFormData] = useState({ brand_id: '', category_id: '', name: '', description: '', base_price: '', is_active: true, deal_only: false, image_url: '' });
  useEffect(() => {
    if (editingItem) {
      setEditFormData({
        brand_id: editingItem.brand_id != null ? String(editingItem.brand_id) : '',
        category_id: editingItem.category_id != null ? String(editingItem.category_id) : '',
        name: editingItem.name,
        description: editingItem.description ?? '',
        base_price: String(editingItem.base_price),
        is_active: editingItem.is_active,
        deal_only: (editingItem as { deal_only?: boolean }).deal_only ?? false,
        image_url: (editingItem as { image_url?: string }).image_url ?? '',
      });
    }
  }, [editingItem]);

  const editFormBrandId = editingItem && editFormData.brand_id ? +editFormData.brand_id : null;
  const { data: categoriesForEdit } = useQuery({
    queryKey: ['menuCategories', editFormBrandId],
    queryFn: () => adminService.getCategories(editFormBrandId != null ? { brand_id: editFormBrandId } : undefined),
    enabled: !!editingItem && editFormBrandId != null,
  });

  const linkAddonsMutation = useMutation({
    mutationFn: ({ menuItemId, addonIds }: { menuItemId: number; addonIds: number[] }) =>
      adminService.linkAddons(menuItemId, addonIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setManageAddonsItem(null);
      toast.success('Addons updated for this item. They will now appear in the POS when adding this product.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update addons');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name: string; description?: string; base_price: number; is_active: boolean; brand_id?: number; category_id?: number; image_url?: string | null; deal_only?: boolean } }) =>
      adminService.updateMenuItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setEditingItem(null);
      toast.success('Menu item updated!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update menu item');
    },
  });

  const uploadImageFile = async (file: File, isEdit: boolean) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPEG, GIF, WebP).');
      return;
    }
    if (isEdit) setEditImageUploading(true);
    else setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (isEdit) setEditFormData((prev) => ({ ...prev, image_url: data.url }));
      else setFormData((prev) => ({ ...prev, image_url: data.url }));
      toast.success('Image uploaded.');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed.');
    } finally {
      if (isEdit) setEditImageUploading(false);
      else setImageUploading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (file) uploadImageFile(file, isEdit);
    e.target.value = '';
  };

  const createMutation = useMutation({
    mutationFn: async (data: { brand_id: string; category_id: string; name: string; description?: string; base_price: string; is_active: boolean; deal_only?: boolean; image_url?: string }) => {
      if (!data.brand_id || !data.category_id) throw new Error('Select a brand and category');
      const payload = {
        brand_id: parseInt(data.brand_id),
        category_id: parseInt(data.category_id),
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        base_price: parseFloat(data.base_price),
        is_active: data.is_active,
        deal_only: data.deal_only ?? false,
        image_url: data.image_url || undefined,
      };
      const response = await apiClient.post('/admin/menu/items', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      queryClient.invalidateQueries({ queryKey: ['menuCategories'] });
      setShowForm(false);
      setFormData({
        brand_id: '',
        category_id: '',
        name: '',
        description: '',
        base_price: '',
        is_active: true,
        deal_only: false,
        image_url: '',
      });
      toast.success('Menu item created successfully!');
    },
    onError: (error: any) => {
      console.error('Error creating menu item:', error);
      console.error('Error response:', error.response?.data);
      
      let errorMessage = 'Failed to create menu item';
      
      if (error.response?.data?.errors) {
        const validationErrors = Object.entries(error.response.data.errors)
          .map(([field, messages]: [string, any]) => `${field}: ${messages.join(', ')}`)
          .join('\n');
        errorMessage = `Validation errors:\n${validationErrors}`;
        console.error('Validation errors:', error.response.data.errors);
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/menu/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      toast.success('Menu item deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete menu item');
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: { brand_id: string; name: string; description?: string }) => {
      if (!data.brand_id) throw new Error('Select a brand first');
      const response = await apiClient.post('/admin/menu/categories', {
        brand_id: parseInt(data.brand_id),
        name: data.name,
        description: data.description || null,
        is_active: true,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuCategories'] });
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setShowCategoryForm(false);
      setCategoryFormData({ brand_id: '', name: '', description: '' });
      toast.success('Category created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create category');
    },
  });

  const isSubmitting =
    createMutation.isPending ||
    updateItemMutation.isPending ||
    deleteMutation.isPending ||
    createCategoryMutation.isPending ||
    linkAddonsMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading menu items...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Menu Items</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowCategoryForm(true)}>+ New Category</Button>
          <Button variant="primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add Menu Item'}</Button>
        </div>
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
            label="Category"
            value={filters.category_id}
            onChange={(v) => setFilters((f) => ({ ...f, category_id: v }))}
            options={[
              { value: '', label: 'All categories' },
              ...categoriesForFilter.map((c: { id: number; name: string }) => ({
                value: String(c.id),
                label: c.name,
              })),
            ]}
            placeholder="All categories"
            minWidth="min-w-[140px]"
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
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search item name</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              onFocus={() => menuItemSearchTypeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = menuItemSearchTypeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  menuItemSearchTypeahead.setActiveIndex(Math.min(menuItemSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  menuItemSearchTypeahead.setActiveIndex(Math.max(menuItemSearchTypeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[menuItemSearchTypeahead.activeIndex];
                  if (opt?.label) setFilters((f) => ({ ...f, search: opt.label }));
                  menuItemSearchTypeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  menuItemSearchTypeahead.setOpen(false);
                }
              }}
              placeholder="Item name..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
            />
            <TypeaheadDropdown
              open={menuItemSearchTypeahead.open && filters.search.trim().length >= 2}
              suggestions={menuItemSearchTypeahead.suggestions}
              activeIndex={menuItemSearchTypeahead.activeIndex}
              onHoverIndex={menuItemSearchTypeahead.setActiveIndex}
              onSelect={(opt) => {
                setFilters((f) => ({ ...f, search: opt.label }));
                menuItemSearchTypeahead.setOpen(false);
              }}
              onClose={() => menuItemSearchTypeahead.setOpen(false)}
            />
          </div>
          <ClearFiltersButton onClick={() => setFilters({ brand_id: '', category_id: '', status: '', search: '' })} />
        </div>
      </Card>

      {showCategoryForm && (
        <Card className="mb-4 bg-blue-50 border-blue-300">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-lg font-semibold text-gray-800">Create New Category</h4>
            <Button size="small" variant="secondary" onClick={() => {
              setShowCategoryForm(false);
              setCategoryFormData({ brand_id: '', name: '', description: '' });
            }}>
              Cancel
            </Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!categoryFormData.brand_id) {
                toast.error('Select a brand first');
                return;
              }
              createCategoryMutation.mutate({
                brand_id: categoryFormData.brand_id,
                name: categoryFormData.name,
                description: categoryFormData.description,
              });
            }}
          >
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
              <select
                value={categoryFormData.brand_id}
                onChange={(e) => setCategoryFormData({ ...categoryFormData, brand_id: e.target.value })}
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
            <div className="grid grid-cols-3 gap-2 mb-2">
              <input
                type="text"
                value={categoryFormData.name}
                onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                placeholder="Category name (e.g., Appetizers, Main Course)"
                required
                className="col-span-2 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <Button type="submit" isLoading={createCategoryMutation.isPending} size="small">
                Create Category
              </Button>
            </div>
            <input
              type="text"
              value={categoryFormData.description}
              onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
              placeholder="Description (optional)"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </form>
        </Card>
      )}

      <Modal
        isOpen={!!manageAddonsItem}
        onClose={() => {
          setManageAddonsItem(null);
          setSelectedAddonIds([]);
        }}
        title={manageAddonsItem ? `Manage addons: ${manageAddonsItem.name}` : 'Manage addons'}
        size="medium"
      >
        {manageAddonsItem && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select which addons customers can add to this product in the POS. Only addons from the same tenant are shown.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
              {addonsForItem.length === 0 ? (
                <p className="text-gray-500 text-sm">No addons available. Create addons in Admin → Menu Addons first.</p>
              ) : (
                addonsForItem.map((addon) => {
                  const checked = selectedAddonIds.includes(addon.id);
                  return (
                    <label key={addon.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedAddonIds((prev) =>
                            prev.includes(addon.id) ? prev.filter((id) => id !== addon.id) : [...prev, addon.id]
                          );
                        }}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300"
                      />
                      <span className="font-medium">{addon.name}</span>
                      <span className="text-green-600">{formatCurrency(Number(addon.price ?? 0))}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setManageAddonsItem(null);
                  setSelectedAddonIds([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  linkAddonsMutation.mutate({ menuItemId: manageAddonsItem.id, addonIds: selectedAddonIds });
                }}
                isLoading={linkAddonsMutation.isPending}
              >
                Save addons
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        title={editingItem ? `Edit: ${editingItem.name}` : 'Edit Menu Item'}
        size="large"
      >
        {editingItem && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editFormData.brand_id) {
                toast.error('Please select a brand');
                return;
              }
              if (!editFormData.category_id) {
                toast.error('Please select a category');
                return;
              }
              if (!editFormData.name?.trim()) {
                toast.error('Name is required');
                return;
              }
              const basePrice = parseFloat(editFormData.base_price);
              if (isNaN(basePrice) || basePrice < 0) {
                toast.error('Enter a valid price');
                return;
              }
              updateItemMutation.mutate({
                id: editingItem.id,
                data: {
                  brand_id: parseInt(editFormData.brand_id),
                  category_id: parseInt(editFormData.category_id),
                  name: editFormData.name.trim(),
                  description: editFormData.description?.trim() || undefined,
                  base_price: basePrice,
                  is_active: editFormData.is_active,
                  deal_only: editFormData.deal_only,
                  image_url: editFormData.image_url || null,
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
              <select
                value={editFormData.brand_id}
                onChange={(e) => setEditFormData((f) => ({ ...f, brand_id: e.target.value, category_id: '' }))}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={editFormData.category_id}
                onChange={(e) => setEditFormData((f) => ({ ...f, category_id: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select category</option>
                {(categoriesForEdit ?? []).map((c: { id: number; name: string }) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
              <input
                type="text"
                value={editFormData.name}
                onChange={(e) => setEditFormData((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={editFormData.description}
                onChange={(e) => setEditFormData((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-vertical"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Image (optional)</label>
              <input id="edit-item-image" type="file" accept="image/*" onChange={(e) => handleImageUpload(e, true)} disabled={editImageUploading} className="hidden" />
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50/50 transition-colors hover:border-gray-400 hover:bg-gray-50"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50'); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50');
                  const f = e.dataTransfer.files[0];
                  if (f) uploadImageFile(f, true);
                }}
              >
                {editFormData.image_url ? (
                  <div className="flex items-start gap-3">
                    <img src={getImageFullUrl(editFormData.image_url)} alt="" className="h-24 w-24 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-600 mb-2">Image uploaded.</p>
                      <div className="flex gap-2">
                        <Button type="button" size="small" variant="secondary" onClick={() => document.getElementById('edit-item-image')?.click()}>
                          Replace
                        </Button>
                        <Button type="button" size="small" variant="outline" onClick={() => setEditFormData((f) => ({ ...f, image_url: '' }))}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <label htmlFor="edit-item-image" className="flex flex-col items-center justify-center py-6 cursor-pointer text-center">
                    <span className="text-gray-500 text-sm mb-1">PNG, JPEG, GIF or WebP · max 5MB</span>
                    <span className="text-blue-600 font-medium text-sm">Click to upload or drag and drop</span>
                  </label>
                )}
              </div>
              {editImageUploading && <p className="text-xs text-amber-600 mt-2 font-medium">Uploading...</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editFormData.base_price}
                  onChange={(e) => setEditFormData((f) => ({ ...f, base_price: e.target.value }))}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={editFormData.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setEditFormData((f) => ({ ...f, is_active: e.target.value === 'active' }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit-deal-only"
                checked={editFormData.deal_only}
                onChange={(e) => setEditFormData((f) => ({ ...f, deal_only: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="edit-deal-only" className="text-sm text-gray-700">
                Deal only (hide from POS as standalone item; use only inside deals)
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
              <Button type="submit" isLoading={updateItemMutation.isPending}>Update</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Create Menu Item" size="large">
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!formData.brand_id) {
            toast.error('Please select a brand');
            return;
          }
          if (!formData.category_id) {
            toast.error('Please select a category');
            return;
          }
          if (!formData.name || formData.name.trim() === '') {
            toast.error('Please enter an item name');
            return;
          }
          if (!formData.base_price || parseFloat(formData.base_price) <= 0) {
            toast.error('Please enter a valid price');
            return;
          }
          createMutation.mutate({ ...formData, image_url: formData.image_url || undefined });
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
            <select
              value={formData.brand_id}
              onChange={(e) => setFormData({ ...formData, brand_id: e.target.value, category_id: '' })}
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
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-gray-700">Category *</label>
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => { setShowForm(false); setShowCategoryForm(true); }}
              >
                + New Category
              </Button>
            </div>
            <select
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
              required
              disabled={!formBrandId || !categoriesForForm?.length}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">
                {!formBrandId
                  ? 'Select a brand first'
                  : categoriesForForm?.length === 0
                    ? 'No categories — create one first'
                    : 'Select Category'}
              </option>
              {(categoriesForForm ?? []).map((category: { id: number; name: string }) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Name: *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Margherita Pizza"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description:</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Item description (optional)"
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-vertical"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Image (optional)</label>
            <input id="create-item-image" type="file" accept="image/*" onChange={(e) => handleImageUpload(e, false)} disabled={imageUploading} className="hidden" />
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50/50 transition-colors hover:border-gray-400 hover:bg-gray-50"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50'); }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50');
                const f = e.dataTransfer.files[0];
                if (f) uploadImageFile(f, false);
              }}
            >
              {formData.image_url ? (
                <div className="flex items-start gap-3">
                  <img src={getImageFullUrl(formData.image_url)} alt="" className="h-24 w-24 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-600 mb-2">Image uploaded.</p>
                    <div className="flex gap-2">
                      <Button type="button" size="small" variant="secondary" onClick={() => document.getElementById('create-item-image')?.click()}>
                        Replace
                      </Button>
                      <Button type="button" size="small" variant="outline" onClick={() => setFormData((p) => ({ ...p, image_url: '' }))}>
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <label htmlFor="create-item-image" className="flex flex-col items-center justify-center py-6 cursor-pointer text-center">
                  <span className="text-gray-500 text-sm mb-1">PNG, JPEG, GIF or WebP · max 5MB</span>
                  <span className="text-blue-600 font-medium text-sm">Click to upload or drag and drop</span>
                </label>
              )}
            </div>
            {imageUploading && <p className="text-xs text-amber-600 mt-2 font-medium">Uploading...</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price: *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.base_price}
                onChange={(e) => setFormData({ ...formData, base_price: e.target.value })}
                required
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status:</label>
              <select
                value={formData.is_active ? 'active' : 'inactive'}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'active' })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="create-deal-only"
              checked={formData.deal_only}
              onChange={(e) => setFormData({ ...formData, deal_only: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="create-deal-only" className="text-sm text-gray-700">
              Deal only (hide from POS as standalone item; use only inside deals)
            </label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create Menu Item
            </Button>
          </div>
        </form>
      </Modal>

      <div className="w-full space-y-3">
        {(!menuItems || menuItems.length === 0) ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No menu items found. Create your first menu item above!</p>
          </Card>
        ) : filteredMenuItems.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No items match your search. Try a different term.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedMenuItems.map((item: MenuItem, i: number) => {
                const imageUrl = (item as MenuItem & { image_url?: string }).image_url ? getImageFullUrl((item as MenuItem & { image_url?: string }).image_url) : null;
                return (
                  <AccentedListRow
                    key={item.id}
                    accent={item.is_active ? 'active' : 'inactive'}
                    imageUrl={imageUrl}
                    initial={item.name?.charAt(0) ?? 'M'}
                    title={item.name}
                    subtitle={
                      <>
                        {item.description && <p>{item.description}</p>}
                        <p>Category: {item.category?.name || 'N/A'}{item.brand_id != null ? ` · Brand: ${brands?.find((b) => b.id === item.brand_id)?.name ?? `#${item.brand_id}`}` : ''}</p>
                        <p>{formatCurrency(item.base_price)}{(item.variants?.length || item.addons?.length) ? ` · ${item.variants?.length ?? 0} variants, ${item.addons?.length ?? 0} addons` : ''}</p>
                      </>
                    }
                    statusLabel={item.is_active ? 'Active' : 'Inactive'}
                    statusVariant={item.is_active ? 'active' : 'inactive'}
                    animationIndex={i}
                    actions={
                      <>
                        <Button size="small" variant="edit" onClick={() => setEditingItem(item)}>Edit</Button>
                        <Button size="small" variant="secondary" onClick={() => setManageAddonsItem(item)}>Manage addons</Button>
                        <Button size="small" variant="danger" onClick={() => confirm(`Delete "${item.name}"? This action cannot be undone.`) && deleteMutation.mutate(item.id)} isLoading={deleteMutation.isPending}>Delete</Button>
                      </>
                    }
                  />
                );
              })}
            </AccentedList>
            <PaginationBar totalCount={filteredMenuItems.length} page={menuItemsPage} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setMenuItemsPage} itemLabel="items" />
          </>
        )}
      </div>
    </div>
  );
};

export default MenuItems;
