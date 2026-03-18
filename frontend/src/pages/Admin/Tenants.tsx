import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { Tenant } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';

const Tenants: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    status: 'active',
    legal_name: '',
    default_tax_rate: '',
    loyalty_enabled: false,
    owner_email: '',
    owner_password: '',
    owner_name: '',
  });
  const [page, setPage] = useState(1);

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const response = await apiClient.get<Tenant[]>('/admin/tenants');
      return response.data;
    },
  });

  const tenantList = tenants ?? [];
  const paginatedTenants = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return tenantList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [tenantList, page]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        status: data.status,
        owner_email: data.owner_email,
        owner_password: data.owner_password,
      };
      if (data.legal_name) payload.legal_name = data.legal_name;
      if (data.owner_name) payload.owner_name = data.owner_name;
      if (data.default_tax_rate !== '' && data.default_tax_rate != null) payload.default_tax_rate = Number(data.default_tax_rate);
      if (data.loyalty_enabled !== undefined) payload.loyalty_enabled = data.loyalty_enabled;
      const response = await apiClient.post('/admin/tenants', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setShowForm(false);
      setEditingTenant(null);
      resetForm();
      toast.success('Tenant created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create tenant');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const payload: Record<string, unknown> = {};
      if (data.name !== undefined) payload.name = data.name;
      if (data.status !== undefined) payload.status = data.status;
      if (data.legal_name !== undefined) payload.legal_name = data.legal_name;
      if (data.default_tax_rate !== '' && data.default_tax_rate != null) payload.default_tax_rate = Number(data.default_tax_rate);
      if (data.loyalty_enabled !== undefined) payload.loyalty_enabled = data.loyalty_enabled;
      const response = await apiClient.put(`/admin/tenants/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setShowForm(false);
      setEditingTenant(null);
      resetForm();
      toast.success('Tenant updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update tenant');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      status: 'active',
      legal_name: '',
      default_tax_rate: '',
      loyalty_enabled: false,
      owner_email: '',
      owner_password: '',
      owner_name: '',
    });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/tenants/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Tenant deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete tenant');
    },
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading tenants...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Tenants</h1>
        {isSuperAdmin && (
          <Button variant="primary" onClick={() => setShowForm(true)}>Add Tenant</Button>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditingTenant(null); resetForm(); }} title={editingTenant ? 'Edit Tenant' : 'Create Tenant'} size="medium">
        <form onSubmit={(e) => {
          e.preventDefault();
          if (editingTenant) {
            updateMutation.mutate({ id: editingTenant.id, data: formData });
          } else {
            createMutation.mutate(formData);
          }
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Enter tenant name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Legal name</label>
            <input
              type="text"
              value={formData.legal_name}
              onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Legal entity name"
            />
          </div>
          {!editingTenant && (
            <>
              <div className="border-t border-gray-200 pt-4 mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Tenant owner (login for this tenant)</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Owner name</label>
                    <input
                      type="text"
                      value={formData.owner_name}
                      onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. John Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Owner email *</label>
                    <input
                      type="email"
                      value={formData.owner_email}
                      onChange={(e) => setFormData({ ...formData, owner_email: e.target.value })}
                      required={!editingTenant}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="owner@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Owner password *</label>
                    <input
                      type="password"
                      value={formData.owner_password}
                      onChange={(e) => setFormData({ ...formData, owner_password: e.target.value })}
                      required={!editingTenant}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default tax rate (0–1)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={formData.default_tax_rate}
                onChange={(e) => setFormData({ ...formData, default_tax_rate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="0.1"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="loyalty_enabled"
              checked={formData.loyalty_enabled}
              onChange={(e) => setFormData({ ...formData, loyalty_enabled: e.target.checked })}
              className="rounded border-gray-300"
            />
            <label htmlFor="loyalty_enabled" className="text-sm font-medium text-gray-700">Loyalty enabled</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingTenant(null); resetForm(); }}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editingTenant ? 'Update Tenant' : 'Create Tenant'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="grid gap-4">
        {tenantList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No tenants found. Create your first tenant!</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedTenants.map((tenant, i) => (
                <AccentedListRow
                  key={tenant.id}
                  accent={tenant.status === 'active' ? 'active' : 'inactive'}
                  initial={tenant.name.charAt(0)}
                  title={tenant.name}
                  subtitle={
                    <>
                      {tenant.legal_name && <p>Legal: <span className="font-medium">{tenant.legal_name}</span></p>}
                      <p>Slug: <span className="font-mono">{tenant.slug}</span></p>
                      {tenant.loyalty_enabled != null && <p>Loyalty: {tenant.loyalty_enabled ? 'Yes' : 'No'}</p>}
                    </>
                  }
                  statusLabel={tenant.status}
                  statusVariant={tenant.status === 'active' ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => { setEditingTenant(tenant); setFormData({ name: tenant.name, status: tenant.status, legal_name: tenant.legal_name || '', default_tax_rate: tenant.default_tax_rate != null ? String(tenant.default_tax_rate) : '', loyalty_enabled: tenant.loyalty_enabled ?? false, owner_email: '', owner_password: '', owner_name: '' }); setShowForm(true); }}>Edit</Button>
                      <Button size="small" variant="danger" onClick={() => confirm(`Delete tenant "${tenant.name}"?`) && deleteMutation.mutate(tenant.id)} isLoading={deleteMutation.isPending}>Delete</Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={tenantList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="tenants" />
          </>
        )}
      </div>
    </div>
  );
};

export default Tenants;
