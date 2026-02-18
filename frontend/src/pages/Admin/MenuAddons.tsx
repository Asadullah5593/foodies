import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { useAuth } from '../../contexts/AuthContext';
import { MenuAddon } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

const MenuAddons: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingAddon, setEditingAddon] = useState<MenuAddon | null>(null);
  const [formData, setFormData] = useState({
    brand_id: '',
    name: '',
    price: '',
    is_active: true,
  });
  const [filters, setFilters] = useState<{
    brand_id: string;
    status: string;
    search: string;
  }>({ brand_id: '', status: '', search: '' });

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
    if (filters.search.trim()) p.search = filters.search.trim();
    return p;
  }, [effectiveBrandId, filters]);

  const { data: addons, isLoading } = useQuery({
    queryKey: ['addons', filterParams],
    queryFn: () => adminService.getAddons(Object.keys(filterParams).length ? filterParams : undefined),
    enabled: true,
  });

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

  if (isLoading) return <Loader fullScreen text="Loading addons..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Menu Addons</h1>
        <Button
          onClick={() => {
            setEditingAddon(null);
            setFormData({ brand_id: '', name: '', price: '', is_active: true });
            setShowForm(true);
          }}
        >
          Add Addon
        </Button>
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
              placeholder="Addon name..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
            />
          </div>
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

      <div className="grid gap-4">
        {(!addons || addons.length === 0) ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No addons found. Create your first addon!</p>
          </Card>
        ) : (
          addons?.map((addon) => {
            const addonBrandId = (addon as MenuAddon & { brand_id?: number }).brand_id;
            const brandName = addonBrandId != null ? (brands?.find((b) => b.id === addonBrandId)?.name ?? `#${addonBrandId}`) : null;
            return (
            <Card key={addon.id} hover>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-gray-800">{addon.name}</h3>
                    {(addon.is_active ?? addon.isActive) === false && (
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {brandName != null && (
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>Brand:</strong> {brandName}
                    </p>
                  )}
                  <p className="text-lg font-semibold text-green-600">{formatCurrency(Number(addon.price ?? 0))}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    <strong>Status:</strong>{' '}
                    <span className={((addon.is_active ?? addon.isActive) !== false) ? 'text-green-600' : 'text-red-600'}>
                      {((addon.is_active ?? addon.isActive) !== false) ? 'Active' : 'Inactive'}
                    </span>
                  </p>
                  {isSuperAdmin && (addon as MenuAddon & { tenant_name?: string }).tenant_name && (
                    <p className="text-xs text-gray-500 mt-1">Tenant: {(addon as MenuAddon & { tenant_name?: string }).tenant_name}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="small" variant="secondary" onClick={() => handleEdit(addon)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete addon "${addon.name}"?`)) {
                        deleteMutation.mutate(addon.id);
                      }
                    }}
                    isLoading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          );
          })
        )}
      </div>
    </div>
  );
};

export default MenuAddons;
