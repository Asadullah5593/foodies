import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { Branch, Brand, MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import { adminService } from '../../services/api/adminService';

const Branches: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [formData, setFormData] = useState({
    brand_ids: [] as number[],
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    timezone: 'UTC',
    operating_hours: '',
    supports_dine_in: true,
    supports_takeaway: true,
    supports_pickup: true,
    supports_delivery: false,
    delivery_flat_fee: '',
    is_active: true,
    menu_enabled: true,
    status: 'active',
  });

  // Branch ↔ menu-items (copy-on-link): store tenant-level menu_item ids
  const [linkedMenuItemIds, setLinkedMenuItemIds] = useState<number[]>([]);

  const [filterBrandId, setFilterBrandId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');
  const [brandsDropdownOpen, setBrandsDropdownOpen] = useState(false);
  const brandsDropdownRef = useRef<HTMLDivElement>(null);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/brands');
      return response.data;
    },
  });

  const firstSelectedBrandId = formData.brand_ids[0] ?? null;
  const selectedBrand = useMemo(() => {
    if (!firstSelectedBrandId) return null;
    return (brands as Brand[] | undefined)?.find((b) => b.id === firstSelectedBrandId) ?? null;
  }, [brands, firstSelectedBrandId]);

  const brandIdsForMenu = formData.brand_ids?.length ? formData.brand_ids : [];

  const { data: brandMenuItems } = useQuery({
    queryKey: ['brandMenuItemsForBranch', brandIdsForMenu],
    queryFn: async () => {
      if (brandIdsForMenu.length === 0) return [];
      const results = await Promise.all(
        brandIdsForMenu.map((brandId) => adminService.getMenuItems({ brand_id: brandId })),
      );
      return results.flat();
    },
    enabled: brandIdsForMenu.length > 0,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (brandsDropdownRef.current && !brandsDropdownRef.current.contains(e.target as Node)) {
        setBrandsDropdownOpen(false);
      }
    };
    if (brandsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [brandsDropdownOpen]);

  // When editing a branch, pre-load linked items (via branch-menu-items source ids)
  useEffect(() => {
    const load = async () => {
      if (!editingBranch?.id) return;
      try {
        const list = await adminService.getBranchMenuItems(editingBranch.id);
        const ids = (list ?? [])
          .map((x: any) => x.menu_item_id ?? x.menuItemId)
          .filter((x: any) => typeof x === 'number' && Number.isFinite(x));
        setLinkedMenuItemIds(Array.from(new Set(ids)));
      } catch {
        // ignore; linking UI is optional
        setLinkedMenuItemIds([]);
      }
    };
    load();
  }, [editingBranch?.id]);

  const { data: branches, isLoading } = useQuery({
    queryKey: ['branches', filterBrandId || null],
    queryFn: async () => {
      const params = filterBrandId ? { brand_id: filterBrandId } : {};
      const response = await apiClient.get<Branch[]>('/admin/branches', { params });
      return response.data;
    },
  });

  const filteredBranches = React.useMemo(() => {
    if (!branches) return [];
    return branches.filter((b) => {
      if (filterStatus && b.status !== filterStatus) return false;
      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        if (!b.name.toLowerCase().includes(q) && !(b.code || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [branches, filterStatus, filterSearch]);

  const hasActiveFilters = filterBrandId || filterStatus || filterSearch.trim();
  const clearFilters = () => {
    setFilterBrandId('');
    setFilterStatus('');
    setFilterSearch('');
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload: Record<string, unknown> = {
        brand_ids: data.brand_ids,
        name: data.name,
        address: data.address || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        timezone: data.timezone || 'UTC',
        supports_dine_in: data.supports_dine_in,
        supports_takeaway: data.supports_takeaway,
        supports_pickup: data.supports_pickup,
        supports_delivery: data.supports_delivery,
        delivery_flat_fee: data.delivery_flat_fee ? +data.delivery_flat_fee : 0,
        is_active: data.is_active,
        menu_enabled: data.menu_enabled,
        status: data.status,
      };
      if (linkedMenuItemIds.length) payload.menu_item_ids = linkedMenuItemIds;
      if (data.operating_hours.trim()) {
        try { payload.operating_hours = JSON.parse(data.operating_hours); } catch { /* ignore */ }
      }
      const response = await apiClient.post('/admin/branches', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      setShowForm(false);
      setEditingBranch(null);
      resetForm();
      toast.success('Branch created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create branch');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        code: data.code,
        address: data.address || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        timezone: data.timezone || 'UTC',
        supports_dine_in: data.supports_dine_in,
        supports_takeaway: data.supports_takeaway,
        supports_pickup: data.supports_pickup,
        supports_delivery: data.supports_delivery,
        delivery_flat_fee: data.delivery_flat_fee ? +data.delivery_flat_fee : 0,
        is_active: data.is_active,
        menu_enabled: data.menu_enabled,
        status: data.status,
      };
      if (data.brand_ids.length) payload.brand_ids = data.brand_ids;
      payload.menu_item_ids = linkedMenuItemIds;
      if (data.operating_hours.trim()) {
        try { payload.operating_hours = JSON.parse(data.operating_hours); } catch { /* ignore */ }
      }
      const response = await apiClient.put(`/admin/branches/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      setShowForm(false);
      setEditingBranch(null);
      resetForm();
      toast.success('Branch updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update branch');
    },
  });

  const resetForm = () => {
    setFormData({
      brand_ids: [],
      name: '',
      code: '',
      address: '',
      phone: '',
      email: '',
      timezone: 'UTC',
      operating_hours: '',
      supports_dine_in: true,
      supports_takeaway: true,
      supports_pickup: true,
      supports_delivery: false,
      delivery_flat_fee: '',
      is_active: true,
      menu_enabled: true,
      status: 'active',
    });
    setLinkedMenuItemIds([]);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/branches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete branch');
    },
  });

  if (isLoading) return <Loader fullScreen text="Loading branches..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Branches</h1>
        <Button onClick={() => setShowForm(true)}>Add Branch</Button>
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
            <select
              value={filterBrandId}
              onChange={(e) => setFilterBrandId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
            >
              <option value="">All brands</option>
              {brands?.map((brand: { id: number; name: string; tenant_name?: string }) => (
                <option key={brand.id} value={brand.id}>
                  {brand.tenant_name ? `${brand.name} (${brand.tenant_name})` : brand.name}
                </option>
              ))}
            </select>
          </div>
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
              placeholder="Name or code..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
            />
          </div>
          <ClearFiltersButton onClick={clearFilters} />
        </div>
      </Card>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditingBranch(null); setBrandsDropdownOpen(false); resetForm(); }} title={editingBranch ? 'Edit Branch' : 'Create Branch'} size="large">
        <form onSubmit={(e) => {
          e.preventDefault();
          const hasOrderType =
            formData.supports_dine_in ||
            formData.supports_takeaway ||
            formData.supports_pickup ||
            formData.supports_delivery;
          if (!hasOrderType) {
            toast.error('At least one order type (Dine-in, Takeaway, Pickup or Delivery) must be selected.');
            return;
          }
          if (editingBranch) {
            updateMutation.mutate({ id: editingBranch.id, data: formData });
          } else {
            createMutation.mutate(formData);
          }
        }} className="space-y-4">
          <div className="relative" ref={brandsDropdownRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editingBranch ? 'Brands' : 'Brands *'}
            </label>
            <button
              type="button"
              onClick={() => setBrandsDropdownOpen((o) => !o)}
              className="w-full px-4 py-2.5 text-left border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex items-center justify-between gap-2"
            >
              <span className={formData.brand_ids.length ? 'text-gray-800' : 'text-gray-500'}>
                {formData.brand_ids.length
                  ? (brands as Brand[]).filter((b) => formData.brand_ids.includes(b.id)).map((b) => b.name).join(', ') ||
                    `${formData.brand_ids.length} selected`
                  : 'Select brands...'}
              </span>
              <svg
                className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${brandsDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {brandsDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
                {!brands?.length ? (
                  <p className="p-3 text-sm text-gray-500">No brands found.</p>
                ) : (
                  <ul className="py-1">
                    {(brands as Brand[]).map((brand) => {
                      const selected = formData.brand_ids.includes(brand.id);
                      const label =
                        (brand as Brand & { tenant_name?: string }).tenant_name
                          ? `${brand.name} (${(brand as Brand & { tenant_name?: string }).tenant_name})`
                          : brand.name;
                      return (
                        <li key={brand.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setFormData((prev) => ({
                                ...prev,
                                brand_ids: selected
                                  ? prev.brand_ids.filter((id) => id !== brand.id)
                                  : Array.from(new Set([...prev.brand_ids, brand.id])),
                              }));
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-gray-100 ${
                              selected ? 'bg-blue-50 text-blue-800' : 'text-gray-700'
                            }`}
                          >
                            <span
                              className={`inline-flex w-4 h-4 shrink-0 rounded border items-center justify-center ${
                                selected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                              }`}
                            >
                              {selected && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            {label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Select one or more brands (e.g. food court: multiple brands at one branch).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            {editingBranch ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                <input
                  type="text"
                  value={formData.code}
                  readOnly
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
                  title="Branch code is auto-generated and cannot be changed"
                />
              </div>
            ) : (
              <div className="flex items-center text-sm text-gray-500">
                Code will be auto-generated when you save.
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <input
              type="text"
              value={formData.timezone}
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="UTC"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Operating hours (JSON, optional)</label>
            <textarea
              value={formData.operating_hours}
              onChange={(e) => setFormData({ ...formData, operating_hours: e.target.value })}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder='{"mon":"9-17","tue":"9-17"}'
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={formData.supports_dine_in} onChange={(e) => setFormData({ ...formData, supports_dine_in: e.target.checked })} /> Dine-in</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={formData.supports_takeaway} onChange={(e) => setFormData({ ...formData, supports_takeaway: e.target.checked })} /> Takeaway</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={formData.supports_pickup} onChange={(e) => setFormData({ ...formData, supports_pickup: e.target.checked })} /> Pickup</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={formData.supports_delivery} onChange={(e) => setFormData({ ...formData, supports_delivery: e.target.checked })} /> Delivery</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Delivery flat fee</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.delivery_flat_fee}
              onChange={(e) => setFormData({ ...formData, delivery_flat_fee: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Active</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.menu_enabled} onChange={(e) => setFormData({ ...formData, menu_enabled: e.target.checked })} className="rounded border-gray-300" />
              <span className="text-sm font-medium text-gray-700">Menu enabled</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Link menu items to this branch
            </label>
            <div className="border border-gray-200 rounded-lg p-3 max-h-56 overflow-y-auto bg-gray-50">
              {!brandMenuItems?.length ? (
                <p className="text-sm text-gray-500">
                  {brandIdsForMenu.length === 0
                    ? 'Select at least one brand first to load menu items.'
                    : 'No menu items found for the selected brands.'}
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(brandMenuItems as MenuItem[]).map((mi) => (
                    <label key={mi.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={linkedMenuItemIds.includes(mi.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setLinkedMenuItemIds((prev) =>
                            checked ? Array.from(new Set([...prev, mi.id])) : prev.filter((x) => x !== mi.id),
                          );
                        }}
                      />
                      <span className="flex-1">
                        {mi.name}
                        <span className="text-gray-500"> ({formatCurrency(Number(mi.base_price))})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Links brand menu items to this branch (they will appear in POS for this branch). Uncheck to remove from branch; brand items stay intact.
            </p>
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
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingBranch(null); resetForm(); }}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createMutation.isPending || updateMutation.isPending}
              disabled={formData.brand_ids.length === 0}
            >
              {editingBranch ? 'Update Branch' : 'Create Branch'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="grid gap-4">
        {branches && branches.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No branches found. Create your first branch!</p>
          </Card>
        ) : filteredBranches.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No branches match the current filters.</p>
          </Card>
        ) : (
          filteredBranches.map(branch => (
            <Card key={branch.id} hover>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">{branch.name}</h3>
                  {(branch.tenant_name || (branch.brand_names?.length ?? 0) > 0) && (
                    <p className="text-sm text-gray-500 mb-1">
                      {branch.tenant_name && <span className="font-medium text-indigo-600">{branch.tenant_name}</span>}
                      {branch.tenant_name && branch.brand_names?.length && ' → '}
                      {branch.brand_names?.length ? <span>{branch.brand_names.join(', ')}</span> : null}
                    </p>
                  )}
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Code: <span className="font-mono font-medium">{branch.code}</span></p>
                    {branch.address && <p>Address: {branch.address}</p>}
                    <p>Status: <span className={`font-medium ${branch.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>{branch.status}</span></p>
                    <p>Menu: <span className={branch.menu_enabled !== false ? 'text-green-600' : 'text-amber-600'}>{branch.menu_enabled !== false ? 'Enabled' : 'Disabled'}</span></p>
                    {branch.delivery_flat_fee != null && <p>Delivery fee: {formatCurrency(Number(branch.delivery_flat_fee))}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="small" variant="outline" onClick={() => {
                    setEditingBranch(branch);
                    setLinkedMenuItemIds([]);
                    setFormData({
                      brand_ids: branch.brand_ids ?? [],
                      name: branch.name,
                      code: branch.code,
                      address: branch.address || '',
                      phone: branch.phone || '',
                      email: branch.email || '',
                      timezone: branch.timezone || 'UTC',
                      operating_hours: branch.operating_hours ? JSON.stringify(branch.operating_hours, null, 2) : '',
                      supports_dine_in: branch.supports_dine_in ?? true,
                      supports_takeaway: branch.supports_takeaway ?? true,
                      supports_pickup: branch.supports_pickup ?? true,
                      supports_delivery: branch.supports_delivery ?? false,
                      delivery_flat_fee: branch.delivery_flat_fee != null ? String(branch.delivery_flat_fee) : '',
                      is_active: branch.is_active ?? true,
                      menu_enabled: branch.menu_enabled ?? true,
                      status: branch.status,
                    });
                    setShowForm(true);
                  }}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete branch "${branch.name}"?`)) {
                        deleteMutation.mutate(branch.id);
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

export default Branches;
