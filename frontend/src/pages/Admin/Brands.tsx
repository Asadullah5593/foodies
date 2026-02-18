import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { Brand } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');

function fullImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}

const initialFormData = { name: '', logo_url: '', description: '', status: 'active' as 'active' | 'inactive' };

const Brands: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [formData, setFormData] = useState<{ name: string; logo_url: string; description: string; status: 'active' | 'inactive' }>(initialFormData);
  const [uploading, setUploading] = useState(false);
  const [filterTenantId, setFilterTenantId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');

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
      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        if (!b.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [brands, filterTenantId, filterStatus, filterSearch]);

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
      });
      return response.data;
    },
    onSuccess: () => {
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

  if (isLoading) return <Loader fullScreen text="Loading brands..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Brands</h1>
        <Button onClick={openCreate}>Add Brand</Button>
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {isSuperAdmin && tenants && tenants.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tenant</label>
              <select
                value={filterTenantId}
                onChange={(e) => setFilterTenantId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[180px]"
              >
                <option value="">All tenants</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[120px]"
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
              placeholder="Brand name..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
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

      <div className="grid gap-4">
        {brands && brands.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No brands found. Create your first brand!</p>
          </Card>
        ) : filteredBrands.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No brands match the current filters.</p>
          </Card>
        ) : (
          filteredBrands.map(brand => (
            <Card key={brand.id} hover>
              <div className="flex justify-between items-center gap-4">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  {brand.logo_url ? (
                    <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                      <img
                        src={fullImageUrl(brand.logo_url)}
                        alt={brand.name}
                        className="w-full h-full object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 w-14 h-14 rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center text-gray-400 text-xl font-semibold">
                      {brand.name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-gray-800 mb-1">{brand.name}</h3>
                    {brand.tenant_name && (
                      <p className="text-sm text-gray-500 mb-1">
                        Tenant: <span className="font-medium text-indigo-600">{brand.tenant_name}</span>
                      </p>
                    )}
                    <p className="text-sm text-gray-600">
                      Status: <span className={`font-medium ${brand.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>{brand.status}</span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => openEdit(brand)}
                    disabled={updateMutation.isPending}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete brand "${brand.name}"?`)) {
                        deleteMutation.mutate(brand.id);
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

export default Brands;
