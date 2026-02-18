import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { useAuth } from '../../contexts/AuthContext';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

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
  category?: {
    id: number;
    name: string;
  };
  variants?: { id: number; menu_item_id: number; name: string; price_modifier: number; is_default?: boolean }[];
  addons?: MenuItemAddon[];
}

interface MenuCategory {
  id: number;
  name: string;
  brand_id?: number;
}

const MenuItems: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
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
  });
  const [filters, setFilters] = useState<{
    brand_id: string;
    category_id: string;
    status: string;
    search: string;
  }>({ brand_id: '', category_id: '', status: '', search: '' });

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
    const p: { brand_id?: number; category_id?: number; is_active?: boolean; search?: string } = {};
    if (effectiveBrandId != null) p.brand_id = effectiveBrandId;
    if (filters.category_id) p.category_id = +filters.category_id;
    if (filters.status === 'active') p.is_active = true;
    if (filters.status === 'inactive') p.is_active = false;
    if (filters.search.trim()) p.search = filters.search.trim();
    return p;
  }, [effectiveBrandId, filters]);

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

  const [editFormData, setEditFormData] = useState({ brand_id: '', category_id: '', name: '', description: '', base_price: '', is_active: true });
  useEffect(() => {
    if (editingItem) {
      setEditFormData({
        brand_id: editingItem.brand_id != null ? String(editingItem.brand_id) : '',
        category_id: editingItem.category_id != null ? String(editingItem.category_id) : '',
        name: editingItem.name,
        description: editingItem.description ?? '',
        base_price: String(editingItem.base_price),
        is_active: editingItem.is_active,
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
    mutationFn: ({ id, data }: { id: number; data: { name: string; description?: string; base_price: number; is_active: boolean; brand_id?: number; category_id?: number } }) =>
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

  const createMutation = useMutation({
    mutationFn: async (data: { brand_id: string; category_id: string; name: string; description?: string; base_price: string; is_active: boolean }) => {
      if (!data.brand_id || !data.category_id) throw new Error('Select a brand and category');
      const payload = {
        brand_id: parseInt(data.brand_id),
        category_id: parseInt(data.category_id),
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        base_price: parseFloat(data.base_price),
        is_active: data.is_active,
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

  if (isLoading) return <Loader fullScreen text="Loading menu items..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Menu Items</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowCategoryForm(true)}>
            + New Category
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Add Menu Item'}
          </Button>
        </div>
      </div>

      <Card className="mb-4 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Filters</h4>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
            <select
              value={filters.brand_id}
              onChange={(e) => setFilters((f) => ({ ...f, brand_id: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm min-w-[180px]"
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <select
              value={filters.category_id}
              onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm min-w-[140px]"
            >
              <option value="">All categories</option>
              {categoriesForFilter.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm min-w-[120px]"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search by name</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Item name..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
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
          createMutation.mutate(formData);
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

      <div className="grid gap-4">
        {(!menuItems || menuItems.length === 0) ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No menu items found. Create your first menu item above!</p>
          </Card>
        ) : (
          menuItems?.map((item) => (
            <Card key={item.id} hover>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">{item.name}</h3>
                  {item.description && (
                    <p className="text-sm text-gray-600 mb-2">{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-2">
                    <span>
                      <strong>Category:</strong> {item.category?.name || 'N/A'}
                    </span>
                    {item.brand_id != null && (
                      <span>
                        <strong>Brand:</strong> {brands?.find((b) => b.id === item.brand_id)?.name ?? `#${item.brand_id}`}
                      </span>
                    )}
                    <span>
                      <strong>Price:</strong> <span className="font-semibold text-green-600">{formatCurrency(item.base_price)}</span>
                    </span>
                    <span>
                      <strong>Status:</strong>{' '}
                      <span className={`font-medium ${item.is_active ? 'text-green-600' : 'text-red-600'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </div>
                  {(item.variants?.length || item.addons?.length) ? (
                    <div className="text-xs text-gray-500 mt-1">
                      {item.variants?.length ? (
                        <span className="mr-3">Variants: {item.variants.map((v) => v.name).join(', ')}</span>
                      ) : null}
                      {item.addons?.length ? (
                        <span>Addons: {item.addons.map((a) => a.name).join(', ')}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setEditingItem(item);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setManageAddonsItem(item)}
                  >
                    Manage addons
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete "${item.name}"? This action cannot be undone.`)) {
                        deleteMutation.mutate(item.id);
                      }
                    }}
                    isLoading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default MenuItems;
