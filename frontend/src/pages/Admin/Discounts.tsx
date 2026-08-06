import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Discount } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import Card from '../../components/Card';
import OfferModal, { offerInput, offerLabel } from '../../components/OfferModal';
import SegToggle from '../../components/SegToggle';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';
import OfferChannelsField, {
  channelsToApi,
  channelsToForm,
  ALL_OFFER_CHANNELS,
} from '../../components/OfferChannelsField';
import { useAuth } from '../../contexts/AuthContext';
import {
  BrandScopeBadge,
  BrandScopeNotice,
  canEdit,
  removeDialog,
  removeLabel,
} from '../../components/OfferBrandScope';
import { useHasPermission } from '../../hooks/useHasPermission';
import RecordHistoryLink from '../../components/RecordHistoryLink';

interface Option {
  id: number;
  name: string;
  code?: string;
}

const Discounts: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreatePerm = useHasPermission('discounts:create');
  const canEditPerm = useHasPermission('discounts:edit');
  const canDeletePerm = useHasPermission('discounts:delete');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
  const { user } = useAuth();
  const allowedBrandIds = user?.allowed_brand_ids ?? null;
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    type: 'flat' as 'flat' | 'percentage' | 'buy_x_get_y',
    value: '',
    min_order_amount: '',
    max_discount_amount: '',
    requires_code: true,
    application_scope: 'whole_order' as 'whole_order' | 'category' | 'products',
    application_scope_ids: [] as number[],
    eligibility_branch_ids: [] as number[],
    eligibility_brand_ids: [] as number[],
    is_active: true,
    channels: [...ALL_OFFER_CHANNELS] as string[],
    valid_from: '',
    valid_until: '',
    valid_time_start: '',
    valid_time_end: '',
    valid_days_of_week: [] as number[],
    buy_quantity: '1',
    get_quantity: '1',
    get_discount_percent: '50',
    bogo_match_same_group: true,
  });

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['discounts'],
    queryFn: adminService.getDiscounts,
  });

  const { data: categories } = useQuery({
    queryKey: ['menuCategories'],
    queryFn: async () => {
      const res = await apiClient.get<Array<Option & { brandId?: number }>>('/admin/menu/categories');
      return res.data;
    },
  });
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await apiClient.get<Option[]>('/admin/branches');
      return res.data;
    },
  });
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<Option[]>('/admin/brands');
      return res.data;
    },
  });

  const discountList = discounts ?? [];
  const paginatedDiscounts = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return discountList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [discountList, page]);

  const createMutation = useMutation({
    mutationFn: adminService.createDiscount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      setShowForm(false);
      resetForm();
      toast.success('Discount created successfully!');
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message || 'Failed to create discount');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Discount> }) =>
      adminService.updateDiscount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      setShowForm(false);
      setEditingDiscount(null);
      resetForm();
      toast.success('Discount updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update discount');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteDiscount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast.success('Discount deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete discount');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      type: 'flat',
      value: '',
      min_order_amount: '',
      max_discount_amount: '',
      requires_code: true,
      application_scope: 'whole_order',
      application_scope_ids: [],
      eligibility_branch_ids: [],
      eligibility_brand_ids: [],
      is_active: true,
      channels: [...ALL_OFFER_CHANNELS],
      valid_from: '',
      valid_until: '',
      valid_time_start: '',
      valid_time_end: '',
      valid_days_of_week: [],
      buy_quantity: '1',
      get_quantity: '1',
      get_discount_percent: '50',
      bogo_match_same_group: true,
    });
  };

  const handleEdit = (discount: Discount) => {
    setEditingDiscount(discount);
    setFormData({
      name: discount.name,
      code: discount.code ?? '',
      type: discount.type,
      value: discount.value.toString(),
      min_order_amount: discount.min_order_amount?.toString() || '',
      max_discount_amount: discount.max_discount_amount?.toString() || '',
      requires_code: discount.requires_code ?? true,
      application_scope: (discount.application_scope ?? 'whole_order') as
        | 'whole_order'
        | 'category'
        | 'products',
      application_scope_ids: discount.application_scope_ids ?? [],
      eligibility_branch_ids: discount.eligibility_branch_ids ?? [],
      eligibility_brand_ids: discount.eligibility_brand_ids ?? [],
      is_active: discount.is_active,
      channels: channelsToForm(discount.channels),
      valid_from: discount.valid_from ? discount.valid_from.split('T')[0] : '',
      valid_until: discount.valid_until ? discount.valid_until.split('T')[0] : '',
      valid_time_start: discount.valid_time_start ?? '',
      valid_time_end: discount.valid_time_end ?? '',
      valid_days_of_week: discount.valid_days_of_week ?? [],
      buy_quantity: (discount.buy_quantity ?? 1).toString(),
      get_quantity: (discount.get_quantity ?? 1).toString(),
      get_discount_percent: (discount.get_discount_percent ?? 50).toString(),
      bogo_match_same_group: discount.bogo_match_same_group ?? true,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (
      (formData.application_scope === 'category' ||
        formData.application_scope === 'products') &&
      formData.application_scope_ids.length === 0
    ) {
      toast.error(
        `Please select at least one ${formData.application_scope === 'category' ? 'category' : 'product'}.`,
      );
      return;
    }
    if (formData.channels.length === 0) {
      toast.error('Select at least one channel (POS / app / web / kiosk).');
      return;
    }

    const data: Record<string, unknown> = {
      name: formData.name,
      type: formData.type,
      value: parseFloat(formData.value),
      min_order_amount:
        formData.min_order_amount.trim() === ''
          ? null
          : (() => {
              const n = parseFloat(formData.min_order_amount);
              return Number.isFinite(n) ? n : null;
            })(),
      max_discount_amount:
        formData.max_discount_amount.trim() === ''
          ? null
          : (() => {
              const n = parseFloat(formData.max_discount_amount);
              return Number.isFinite(n) ? n : null;
            })(),
      requires_code: false,
      application_scope: formData.application_scope,
      application_scope_ids:
        formData.application_scope === 'whole_order'
          ? undefined
          : formData.application_scope_ids.length
            ? formData.application_scope_ids
            : undefined,
      eligibility_branch_ids: formData.eligibility_branch_ids,
      eligibility_brand_ids: formData.eligibility_brand_ids,
      is_active: formData.is_active,
      channels: channelsToApi(formData.channels),
      valid_from: formData.valid_from || undefined,
      valid_until: formData.valid_until || undefined,
      valid_time_start: formData.valid_time_start || null,
      valid_time_end: formData.valid_time_end || null,
      valid_days_of_week: formData.valid_days_of_week.length
        ? formData.valid_days_of_week
        : null,
      ...(formData.type === 'buy_x_get_y'
        ? {
            buy_quantity: parseInt(formData.buy_quantity, 10) || 1,
            get_quantity: parseInt(formData.get_quantity, 10) || 1,
            get_discount_percent: parseFloat(formData.get_discount_percent) || 0,
            bogo_match_same_group: formData.bogo_match_same_group,
          }
        : {}),
    };

    if (editingDiscount) {
      updateMutation.mutate({
        id: editingDiscount.id,
        data: data as Partial<Discount>,
      });
    } else {
      createMutation.mutate(data as Partial<Discount>);
    }
  };

  const branchOptions: SearchableMultiSelectOption[] = (branches ?? []).map(
    (b) => ({ id: b.id, name: b.name, code: b.code }),
  );
  const brandOptions: SearchableMultiSelectOption[] = (brands ?? []).map(
    (b) => ({ id: b.id, name: b.name }),
  );
  // Category names repeat across brands (e.g. every brand has a "Deals").
  // Suffix each with its brand so they are distinguishable in the picker.
  const brandNameById = new Map((brands ?? []).map((b) => [b.id, b.name]));
  const categoryOptions: SearchableMultiSelectOption[] = (categories ?? []).map(
    (c) => {
      const brandName = c.brandId != null ? brandNameById.get(c.brandId) : undefined;
      return { id: c.id, name: brandName ? `${c.name} (${brandName})` : c.name };
    },
  );

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading discounts...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Discounts</h1>
        {canCreatePerm && <Button onClick={() => {
          setEditingDiscount(null);
          resetForm();
          setShowForm(true);
        }}>
          Add Discount
        </Button>}
      </div>

      <OfferModal
        open={showForm}
        onClose={() => { setShowForm(false); setEditingDiscount(null); }}
        title={editingDiscount ? 'Edit Discount' : 'Create Discount'}
        subtitle="Applies automatically at checkout — no code needed"
        width={960}
        icon={
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5V4a1 1 0 0 1 1-1h5.5L17 10.5 10.5 17z" /><circle cx="7" cy="7" r="1.3" />
          </svg>
        }
        footer={
          <>
            <div className="flex items-center gap-2.5">
              <SegToggle on={formData.is_active} onChange={(v) => setFormData({ ...formData, is_active: v })} ariaLabel="Active" />
              <span className="text-[13.5px] font-semibold text-gray-700">Active</span>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setShowForm(false); setEditingDiscount(null); }} className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-5 py-[11px] text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} className="rounded-[11px] bg-red-600 px-6 py-[11px] text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.97] disabled:opacity-60">{editingDiscount ? 'Update Discount' : 'Create Discount'}</button>
            </div>
          </>
        }
      >
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mb-5">
            <label className={offerLabel}>Name <span className="text-red-500">*</span></label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Weekend 10% off" className={offerInput} />
            <p className="mt-2 text-[12.5px] text-gray-500">
              Discounts here apply automatically (no code). For code / voucher offers use the <span className="font-semibold text-gray-700">Coupons</span> module.
            </p>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label className={offerLabel}>Type <span className="text-red-500">*</span></label>
              <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as 'flat' | 'percentage' | 'buy_x_get_y' })} className={offerInput}>
                <option value="flat">Flat Amount</option>
                <option value="percentage">Percentage</option>
                <option value="buy_x_get_y">Buy X Get Y (BOGO)</option>
              </select>
            </div>
            <div>
              <label className={offerLabel}>{formData.type === 'buy_x_get_y' ? 'Value (unused for BOGO)' : <>Value <span className="text-red-500">*</span></>}</label>
              <div className="relative">
                {formData.type !== 'buy_x_get_y' && (
                  <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-[13px] text-gray-400">{formData.type === 'percentage' ? '%' : 'Rs.'}</span>
                )}
                <input
                  type="number" step="0.01" min="0"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  disabled={formData.type === 'buy_x_get_y'}
                  placeholder={formData.type === 'percentage' ? '0-100' : '0.00'}
                  className={offerInput}
                  style={formData.type !== 'buy_x_get_y' ? { paddingLeft: formData.type === 'percentage' ? 34 : 40 } : undefined}
                />
              </div>
            </div>
          </div>

          {formData.type === 'buy_x_get_y' && (
            <div className="mb-5 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-xs text-amber-800">
                Buy X get Y: for every <b>Buy qty</b> eligible items, the cheapest <b>Get qty</b> are discounted. Use “Apply to” below to scope to pizza categories.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">Buy qty</label>
                  <input type="number" min="1" value={formData.buy_quantity} onChange={(e) => setFormData({ ...formData, buy_quantity: e.target.value })} className={offerInput} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">Get qty</label>
                  <input type="number" min="1" value={formData.get_quantity} onChange={(e) => setFormData({ ...formData, get_quantity: e.target.value })} className={offerInput} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-600">Get % off</label>
                  <input type="number" min="0" max="100" value={formData.get_discount_percent} onChange={(e) => setFormData({ ...formData, get_discount_percent: e.target.value })} className={offerInput} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={formData.bogo_match_same_group} onChange={(e) => setFormData({ ...formData, bogo_match_same_group: e.target.checked })} />
                Pair only within the same category &amp; size (e.g. 2nd Large pizza of same category half price)
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={offerLabel}>Min order amount</label>
              <input type="number" step="0.01" min="0" value={formData.min_order_amount} onChange={(e) => setFormData({ ...formData, min_order_amount: e.target.value })} placeholder="No minimum" className={offerInput} />
              <p className="mt-1.5 text-[12px] leading-snug text-gray-400">Applies only when subtotal is at least this. Empty = no minimum.</p>
            </div>
            <div>
              <label className={offerLabel}>Max discount amount</label>
              <input type="number" step="0.01" min="0" value={formData.max_discount_amount} onChange={(e) => setFormData({ ...formData, max_discount_amount: e.target.value })} placeholder="No cap" className={offerInput} />
              <p className="mt-1.5 text-[12px] leading-snug text-gray-400">Caps how much can be taken off. Empty = no cap.</p>
            </div>
          </div>

          <div className="my-5 h-px bg-gray-100" />

          {/* Apply to */}
          <div className="mb-5">
            <div className="mb-2.5 text-[13px] font-semibold text-gray-700">Apply to</div>
            <div className="flex gap-2.5">
              {([
                ['whole_order', 'Whole order'],
                ['category', 'Selected categories'],
              ] as const).map(([scope, lbl]) => {
                const on = formData.application_scope === scope;
                return (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setFormData({ ...formData, application_scope: scope, application_scope_ids: scope === 'whole_order' ? [] : formData.application_scope_ids })}
                    className={`flex flex-1 items-center gap-2.5 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-colors ${on ? 'border-red-600 bg-red-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                  >
                    <span className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-[1.5px] ${on ? 'border-red-600' : 'border-gray-300'}`}>
                      {on && <span className="h-2 w-2 rounded-full bg-red-600" />}
                    </span>
                    <span className={`text-sm font-semibold ${on ? 'text-red-700' : 'text-gray-700'}`}>{lbl}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[12.5px] text-gray-500">To discount specific products, use the <span className="font-semibold text-gray-700">Product Promotions</span> module.</p>
            {formData.application_scope === 'category' && (
              <div className="mt-3">
                <SearchableMultiSelect
                  options={categoryOptions}
                  selectedIds={formData.application_scope_ids}
                  onChange={(ids) => setFormData({ ...formData, application_scope_ids: ids })}
                  placeholder="Select categories..."
                  label="Categories"
                  required
                  maxHeight="14rem"
                />
              </div>
            )}
          </div>

          {/* Valid at (branches / brands) */}
          <div className="mb-5">
            <div className="text-[13px] font-semibold text-gray-700">Valid at</div>
            <div className="mb-3 text-[12.5px] text-gray-400">
              {allowedBrandIds == null
                ? 'Leave both empty for all branches & brands. Or limit to specific ones.'
                : 'Leave empty for all your branches. Or limit to specific ones.'}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SearchableMultiSelect
                options={branchOptions}
                selectedIds={formData.eligibility_branch_ids}
                onChange={(ids) => setFormData({ ...formData, eligibility_branch_ids: ids })}
                placeholder="All branches"
                label="Limit to branches (optional)"
                getOptionLabel={(o) => (o.code ? `${o.name} (${o.code})` : o.name)}
              />
              {allowedBrandIds == null && (
                <SearchableMultiSelect
                  options={brandOptions}
                  selectedIds={formData.eligibility_brand_ids}
                  onChange={(ids) => setFormData({ ...formData, eligibility_brand_ids: ids })}
                  placeholder="All brands"
                  label="Limit to brands (optional)"
                />
              )}
            </div>
          </div>

          {/* Date + time + day window */}
          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label className={offerLabel}>Valid from</label>
              <input type="date" value={formData.valid_from} onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })} className={offerInput} />
            </div>
            <div>
              <label className={offerLabel}>Valid until</label>
              <input type="date" value={formData.valid_until} onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })} className={offerInput} />
            </div>
            <div>
              <label className={offerLabel}>Valid time from</label>
              <input type="time" value={formData.valid_time_start} onChange={(e) => setFormData({ ...formData, valid_time_start: e.target.value })} className={offerInput} />
            </div>
            <div>
              <label className={offerLabel}>Valid time until</label>
              <input type="time" value={formData.valid_time_end} onChange={(e) => setFormData({ ...formData, valid_time_end: e.target.value })} className={offerInput} />
            </div>
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-[13px] font-semibold text-gray-700">Valid days <span className="font-normal text-gray-400">— empty = every day</span></label>
            <div className="flex flex-wrap gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
                const on = formData.valid_days_of_week.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        valid_days_of_week: on
                          ? formData.valid_days_of_week.filter((x) => x !== i)
                          : [...formData.valid_days_of_week, i].sort((a, b) => a - b),
                      })
                    }
                    className={`min-w-[52px] rounded-[10px] border-[1.5px] px-3 py-2.5 text-[13px] font-semibold transition-colors ${on ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <OfferChannelsField value={formData.channels} onChange={(channels) => setFormData({ ...formData, channels })} />
        </div>
      </OfferModal>

      <div className="w-full space-y-3">
        {discountList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No discounts found. Create your first discount!</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedDiscounts.map((discount, i) => (
                <AccentedListRow
                  key={discount.id}
                  accent={discount.is_active ? 'active' : 'inactive'}
                  initial={discount.name.charAt(0)}
                  title={discount.name}
                  subtitle={
                    <>
                      <p className="flex items-center gap-2 flex-wrap">
                        <span>Type: <span className="font-medium">{discount.type === 'flat' ? 'Flat' : 'Percentage'}</span> · Value: <span className="font-medium">{discount.type === 'percentage' ? `${discount.value}%` : formatCurrency(discount.value)}</span></span>
                        <BrandScopeBadge
                          effectiveBrandIds={discount.effective_brand_ids}
                          brandNameById={brandNameById}
                          allowedBrandIds={allowedBrandIds}
                        />
                      </p>
                      {discount.min_order_amount && <p>Min order: {formatCurrency(discount.min_order_amount)}</p>}
                      <BrandScopeNotice manageScope={discount.manage_scope} noun="discount" />
                    </>
                  }
                  statusLabel={discount.is_active ? 'Active' : 'Inactive'}
                  statusVariant={discount.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      {canEditPerm && canEdit(discount.manage_scope) && (
                        <>
                          <Button size="small" variant="edit" onClick={() => handleEdit(discount)}>Edit</Button>
                          <RecordHistoryLink entityType="discount" entityId={discount.id} label={discount.name} />
                          <Button
                            size="small"
                            variant={discount.is_active ? 'outline' : 'primary'}
                            isLoading={updateMutation.isPending}
                            onClick={() => updateMutation.mutate({ id: discount.id, data: { is_active: !discount.is_active } })}
                          >
                            {discount.is_active ? 'Set inactive' : 'Set active'}
                          </Button>
                        </>
                      )}
                      {canDeletePerm && discount.manage_scope !== 'read_only' && (
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => {
                            (async () => {
                              const ok = await confirmDialog(
                                removeDialog(discount.manage_scope, 'discount', discount.name),
                              );
                              if (!ok) return;
                              deleteMutation.mutate(discount.id);
                            })();
                          }}
                          isLoading={deleteMutation.isPending}
                        >
                          {removeLabel(discount.manage_scope)}
                        </Button>
                      )}
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={discountList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="discounts" />
          </>
        )}
      </div>
    </div>
  );
};

export default Discounts;
