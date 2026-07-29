import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdOutlineVolunteerActivism, MdEdit, MdDelete, MdInfoOutline } from 'react-icons/md';
import { adminService } from '../../services/api';
import SegToggle from '../../components/SegToggle';
import OfferModal, { offerInput, offerLabel } from '../../components/OfferModal';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';
import { useAuth } from '../../contexts/AuthContext';
import {
  BrandScopeBadge,
  BrandScopeNotice,
  canEdit,
  removeDialog,
  removeLabel,
} from '../../components/OfferBrandScope';
import { useHasPermission } from '../../hooks/useHasPermission';
import apiClient from '../../utils/apiClient';
import { confirmDialog } from '../../utils/sweetAlert';
import { StaffDiscount } from '../../types';

const emptyForm = {
  name: '',
  discount_type: 'percentage' as 'percentage' | 'flat',
  value: '' as number | '',
  max_discount_amount: '' as number | '',
  eligibility_brand_ids: [] as number[],
  sort_order: '' as number | '',
  is_active: true,
};

/** What the button will say at the till. */
const buttonText = (p: { discount_type: string; value: number }): string =>
  p.discount_type === 'flat' ? `Rs. ${Number(p.value).toLocaleString('en-US')} off` : `${p.value}%`;

/**
 * Staff discounts — the give-away buttons a cashier sees on the POS checkout.
 * Kept apart from Discounts & Promotions on purpose: an offer is earned by the
 * cart, this is discretion exercised by a person, and mixing the two made both
 * screens ambiguous.
 */
