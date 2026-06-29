import React, { useMemo, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';

export interface CategoryItem {
  id: number;
  brand_id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  description?: string | null;
  image_url?: string | null;
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
  const debouncedFilterSearch = useDebouncedValue(filterSearch, 300);
  const [page, setPage] = useState(1);
  const [formData, setFormData] = useState({
    brand_id: '',
    name: '',
    is_active: true,
    sort_order: '0',
    description: '',
    image_url: '',
  });

  const queryParams = React.useMemo(() => {
    const p: { brand_id?: number; is_active?: boolean; search?: string } = {};
    if (filterBrandId) p.brand_id = parseInt(filterBrandId, 10);
    if (filterActive !== '') p.is_active = filterActive === 'active';
    if (debouncedFilterSearch.trim()) p.search = debouncedFilterSearch.trim();
    return p;
  }, [filterBrandId, filterActive, debouncedFilterSearch]);

  const { data: categories, isLoading, isFetching } = useQuery({
    queryKey: ['categories', queryParams],
    queryFn: () => adminService.getCategories(queryParams),
    placeholderData: (prev) => prev,
  });

  const suggestionOptions = React.useMemo(
    () =>
      (categories ?? []).map((c: CategoryItem) => ({
        id: String(c.id),
        label: c.name ?? '',
      })),
    [categories],
  );
  const searchTypeahead = useTypeaheadSuggestions({
    query: debouncedFilterSearch,
    options: suggestionOptions,
    minChars: 2,
    limit: 8,
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
    mutationFn: ({ id, data }: { id: number; data: { name?: string; is_active?: boolean; sort_order?: number; description?: string | null; image_url?: string | null } }) =>
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
    setFormData({ brand_id: '', name: '', is_active: true, sort_order: '0', description: '', image_url: '' });
  };

  const clearFilters = () => {
    setFilterBrandId('');
    setFilterActive('');
    setFilterSearch('');
  };

  const openCreate = () => {
    setEditingCategory(null);
    setFormData({ brand_id: '', name: '', is_active: true, sort_order: '0', description: '', image_url: '' });
    setShowForm(true);
  };

  const openEdit = (cat: CategoryItem) => {
    setEditingCategory(cat);
    setFormData({
      brand_id: String(cat.brand_id),
      name: cat.name,
      is_active: cat.is_active,
      sort_order: String(cat.sort_order ?? 0),
      description: cat.description ?? '',
      image_url: cat.image_url ?? '',
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
          description: formData.description.trim() || null,
          image_url: formData.image_url.trim() || null,
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
        description: formData.description.trim() || null,
        image_url: formData.image_url.trim() || null,
      });
    }
  };

  const hasActiveFilters = filterBrandId || filterActive !== '' || filterSearch.trim();

  const categoryList = categories ?? [];
  const paginatedCategories = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return categoryList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [categoryList, page]);

  React.useEffect(() => setPage(1), [filterBrandId, filterActive, debouncedFilterSearch]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (((categories == null || (categories as any[]).length === 0) && isLoading) || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading categories...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Categories</h1>
        <Button variant="primary" onClick={openCreate}>Add Category</Button>
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Brand"
            value={filterBrandId}
            onChange={setFilterBrandId}
            options={[
              { value: '', label: 'All brands' },
              ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            placeholder="All brands"
            minWidth="min-w-[200px]"
          />
          <SearchableSelect
            label="Status"
            value={filterActive}
            onChange={setFilterActive}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="All"
            minWidth="min-w-[120px]"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Search</label>
            <div className="relative">
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                onFocus={() => searchTypeahead.setOpen(true)}
                onKeyDown={(e) => {
                  const suggestions = searchTypeahead.suggestions;
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    searchTypeahead.setActiveIndex(Math.min(searchTypeahead.activeIndex + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    searchTypeahead.setActiveIndex(Math.max(searchTypeahead.activeIndex - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const opt = suggestions[searchTypeahead.activeIndex];
                    if (opt?.label) setFilterSearch(opt.label);
                    searchTypeahead.setOpen(false);
                  } else if (e.key === 'Escape') {
                    searchTypeahead.setOpen(false);
                  }
                }}
                placeholder="Search by name..."
                className="px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[180px]"
              />
              <TypeaheadDropdown
                open={searchTypeahead.open && filterSearch.trim().length >= 2}
                suggestions={searchTypeahead.suggestions}
                activeIndex={searchTypeahead.activeIndex}
                onHoverIndex={searchTypeahead.setActiveIndex}
                onSelect={(opt) => {
                  setFilterSearch(opt.label);
                  searchTypeahead.setOpen(false);
                }}
                onClose={() => searchTypeahead.setOpen(false)}
              />
            </div>
          </div>
          {isFetching && (
            <span className="text-xs text-gray-500 dark:text-slate-400 pb-1">
              Updating…
            </span>
          )}
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
            <input
              type="text"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              placeholder="https://…"
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

      <div className="w-full space-y-3">
        {categoryList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No categories found. Create one or adjust filters.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedCategories.map((cat: CategoryItem, i: number) => (
                <AccentedListRow
                  key={cat.id}
                  accent={cat.is_active ? 'active' : 'inactive'}
                  initial={cat.name.charAt(0)}
                  title={cat.name}
                  subtitle={`Brand: ${cat.brand?.name ?? `#${cat.brand_id}`}${cat.sort_order != null && cat.sort_order !== 0 ? ` · Sort: ${cat.sort_order}` : ''}`}
                  statusLabel={cat.is_active ? 'Active' : 'Inactive'}
                  statusVariant={cat.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => openEdit(cat)}>Edit</Button>
                      <Button
                        size="small"
                        variant={cat.is_active ? 'outline' : 'primary'}
                        isLoading={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: cat.id, data: { is_active: !cat.is_active } })}
                      >
                        {cat.is_active ? 'Set inactive' : 'Set active'}
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => {
                          (async () => {
                            const ok = await confirmDialog({
                              title: `Delete category "${cat.name}"?`,
                              text: 'This action cannot be undone.',
                              confirmText: 'Delete',
                            });
                            if (!ok) return;
                            deleteMutation.mutate(cat.id);
                          })();
                        }}
                        isLoading={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar
              totalCount={categoryList.length}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              onPageChange={setPage}
              itemLabel="categories"
            />
          </>
        )}
      </div>
    </div>
  );
};

export default Categories;
