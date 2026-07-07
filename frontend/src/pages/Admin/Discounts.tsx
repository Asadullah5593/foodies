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
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';

interface Option {
  id: number;
  name: string;
  code?: string;
}

const Discounts: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
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
    valid_from: '',
    valid_until: '',
    valid_time_start: '',
    valid_time_end: '',
    valid_days_of_week: [] as number[],
    buy_quantity: '1',
    get_quantity: '1',
    get_discount_percent: '50',
    bogo_match_same_group: true,
    requires_card: false,
    eligible_bank_card_ids: [] as number[],
  });

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['discounts'],
    queryFn: adminService.getDiscounts,
  });

  const { data: categories } = useQuery({
    queryKey: ['menuCategories'],
    queryFn: async () => {
      const res = await apiClient.get<Option[]>('/admin/menu/categories');
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
  const { data: bankCards } = useQuery({
    queryKey: ['bank-cards'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: number; name: string; bank: string | null }>>('/admin/bank-cards');
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
      valid_from: '',
      valid_until: '',
      valid_time_start: '',
      valid_time_end: '',
      valid_days_of_week: [],
      buy_quantity: '1',
      get_quantity: '1',
      get_discount_percent: '50',
      bogo_match_same_group: true,
      requires_card: false,
      eligible_bank_card_ids: [],
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
      valid_from: discount.valid_from ? discount.valid_from.split('T')[0] : '',
      valid_until: discount.valid_until ? discount.valid_until.split('T')[0] : '',
      valid_time_start: discount.valid_time_start ?? '',
      valid_time_end: discount.valid_time_end ?? '',
      valid_days_of_week: discount.valid_days_of_week ?? [],
      buy_quantity: (discount.buy_quantity ?? 1).toString(),
      get_quantity: (discount.get_quantity ?? 1).toString(),
      get_discount_percent: (discount.get_discount_percent ?? 50).toString(),
      bogo_match_same_group: discount.bogo_match_same_group ?? true,
      requires_card: discount.requires_card ?? false,
      eligible_bank_card_ids: discount.eligible_bank_card_ids ?? [],
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

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
      requires_card: formData.requires_card,
      eligible_bank_card_ids: formData.requires_card ? formData.eligible_bank_card_ids : null,
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
  const categoryOptions: SearchableMultiSelectOption[] = (categories ?? []).map(
    (c) => ({ id: c.id, name: c.name }),
  );

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading discounts...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Discounts</h1>
        <Button onClick={() => {
          setEditingDiscount(null);
          resetForm();
          setShowForm(true);
        }}>
          Add Discount
        </Button>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingDiscount(null);
        }}
        title={editingDiscount ? 'Edit Discount' : 'Create Discount'}
        size="large"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
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

          </div>

          <p className="text-xs text-gray-500 -mt-2">
            Discounts here apply automatically (no code). For code/voucher offers use the{' '}
            <span className="font-medium">Coupons</span> module.
          </p>

          <div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requires_card"
                checked={formData.requires_card}
                onChange={(e) => setFormData({ ...formData, requires_card: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="requires_card" className="text-sm text-gray-700">
                Requires a specific bank card — applies only when the whole bill is paid by one of the selected cards
              </label>
            </div>
            {formData.requires_card && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(bankCards ?? []).length === 0 ? (
                  <span className="text-xs text-gray-500">No bank cards yet — add them under Bank Cards first.</span>
                ) : (
                  (bankCards ?? []).map((c) => {
                    const selected = formData.eligible_bank_card_ids.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setFormData({
                            ...formData,
                            eligible_bank_card_ids: selected
                              ? formData.eligible_bank_card_ids.filter((x) => x !== c.id)
                              : [...formData.eligible_bank_card_ids, c.id],
                          })
                        }
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                          selected
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-600 hover:border-blue-400'
                        }`}
                      >
                        {c.bank ? `${c.bank} — ${c.name}` : c.name}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as 'flat' | 'percentage' | 'buy_x_get_y' })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="flat">Flat Amount</option>
                <option value="percentage">Percentage</option>
                <option value="buy_x_get_y">Buy X Get Y (BOGO)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {formData.type === 'buy_x_get_y' ? 'Value (unused for BOGO)' : 'Value *'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                required={formData.type !== 'buy_x_get_y'}
                disabled={formData.type === 'buy_x_get_y'}
                placeholder={formData.type === 'percentage' ? '0-100' : '0.00'}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>

          {formData.type === 'buy_x_get_y' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
              <p className="text-xs text-amber-800">
                Buy X get Y: for every <b>Buy qty</b> eligible items, the cheapest <b>Get qty</b> are discounted. Use “Applies to” below to scope to pizza categories/products.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Buy qty</label>
                  <input type="number" min="1" value={formData.buy_quantity}
                    onChange={(e) => setFormData({ ...formData, buy_quantity: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Get qty</label>
                  <input type="number" min="1" value={formData.get_quantity}
                    onChange={(e) => setFormData({ ...formData, get_quantity: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Get % off</label>
                  <input type="number" min="0" max="100" value={formData.get_discount_percent}
                    onChange={(e) => setFormData({ ...formData, get_discount_percent: e.target.value })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.bogo_match_same_group}
                  onChange={(e) => setFormData({ ...formData, bogo_match_same_group: e.target.checked })} />
                Pair only within the same category &amp; size (e.g. 2nd Large pizza of same category half price)
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Order Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.min_order_amount}
                onChange={(e) =>
                  setFormData({ ...formData, min_order_amount: e.target.value })
                }
                placeholder="No minimum"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-0.5">
                Discount applies only when order subtotal is at least this amount. Leave empty for no minimum.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Discount Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.max_discount_amount}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    max_discount_amount: e.target.value,
                  })
                }
                placeholder="No cap"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-0.5">
                Caps how much can be taken off (e.g. 20% with max $10). Leave empty for no cap.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Apply to
            </label>
            <div className="flex flex-wrap gap-4 mb-3">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="application_scope"
                  checked={formData.application_scope === 'whole_order'}
                  onChange={() =>
                    setFormData({
                      ...formData,
                      application_scope: 'whole_order',
                      application_scope_ids: [],
                    })
                  }
                />
                <span>Whole order</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="application_scope"
                  checked={formData.application_scope === 'category'}
                  onChange={() =>
                    setFormData({ ...formData, application_scope: 'category' })
                  }
                />
                <span>Selected categories</span>
              </label>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              To discount specific products, use the{' '}
              <span className="font-medium">Product Promotions</span> module.
            </p>
            {formData.application_scope === 'category' && (
              <SearchableMultiSelect
                options={categoryOptions}
                selectedIds={formData.application_scope_ids}
                onChange={(ids) =>
                  setFormData({ ...formData, application_scope_ids: ids })
                }
                placeholder="Select categories..."
                label="Categories"
                required
                maxHeight="14rem"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Valid at
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Leave both empty for all branches &amp; brands. Or limit to
              specific branches and/or brands.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SearchableMultiSelect
                options={branchOptions}
                selectedIds={formData.eligibility_branch_ids}
                onChange={(ids) =>
                  setFormData({ ...formData, eligibility_branch_ids: ids })
                }
                placeholder="All branches"
                label="Limit to branches (optional)"
                getOptionLabel={(o) => (o.code ? `${o.name} (${o.code})` : o.name)}
              />
              <SearchableMultiSelect
                options={brandOptions}
                selectedIds={formData.eligibility_brand_ids}
                onChange={(ids) =>
                  setFormData({ ...formData, eligibility_brand_ids: ids })
                }
                placeholder="All brands"
                label="Limit to brands (optional)"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid From</label>
              <input
                type="date"
                value={formData.valid_from}
                onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Until</label>
              <input
                type="date"
                value={formData.valid_until}
                onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Recurring time-of-day + day-of-week window (branch timezone) — e.g. lunch deals Mon–Fri 12:00–16:00. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Time From</label>
              <input
                type="time"
                value={formData.valid_time_start}
                onChange={(e) => setFormData({ ...formData, valid_time_start: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid Time Until</label>
              <input
                type="time"
                value={formData.valid_time_end}
                onChange={(e) => setFormData({ ...formData, valid_time_end: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valid Days (leave empty = every day)</label>
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
                    className={`px-3 py-1.5 rounded-lg border text-sm ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 hover:bg-gray-50'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
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
                setEditingDiscount(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editingDiscount ? 'Update' : 'Create'} Discount
            </Button>
          </div>
        </form>
      </Modal>

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
                      <p>Type: <span className="font-medium">{discount.type === 'flat' ? 'Flat' : 'Percentage'}</span> · Value: <span className="font-medium">{discount.type === 'percentage' ? `${discount.value}%` : formatCurrency(discount.value)}</span></p>
                      {discount.min_order_amount && <p>Min order: {formatCurrency(discount.min_order_amount)}</p>}
                    </>
                  }
                  statusLabel={discount.is_active ? 'Active' : 'Inactive'}
                  statusVariant={discount.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => handleEdit(discount)}>Edit</Button>
                      <Button
                        size="small"
                        variant={discount.is_active ? 'outline' : 'primary'}
                        isLoading={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: discount.id, data: { is_active: !discount.is_active } })}
                      >
                        {discount.is_active ? 'Set inactive' : 'Set active'}
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => {
                          (async () => {
                            const ok = await confirmDialog({
                              title: `Delete discount "${discount.name}"?`,
                              text: 'This action cannot be undone.',
                              confirmText: 'Delete',
                            });
                            if (!ok) return;
                            deleteMutation.mutate(discount.id);
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
            <PaginationBar totalCount={discountList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="discounts" />
          </>
        )}
      </div>
    </div>
  );
};

export default Discounts;
