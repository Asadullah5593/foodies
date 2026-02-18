import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

export interface CategoryItem {
  id: number;
  brand_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  brand?: { id: number; name: string; slug: string };
}

const Categories: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null);
  const [filterBrandId, setFilterBrandId] = useState<string>('');
  const [filterActive, setFilterActive] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('sort_order');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [formData, setFormData] = useState({
    brand_id: '',
    name: '',
    is_active: true,
    sort_order: '0',
  });

  const queryParams = React.useMemo(() => {
    const p: { brand_id?: number; is_active?: boolean; search?: string; sort?: string; order?: string } = {};
    if (filterBrandId) p.brand_id = parseInt(filterBrandId, 10);
    if (filterActive !== '') p.is_active = filterActive === 'active';
    if (filterSearch.trim()) p.search = filterSearch.trim();
    if (sortBy) p.sort = sortBy;
    if (sortOrder) p.order = sortOrder;
    return p;
  }, [filterBrandId, filterActive, filterSearch, sortBy, sortOrder]);

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories', queryParams],
    queryFn: () => adminService.getCategories(queryParams),
  });

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<{ id: number; name: string; slug: string }[]>('/admin/brands');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: adminService.createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setShowForm(false);
      resetForm();
      toast.success('Category created successfully!');
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message || 'Failed to create category');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; is_active?: boolean; sort_order?: number } }) =>
      adminService.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setShowForm(false);
      setEditingCategory(null);
      resetForm();
      toast.success('Category updated successfully!');
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message || 'Failed to update category');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success('Category deleted successfully!');
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message || 'Failed to delete category');
    },
  });

  const resetForm = () => {
    setFormData({ brand_id: '', name: '', is_active: true, sort_order: '0' });
  };

  const clearFilters = () => {
    setFilterBrandId('');
    setFilterActive('');
    setFilterSearch('');
    setSortBy('sort_order');
    setSortOrder('asc');
  };

  const openCreate = () => {
    setEditingCategory(null);
    setFormData({ brand_id: '', name: '', is_active: true, sort_order: '0' });
    setShowForm(true);
  };

  const openEdit = (cat: CategoryItem) => {
    setEditingCategory(cat);
    setFormData({
      brand_id: String(cat.brand_id),
      name: cat.name,
      is_active: cat.is_active,
      sort_order: String(cat.sort_order ?? 0),
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (editingCategory) {
      updateMutation.mutate({
        id: editingCategory.id,
        data: {
          name: formData.name.trim(),
          is_active: formData.is_active,
          sort_order: formData.sort_order ? parseInt(formData.sort_order, 10) : undefined,
        },
      });
    } else {
      if (!formData.brand_id) {
        toast.error('Please select a brand');
        return;
      }
      createMutation.mutate({
        brand_id: parseInt(formData.brand_id, 10),
        name: formData.name.trim(),
        is_active: formData.is_active,
        sort_order: formData.sort_order ? parseInt(formData.sort_order, 10) : undefined,
      });
    }
  };

  const hasActiveFilters = filterBrandId || filterActive !== '' || filterSearch.trim() || sortBy !== 'sort_order' || sortOrder !== 'asc';

  if (isLoading) return <Loader fullScreen text="Loading categories..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Categories</h1>
        <Button onClick={openCreate}>Add Category</Button>
      </div>

      <Card className="mb-4 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Filters</h4>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
            <select
              value={filterBrandId}
              onChange={(e) => setFilterBrandId(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
            >
              <option value="">All brands</option>
              {brands?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[120px]"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Search by name..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[180px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort by</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[140px]"
            >
              <option value="sort_order">Sort order</option>
              <option value="name">Name</option>
              <option value="created_at">Created at</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[100px]"
            >
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </select>
          </div>
          {hasActiveFilters && <ClearFiltersButton onClick={clearFilters} />}
        </div>
      </Card>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingCategory(null); }}
        title={editingCategory ? 'Edit Category' : 'Create Category'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingCategory && (
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
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          {editingCategory && (
            <p className="text-sm text-gray-500">
              Brand: <strong>{editingCategory.brand?.name ?? editingCategory.brand_id}</strong>
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort order</label>
            <input
              type="number"
              min={0}
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editingCategory ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="grid gap-4">
        {categories && categories.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">
              No categories found. Create one or adjust filters.
            </p>
          </Card>
        ) : (
          (categories ?? []).map((cat: CategoryItem) => (
            <Card key={cat.id} hover>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{cat.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Brand: {cat.brand?.name ?? `#${cat.brand_id}`}
                    {cat.sort_order != null && cat.sort_order !== 0 && (
                      <span className="ml-2">· Sort: {cat.sort_order}</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        cat.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {cat.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="small" variant="secondary" onClick={() => openEdit(cat)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete category "${cat.name}"?`)) {
                        deleteMutation.mutate(cat.id);
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

export default Categories;
