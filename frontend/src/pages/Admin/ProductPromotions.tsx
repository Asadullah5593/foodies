import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api/adminService';
import { Discount } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';
import ValidityFields, { emptyValidity } from '../../components/ValidityFields';
import OfferChannelsField, { channelsToApi, channelsToForm, ALL_OFFER_CHANNELS } from '../../components/OfferChannelsField';
import { confirmDialog } from '../../utils/sweetAlert';

const emptyForm = {
  name: '',
  type: 'percentage' as 'percentage' | 'flat',
  value: 10,
  application_scope_ids: [] as number[],
  max_discount_amount: '' as number | '',
  priority: 0,
  is_active: true,
  channels: [...ALL_OFFER_CHANNELS] as string[],
  ...emptyValidity,
};

const ProductPromotions: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const { data: promos, isLoading } = useQuery({ queryKey: ['product-promotions'], queryFn: adminService.getProductPromotions });
  const { data: menuItems } = useQuery({ queryKey: ['menu-items-all'], queryFn: () => adminService.getMenuItems() });
  const { data: deals } = useQuery({ queryKey: ['deals-all'], queryFn: () => adminService.getDeals() });

  const list = promos ?? [];
  // Product promotions apply to regular sellable products only — exclude deal
  // roots (combos, price-locked) and deal-only components.
  const dealIds = new Set(((deals as { id: number }[] | undefined) ?? []).map((d) => d.id));
  const productOptions: SearchableMultiSelectOption[] = (
    (menuItems as { id: number; name: string; deal_only?: boolean; deal_pricing_mode?: string | null }[] | undefined) ?? []
  )
    .filter((m) => !dealIds.has(m.id) && !m.deal_only && !m.deal_pricing_mode)
    .map((m) => ({ id: m.id, name: m.name }));
  const paginated = useMemo(() => list.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE), [list, page]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['product-promotions'] });
  const onErr = (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed');

  const createM = useMutation({
    mutationFn: adminService.createProductPromotion,
    onSuccess: () => { invalidate(); setShowForm(false); setForm({ ...emptyForm }); toast.success('Product promotion created'); },
    onError: onErr,
  });
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Discount> }) => adminService.updateProductPromotion(id, data),
    onSuccess: () => { invalidate(); setShowForm(false); setEditing(null); toast.success('Updated'); },
    onError: onErr,
  });
  const deleteM = useMutation({ mutationFn: adminService.deleteProductPromotion, onSuccess: () => { invalidate(); toast.success('Deleted'); }, onError: onErr });

  const handleEdit = (p: Discount) => {
    setEditing(p);
    setForm({
      name: p.name,
      type: p.type === 'flat' ? 'flat' : 'percentage',
      value: p.value,
      application_scope_ids: p.application_scope_ids ?? [],
      max_discount_amount: p.max_discount_amount ?? '',
      priority: p.priority ?? 0,
      is_active: p.is_active,
      channels: channelsToForm(p.channels),
      valid_from: p.valid_from ? p.valid_from.slice(0, 10) : '',
      valid_until: p.valid_until ? p.valid_until.slice(0, 10) : '',
      valid_time_start: p.valid_time_start ?? '',
      valid_time_end: p.valid_time_end ?? '',
      valid_days_of_week: p.valid_days_of_week ?? [],
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.application_scope_ids.length === 0) { toast.error('Select at least one product'); return; }
    if (!form.valid_from || !form.valid_until) { toast.error('Set the valid-from and valid-until dates'); return; }
    if (form.channels.length === 0) { toast.error('Select at least one channel (POS / app / web / kiosk)'); return; }
    const data: Partial<Discount> = {
      name: form.name,
      type: form.type,
      value: Number(form.value),
      application_scope_ids: form.application_scope_ids,
      max_discount_amount: form.max_discount_amount === '' ? undefined : Number(form.max_discount_amount),
      priority: Number(form.priority),
      is_active: form.is_active,
      channels: channelsToApi(form.channels),
      valid_from: form.valid_from || undefined,
      valid_until: form.valid_until || undefined,
      valid_time_start: form.valid_time_start || null,
      valid_time_end: form.valid_time_end || null,
      valid_days_of_week: form.valid_days_of_week,
    };
    if (editing) updateM.mutate({ id: editing.id, data });
    else createM.mutate(data);
  };

  if (isLoading) return <Loader fullScreen text="Loading product promotions..." />;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Product Promotions</h1>
        <Button onClick={() => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); }}>Add Promotion</Button>
      </div>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Product Promotion' : 'Create Product Promotion'} size="xlarge">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: what & how much */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm text-gray-700">Type</span>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'flat' | 'percentage' })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="percentage">Percentage</option>
                    <option value="flat">Flat (Rs)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm text-gray-700">Value</span>
                  <input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm text-gray-700">Max discount (Rs)</span>
                  <input type="number" min={0} value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="none" className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
                <label className="block">
                  <span className="text-sm text-gray-700">Priority</span>
                  <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
              </div>
              <div>
                <SearchableMultiSelect
                  options={productOptions}
                  selectedIds={form.application_scope_ids}
                  onChange={(ids) => setForm({ ...form, application_scope_ids: ids })}
                  placeholder="Search products…"
                  label={`Products * (${form.application_scope_ids.length} selected)`}
                  required
                  maxHeight="16rem"
                />
                <p className="text-xs text-gray-400 mt-1">Deals are excluded — they are price-locked and untouched by offers.</p>
              </div>
              <OfferChannelsField value={form.channels} onChange={(channels) => setForm({ ...form, channels })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            </div>

            {/* Right: validity (dates + time + days, same as discounts) */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Valid at (required)</h3>
              <ValidityFields
                requireDates
                value={{ valid_from: form.valid_from, valid_until: form.valid_until, valid_time_start: form.valid_time_start, valid_time_end: form.valid_time_end, valid_days_of_week: form.valid_days_of_week }}
                onChange={(v) => setForm({ ...form, ...v })}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end border-t pt-4">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" isLoading={createM.isPending || updateM.isPending}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <div className="w-full space-y-3">
        {list.length === 0 ? (
          <Card><p className="text-center text-gray-500 py-12">No product promotions yet.</p></Card>
        ) : (
          <>
            <AccentedList>
              {paginated.map((p, i) => (
                <AccentedListRow
                  key={p.id}
                  accent={p.is_active ? 'active' : 'inactive'}
                  initial={p.name.charAt(0)}
                  title={p.name}
                  subtitle={<p className="text-gray-500 text-xs">{p.type === 'flat' ? `Rs ${p.value} off` : `${p.value}% off`} · {p.application_scope_ids?.length ?? 0} product(s)</p>}
                  statusLabel={p.is_active ? 'Active' : 'Inactive'}
                  statusVariant={p.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => handleEdit(p)}>Edit</Button>
                      <Button size="small" variant={p.is_active ? 'outline' : 'primary'} onClick={() => updateM.mutate({ id: p.id, data: { is_active: !p.is_active } })}>{p.is_active ? 'Set inactive' : 'Set active'}</Button>
                      <Button size="small" variant="danger" onClick={async () => { if (await confirmDialog({ title: `Delete "${p.name}"?`, confirmText: 'Delete' })) deleteM.mutate(p.id); }}>Delete</Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={list.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="promotions" />
          </>
        )}
      </div>
    </div>
  );
};

export default ProductPromotions;