const StaffDiscounts: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreatePerm = useHasPermission('staff-discounts:create');
  const canEditPerm = useHasPermission('staff-discounts:edit');
  const canDeletePerm = useHasPermission('staff-discounts:delete');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { user } = useAuth();
  const allowedBrandIds = user?.allowed_brand_ids ?? null;

  const { data: presets, isLoading } = useQuery({
    queryKey: ['staff-discounts'],
    queryFn: () => adminService.getStaffDiscounts(false),
  });
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return res.data;
    },
  });

  const brandOptions: SearchableMultiSelectOption[] = (brands ?? []).map((b) => ({ id: b.id, name: b.name }));
  const brandNameById = useMemo(
    () => new Map((brands ?? []).map((b) => [b.id, b.name])),
    [brands],
  );

  const close = () => {
    setShowForm(false);
    setForm(emptyForm);
    setEditingId(null);
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        discount_type: form.discount_type,
        value: form.value === '' ? null : Number(form.value),
        // A cap only means anything on a percentage; the server rejects it on flat.
        max_discount_amount:
          form.discount_type === 'flat' || form.max_discount_amount === ''
            ? null
            : Number(form.max_discount_amount),
        eligibility_brand_ids: form.eligibility_brand_ids,
        sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
        is_active: form.is_active,
      };
      return editingId != null
        ? adminService.updateStaffDiscount(editingId, payload)
        : adminService.createStaffDiscount(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-discounts'] });
      toast.success(editingId != null ? 'Staff discount updated' : 'Staff discount added');
      close();
    },
    onError: (e: unknown) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to save staff discount',
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteStaffDiscount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-discounts'] });
      toast.success('Staff discount removed');
    },
    onError: (e: unknown) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to remove staff discount',
      ),
  });

  const startEdit = (p: StaffDiscount) => {
    setEditingId(p.id);
    setShowForm(true);
    setForm({
      name: p.name,
      discount_type: p.discount_type === 'flat' ? 'flat' : 'percentage',
      value: p.value,
      max_discount_amount: p.max_discount_amount ?? '',
      eligibility_brand_ids: p.eligibility_brand_ids ?? [],
      sort_order: p.sort_order ?? '',
      is_active: p.is_active,
    });
  };

  const list = (presets ?? []) as StaffDiscount[];
  const activeCount = list.filter((p) => p.is_active).length;

  const submit = () => {
    if (!form.name.trim()) {
      toast.error('Give the button a name');
      return;
    }
    if (form.value === '' || Number(form.value) <= 0) {
      toast.error('Value must be greater than zero');
      return;
    }
    if (form.discount_type === 'percentage' && Number(form.value) >= 100) {
      toast.error('A staff discount must be under 100%. To write off a whole bill, void or refund the order.');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MdOutlineVolunteerActivism size={24} />
        </span>
        <div className="min-w-[280px] flex-1">
          <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">Staff Discounts</h1>
          <p className="max-w-[760px] text-[14px] leading-relaxed text-gray-500">
            Buttons a cashier can tap on the checkout screen to take something off the bill — for a long wait, a
            complaint, a staff meal. Each cashier only sees the ones within their role&apos;s limit, set under{' '}
            <span className="font-semibold text-gray-700">Roles</span>. Who gave what away shows under{' '}
            <span className="font-semibold text-gray-700">Reports → Discounts</span>.
          </p>
        </div>
        {canCreatePerm && <button
          type="button"
          onClick={openAdd}
          className="inline-flex flex-none items-center gap-2 rounded-[11px] bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98]"
        >
          <span className="text-lg leading-none">+</span>Add a button
        </button>}
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-[11px] border border-amber-100 bg-amber-50/60 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
        <MdInfoOutline size={16} className="mt-px shrink-0" />
        <span>
          Name these for the occasion — <span className="font-semibold">&ldquo;10% – Long wait&rdquo;</span>,{' '}
          <span className="font-semibold">&ldquo;Staff meal&rdquo;</span> — and the discount report groups give-aways
          by reason without the cashier having to type one.
        </span>
      </div>

      {/* List */}
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-wider text-gray-400">Buttons · {list.length}</span>
        <span className="text-[12.5px] text-gray-400">{activeCount} active</span>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <div
              key={p.id}
              className={`flex min-h-[150px] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-[20px] shadow-sm transition-shadow hover:shadow-md ${p.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[26px] font-extrabold leading-none tracking-tight text-red-600">
                      {buttonText(p)}
                    </span>
                    <BrandScopeBadge
                      effectiveBrandIds={p.effective_brand_ids}
                      brandNameById={brandNameById}
                      allowedBrandIds={allowedBrandIds}
                    />
                  </div>
                  <div className="mt-2 truncate text-[15px] font-semibold text-gray-800">{p.name}</div>
                  <BrandScopeNotice manageScope={p.manage_scope} noun="staff discount" />
                </div>
                <div className="flex flex-none gap-1.5">
                  {canEditPerm && canEdit(p.manage_scope) && (
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      title="Edit"
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
                    >
                      <MdEdit size={15} />
                    </button>
                  )}
                  {canDeletePerm && p.manage_scope !== 'read_only' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirmDialog(removeDialog(p.manage_scope, 'staff discount', p.name)))
                          deleteMutation.mutate(p.id);
                      }}
                      title={removeLabel(p.manage_scope)}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gray-100 text-red-500 transition-colors hover:bg-red-100"
                    >
                      <MdDelete size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between gap-3 border-t border-gray-100 pt-3">
                <div className="text-[12px] text-gray-400">
                  {p.discount_type === 'percentage' && p.max_discount_amount != null
                    ? `Capped at Rs. ${Number(p.max_discount_amount).toLocaleString('en-US')}`
                    : p.discount_type === 'percentage'
                      ? 'No cap'
                      : 'Flat amount'}
                </div>
                {p.is_active ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active
                  </span>
                ) : (
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Inactive</span>
                )}
              </div>
            </div>
          ))}

          {canCreatePerm && <button
            type="button"
            onClick={openAdd}
            className="flex min-h-[150px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 text-gray-400 transition-colors hover:border-red-500 hover:text-red-600"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-current bg-white text-[22px] font-light leading-none">+</span>
            <span className="text-[13.5px] font-semibold">Add another button</span>
          </button>}
        </div>
      )}

      {/* Add / edit */}
      <OfferModal
        open={showForm}
        onClose={close}
        title={editingId != null ? 'Edit staff discount' : 'Add a staff discount'}
        width={560}
        autoHeight
        icon={<MdOutlineVolunteerActivism size={18} />}
        footer={
          <>
            <div />
            <div className="flex gap-3">
              <button type="button" onClick={close} className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-5 py-[11px] text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={submit} disabled={saveMutation.isPending} className="rounded-[11px] bg-red-600 px-6 py-[11px] text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.97] disabled:opacity-60">
                {editingId != null ? 'Save changes' : 'Add button'}
              </button>
            </div>
          </>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-[17px] overflow-y-auto px-[26px] py-[22px]">
          <div>
            <label className={offerLabel}>Button name <span className="text-red-500">*</span></label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={offerInput}
              placeholder="10% – Long wait"
              autoFocus
            />
            <p className="mt-2 text-[12px] leading-snug text-gray-400">
              Shown on the checkout button and used to group give-aways in reports.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={offerLabel}>Type</label>
              <select
                value={form.discount_type}
                onChange={(e) => setForm({ ...form, discount_type: e.target.value as 'percentage' | 'flat' })}
                className={offerInput}
              >
                <option value="percentage">Percentage</option>
                <option value="flat">Flat Amount</option>
              </select>
            </div>
            <div>
              <label className={offerLabel}>
                Value <span className="text-red-500">*</span>
                <span className="ml-1 font-normal text-gray-400">{form.discount_type === 'flat' ? '(Rs)' : '(%)'}</span>
              </label>
              <input
                type="number"
                min={0}
                max={form.discount_type === 'percentage' ? 99.99 : undefined}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value === '' ? '' : Number(e.target.value) })}
                className={offerInput}
                placeholder={form.discount_type === 'flat' ? '200' : '10'}
              />
            </div>
          </div>

          {form.discount_type === 'percentage' && (
            <div>
              <label className={offerLabel}>Max discount (Rs) <span className="font-normal text-gray-400">— optional</span></label>
              <input
                type="number"
                min={0}
                value={form.max_discount_amount}
                onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value === '' ? '' : Number(e.target.value) })}
                className={offerInput}
                placeholder="no cap"
              />
              <p className="mt-2 text-[12px] leading-snug text-gray-400">
                Stops a percentage running away on a large ticket.
              </p>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-gray-400">
            <MdInfoOutline size={14} className="mt-px shrink-0" />
            A staff discount must be under 100%. To write off a whole bill, void or refund the order instead — that
            keeps its own approval and audit trail. Your tenant&apos;s maximum-total-discount cap still applies on top.
          </p>

          {allowedBrandIds == null && (
            <div>
              <SearchableMultiSelect
                options={brandOptions}
                selectedIds={form.eligibility_brand_ids}
                onChange={(ids) => setForm({ ...form, eligibility_brand_ids: ids })}
                placeholder="All brands"
                label="Brands"
                maxHeight="12rem"
              />
              <p className="mt-2 text-[12px] leading-snug text-gray-400">Leave empty to offer this button for every brand.</p>
            </div>
          )}

          <div>
            <label className={offerLabel}>Button order</label>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value === '' ? '' : Number(e.target.value) })}
              className={offerInput}
              placeholder="0"
            />
            <p className="mt-2 text-[12px] leading-snug text-gray-400">Lowest first, left to right on the checkout screen.</p>
          </div>

          <div className="flex items-center justify-between rounded-[11px] border border-gray-100 bg-gray-50 px-3.5 py-3">
            <div>
              <div className="text-[13.5px] font-semibold text-gray-700">Active</div>
              <div className="text-[12px] text-gray-400">Shown on the checkout screen</div>
            </div>
            <SegToggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} ariaLabel="Active" />
          </div>
        </div>
      </OfferModal>
    </div>
  );
};

export default StaffDiscounts;
