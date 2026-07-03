import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Promotion, CustomerPromotion } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';

const emptyForm = {
  name: '',
  description: '',
  image_url: '',
  promotion_type: 'discount' as 'discount' | 'free_item',
  discount_type: 'flat' as 'flat' | 'percentage',
  discount_value: '',
  free_menu_item_id: '',
  eligibility_type: 'new_customer' as 'new_customer' | 'manual',
  is_active: true,
  expires_in_days: '',
  valid_from: '',
  valid_until: '',
};

const Promotions: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [imageUploading, setImageUploading] = useState(false);

  // Assignments panel
  const [assignmentsPromotion, setAssignmentsPromotion] = useState<Promotion | null>(null);
  const [assignCustomerIds, setAssignCustomerIds] = useState<number[]>([]);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignedSearch, setAssignedSearch] = useState('');

  const { data: promotions, isLoading } = useQuery({
    queryKey: ['promotions'],
    queryFn: adminService.getPromotions,
  });

  const { data: menuItems } = useQuery({
    queryKey: ['menuItems'],
    queryFn: async () => {
      const res = await apiClient.get<{ id: number; name: string }[]>('/admin/menu/items');
      return res.data;
    },
  });

  const { data: assignments, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['promotionAssignments', assignmentsPromotion?.id],
    queryFn: () => adminService.getPromotionAssignments(assignmentsPromotion!.id),
    enabled: !!assignmentsPromotion,
  });

  const promotionList = promotions ?? [];
  const paginated = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return promotionList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [promotionList, page]);

  const createMutation = useMutation({
    mutationFn: adminService.createPromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setShowForm(false);
      setFormData({ ...emptyForm });
      toast.success('Promotion created successfully!');
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message || 'Failed to create promotion');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Promotion> }) =>
      adminService.updatePromotion(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setShowForm(false);
      setEditingPromotion(null);
      setFormData({ ...emptyForm });
      toast.success('Promotion updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update promotion');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deletePromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      toast.success('Promotion deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete promotion');
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ promotionId, customerId }: { promotionId: number; customerId: number }) =>
      adminService.assignPromotion(promotionId, customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotionAssignments', assignmentsPromotion?.id] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign promotion');
    },
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers-for-assign'],
    queryFn: adminService.getCustomers,
    enabled: !!assignmentsPromotion,
  });
  const assignedIds = useMemo(
    () => new Set((assignments ?? []).map((a: any) => Number(a.customer_id))),
    [assignments],
  );
  const customerOptions = useMemo(() => {
    const list: any[] = Array.isArray(customersData) ? customersData : ((customersData as any)?.items ?? []);
    return list
      .filter((c) => !assignedIds.has(Number(c.id)))
      .map((c) => ({ id: Number(c.id), name: c.name || c.full_name || `Customer #${c.id}`, code: c.phone || c.phone_number || undefined }));
  }, [customersData, assignedIds]);
  const visibleCustomers = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    if (!q) return customerOptions;
    return customerOptions.filter((c) => c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q));
  }, [customerOptions, assignSearch]);
  const filteredAssignments = useMemo(() => {
    const list = assignments ?? [];
    const q = assignedSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((cp) =>
      (cp.customer_name ?? '').toLowerCase().includes(q) ||
      (cp.customer_phone ?? '').toLowerCase().includes(q) ||
      String(cp.customer_id).includes(q),
    );
  }, [assignments, assignedSearch]);

  const handleEdit = (p: Promotion) => {
    setEditingPromotion(p);
    setFormData({
      name: p.name,
      description: p.description ?? '',
      image_url: p.image_url ?? '',
      promotion_type: p.promotion_type,
      discount_type: p.discount_type ?? 'flat',
      discount_value: p.discount_value?.toString() ?? '',
      free_menu_item_id: p.free_menu_item_id?.toString() ?? '',
      eligibility_type: p.eligibility_type,
      is_active: p.is_active,
      expires_in_days: p.expires_in_days?.toString() ?? '',
      valid_from: p.valid_from ? p.valid_from.slice(0, 10) : '',
      valid_until: p.valid_until ? p.valid_until.slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<Promotion> = {
      name: formData.name,
      description: formData.description || null,
      image_url: formData.image_url || null,
      promotion_type: formData.promotion_type,
      discount_type: formData.promotion_type === 'discount' ? formData.discount_type : null,
      discount_value: formData.promotion_type === 'discount' && formData.discount_value
        ? parseFloat(formData.discount_value)
        : null,
      free_menu_item_id: formData.promotion_type === 'free_item' && formData.free_menu_item_id
        ? parseInt(formData.free_menu_item_id)
        : null,
      eligibility_type: formData.eligibility_type,
      is_active: formData.is_active,
      expires_in_days: formData.expires_in_days ? parseInt(formData.expires_in_days) : null,
      valid_from: formData.valid_from || null,
      valid_until: formData.valid_until || null,
    };
    if (editingPromotion) {
      updateMutation.mutate({ id: editingPromotion.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const uploadImage = async (file: File) => {
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', 'promotions');
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!data?.url?.trim()) throw new Error('Upload did not return a URL');
      setFormData((prev) => ({ ...prev, image_url: data.url }));
      toast.success('Image uploaded');
    } catch {
      toast.error('Image upload failed');
    } finally {
      setImageUploading(false);
    }
  };

  const statusBadge = (status: CustomerPromotion['status']) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      claimed: 'bg-blue-100 text-blue-800',
      used: 'bg-green-100 text-green-800',
      expired: 'bg-gray-100 text-gray-600',
    };
    const label: Record<string, string> = {
      pending: 'Assigned',
      claimed: 'Claimed',
      used: 'Used',
      expired: 'Expired',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100'}`}>
        {label[status] ?? status}
      </span>
    );
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading promotions...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Promotions</h1>
        <Button onClick={() => { setEditingPromotion(null); setFormData({ ...emptyForm }); setShowForm(true); }}>
          Add Promotion
        </Button>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingPromotion(null); }}
        title={editingPromotion ? 'Edit Promotion' : 'Create Promotion'}
        size="large"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="Shown to the customer in the app (optional)"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Banner Image</label>
            <div className="flex items-center gap-3">
              {formData.image_url && (
                <img
                  src={formData.image_url}
                  alt="Preview"
                  className="h-14 w-24 object-cover rounded-md border border-gray-200"
                />
              )}
              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept="image/*"
                  id="promo-image-upload"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadImage(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  isLoading={imageUploading}
                  onClick={() => document.getElementById('promo-image-upload')?.click()}
                >
                  {formData.image_url ? 'Change Image' : 'Upload Image'}
                </Button>
              </div>
            </div>
          </div>

          {/* Promotion type — only editable on create */}
          {!editingPromotion && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Promotion Type *</label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="promotion_type"
                    checked={formData.promotion_type === 'discount'}
                    onChange={() => setFormData({ ...formData, promotion_type: 'discount' })}
                  />
                  <span>Discount coupon</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="promotion_type"
                    checked={formData.promotion_type === 'free_item'}
                    onChange={() => setFormData({ ...formData, promotion_type: 'free_item' })}
                  />
                  <span>Free item</span>
                </label>
              </div>
            </div>
          )}

          {/* Discount-specific fields */}
          {formData.promotion_type === 'discount' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type *</label>
                <select
                  value={formData.discount_type}
                  onChange={(e) => setFormData({ ...formData, discount_type: e.target.value as 'flat' | 'percentage' })}
                  required
                  disabled={!!editingPromotion}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                >
                  <option value="flat">Flat amount</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Value *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.discount_value}
                  onChange={(e) => setFormData({ ...formData, discount_value: e.target.value })}
                  required={!editingPromotion}
                  disabled={!!editingPromotion}
                  placeholder={formData.discount_type === 'percentage' ? '0–100' : '0.00'}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>
            </div>
          )}

          {/* Free-item-specific fields */}
          {formData.promotion_type === 'free_item' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Free Menu Item *</label>
              <select
                value={formData.free_menu_item_id}
                onChange={(e) => setFormData({ ...formData, free_menu_item_id: e.target.value })}
                required={!editingPromotion}
                disabled={!!editingPromotion}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="">Select a menu item...</option>
                {(menuItems ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Eligibility type — only on create */}
          {!editingPromotion && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Who gets this?</label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="eligibility_type"
                    checked={formData.eligibility_type === 'new_customer'}
                    onChange={() => setFormData({ ...formData, eligibility_type: 'new_customer' })}
                  />
                  <div>
                    <span className="font-medium">New customers</span>
                    <p className="text-xs text-gray-500">Auto-assigned when a customer registers (app, web, or POS), if the promotion is active and within its valid dates</p>
                  </div>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="eligibility_type"
                    checked={formData.eligibility_type === 'manual'}
                    onChange={() => setFormData({ ...formData, eligibility_type: 'manual' })}
                  />
                  <div>
                    <span className="font-medium">Manual</span>
                    <p className="text-xs text-gray-500">You assign it to specific customers</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Campaign window — when the promo is handed out to new customers */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid From</label>
              <input
                type="date"
                value={formData.valid_from}
                onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-0.5">Campaign start. New customers only receive this on or after this date. Leave empty to start immediately.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
              <input
                type="date"
                value={formData.valid_until}
                onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-0.5">Campaign end. New customers stop receiving this after this date. Leave empty for no end date.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expires After (days)</label>
              <input
                type="number"
                min="1"
                value={formData.expires_in_days}
                onChange={(e) => setFormData({ ...formData, expires_in_days: e.target.value })}
                placeholder="Never"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-0.5">Per customer. Days each recipient has to use it once they receive it, then their copy expires. Leave empty for no per-customer expiry.</p>
            </div>
            <div>
              <div className="flex items-center pt-1">
                <input
                  type="checkbox"
                  id="promo_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                <label htmlFor="promo_active" className="ml-2 text-sm font-medium text-gray-700">Active</label>
              </div>
              <p className="text-xs text-gray-500 mt-1">Master switch. Turning this off stops new hand-outs, expires copies not yet claimed, and disables coupons already claimed from it. Used ones stay in history.</p>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingPromotion(null); }}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editingPromotion ? 'Update' : 'Create'} Promotion
            </Button>
          </div>
        </form>
      </Modal>

      {/* Assignments modal */}
      <Modal
        isOpen={!!assignmentsPromotion}
        onClose={() => { setAssignmentsPromotion(null); setAssignCustomerIds([]); setAssignSearch(''); setAssignedSearch(''); }}
        title={`Assignments — ${assignmentsPromotion?.name ?? ''}`}
        size="large"
      >
        {assignmentsPromotion?.eligibility_type === 'manual' && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <input
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                placeholder="Search customers by name or phone…"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <Button
                isLoading={assignMutation.isPending}
                disabled={assignCustomerIds.length === 0}
                onClick={async () => {
                  if (!assignmentsPromotion || assignCustomerIds.length === 0) return;
                  const ids = [...assignCustomerIds];
                  try {
                    for (const customerId of ids) {
                      await assignMutation.mutateAsync({ promotionId: assignmentsPromotion.id, customerId });
                    }
                    setAssignCustomerIds([]);
                    toast.success(ids.length > 1 ? `Assigned to ${ids.length} customers` : 'Promotion assigned');
                  } catch {
                    /* per-assignment error already toasted */
                  }
                }}
              >
                Assign{assignCustomerIds.length ? ` (${assignCustomerIds.length})` : ''}
              </Button>
            </div>
            <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-100">
              {visibleCustomers.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-5">{customerOptions.length === 0 ? 'All customers are already assigned.' : 'No customers found.'}</p>
              ) : (
                visibleCustomers.map((c) => {
                  const checked = assignCustomerIds.includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setAssignCustomerIds((prev) => (checked ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                      />
                      <span className="text-sm text-gray-700">{c.name}{c.code ? <span className="ml-2 text-gray-400">{c.code}</span> : null}</span>
                    </label>
                  );
                })
              )}
            </div>
            {assignCustomerIds.length > 0 && (
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span>{assignCustomerIds.length} selected</span>
                <button type="button" onClick={() => setAssignCustomerIds([])} className="text-blue-600 hover:underline">Clear selection</button>
              </div>
            )}
          </div>
        )}

        {assignmentsLoading ? (
          <p className="text-center py-6 text-gray-500">Loading...</p>
        ) : (assignments ?? []).length === 0 ? (
          <p className="text-center py-6 text-gray-400">No customers assigned yet.</p>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <input
                value={assignedSearch}
                onChange={(e) => setAssignedSearch(e.target.value)}
                placeholder="Search assigned customers by name or phone…"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400 whitespace-nowrap">{filteredAssignments.length} of {(assignments ?? []).length}</span>
            </div>
            {filteredAssignments.length === 0 ? (
              <p className="text-center py-6 text-gray-400">No assigned customers match “{assignedSearch}”.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredAssignments.map((cp) => (
                  <div key={cp.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg text-sm">
                    <div>
                      <span className="font-medium">{cp.customer_name || `Customer #${cp.customer_id}`}</span>
                      {cp.customer_phone && <span className="ml-2 text-gray-400">{cp.customer_phone}</span>}
                      <span className="ml-3 text-gray-500">{cp.assigned_at?.split('T')[0]}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {cp.coupon_code && (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                          {cp.coupon_code}
                        </span>
                      )}
                      {statusBadge(cp.status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* List */}
      <div className="w-full space-y-3">
        {promotionList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">
              No promotions yet. Create your first promotion to offer deals to customers on the mobile app.
            </p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginated.map((promo, i) => (
                <AccentedListRow
                  key={promo.id}
                  accent={promo.is_active ? 'active' : 'inactive'}
                  initial={promo.name.charAt(0)}
                  title={promo.name}
                  subtitle={
                    <>
                      <p>
                        <span className="capitalize font-medium">{promo.promotion_type.replace('_', ' ')}</span>
                        {promo.promotion_type === 'discount' && promo.discount_value != null && (
                          <> · {promo.discount_type === 'percentage' ? `${promo.discount_value}%` : `PKR ${promo.discount_value}`} off</>
                        )}
                        {promo.promotion_type === 'free_item' && promo.free_menu_item_id && (
                          <> · Item #{promo.free_menu_item_id} free</>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">
                        {promo.eligibility_type === 'new_customer' ? 'Auto: new customers' : 'Manual assignment'}
                        {promo.expires_in_days && ` · Expires in ${promo.expires_in_days}d`}
                      </p>
                    </>
                  }
                  statusLabel={promo.is_active ? 'Active' : 'Inactive'}
                  statusVariant={promo.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      {promo.eligibility_type === 'manual' && (
                        <Button size="small" variant="outline" onClick={() => setAssignmentsPromotion(promo)}>
                          Assignments
                        </Button>
                      )}
                      <Button size="small" variant="edit" onClick={() => handleEdit(promo)}>Edit</Button>
                      <Button
                        size="small"
                        variant={promo.is_active ? 'outline' : 'primary'}
                        isLoading={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: promo.id, data: { is_active: !promo.is_active } })}
                      >
                        {promo.is_active ? 'Set inactive' : 'Set active'}
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        isLoading={deleteMutation.isPending}
                        onClick={() => {
                          (async () => {
                            const ok = await confirmDialog({
                              title: `Delete promotion "${promo.name}"?`,
                              text: 'This will also remove all customer assignments.',
                              confirmText: 'Delete',
                            });
                            if (!ok) return;
                            deleteMutation.mutate(promo.id);
                          })();
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={promotionList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="promotions" />
          </>
        )}
      </div>
    </div>
  );
};

export default Promotions;
