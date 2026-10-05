import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdOutlineConfirmationNumber, MdEdit, MdDelete, MdInfoOutline } from 'react-icons/md';
import { adminService } from '../../services/api';
import SegToggle from '../../components/SegToggle';
import OfferModal, { offerInput, offerLabel } from '../../components/OfferModal';
import SearchableMultiSelect from '../../components/SearchableMultiSelect';
import OfferOrderTypesField from '../../components/OfferOrderTypesField';
import { useHasPermission } from '../../hooks/useHasPermission';
import apiClient from '../../utils/apiClient';
import { confirmDialog } from '../../utils/sweetAlert';
import { PrintedVoucher } from '../../types';
import { isEntityInactive } from '../../utils/entityStatus';
import { voucherFace, voucherOrderTypesText, voucherValidityText } from '../../utils/voucherText';
import {
  VoucherForm,
  choiceIdsFor,
  emptyVoucherForm,
  formFromVoucher,
  includedOptionChoices,
  payloadFromForm,
  qualifyingGroupIds,
  voucherFormError,
} from './printedVoucherForm';

const apiError = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/** Today as 'YYYY-MM-DD' on this device, to flag a voucher past its last day. */
const todayYmd = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Printed vouchers — the paper coupon book. Each voucher is a button a cashier
 * taps on the POS checkout, where it replaces every other discount on the
 * order. Everything about a voucher is set here: what it applies to, the order
 * types and branches it is valid for, and its dates.
 */
const PrintedVouchers: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreatePerm = useHasPermission('printed-vouchers:create');
  const canEditPerm = useHasPermission('printed-vouchers:edit');
  const canDeletePerm = useHasPermission('printed-vouchers:delete');
  const [form, setForm] = useState<VoucherForm>(emptyVoucherForm());
  const [editing, setEditing] = useState<PrintedVoucher | null>(null);
  const [showForm, setShowForm] = useState(false);
  // The saved "price includes" options are resolved once per opened voucher.
  const includedResolvedFor = useRef<number | null>(null);

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['printed-vouchers'],
    queryFn: () => adminService.getPrintedVouchers(),
  });
  // Brand-locked users get only their own brands back.
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return res.data;
    },
  });
  const brandId = form.brand_id === '' ? null : Number(form.brand_id);
  const { data: options, isFetching: optionsLoading } = useQuery({
    queryKey: ['printed-voucher-form-options', brandId],
    queryFn: () => adminService.getPrintedVoucherFormOptions(brandId as number),
    enabled: showForm && brandId != null,
  });

  const fixedPrice = form.voucher_type === 'fixed_price';
  const choices = useMemo(
    () => includedOptionChoices(options, qualifyingGroupIds(options, form.category_ids, form.product_ids)),
    [options, form.category_ids, form.product_ids],
  );

  // Editing: tick the saved options once the brand's lists have loaded.
  useEffect(() => {
    if (!editing || !options || includedResolvedFor.current === editing.id) return;
    includedResolvedFor.current = editing.id;
    const saved = editing.included_modifier_ids ?? [];
    if (saved.length === 0) return;
    const all = includedOptionChoices(
      options,
      qualifyingGroupIds(options, editing.category_ids ?? [], editing.product_ids ?? []),
    );
    setForm((f) => ({ ...f, included_choice_ids: choiceIdsFor(all, saved) }));
  }, [editing, options]);

  const close = () => {
    setShowForm(false);
    setEditing(null);
    includedResolvedFor.current = null;
  };

  const openAdd = () => {
    // With a single brand there is nothing to choose.
    setForm(emptyVoucherForm((brands ?? []).length === 1 ? brands![0].id : ''));
    setEditing(null);
    includedResolvedFor.current = null;
    setShowForm(true);
  };

  const startEdit = (v: PrintedVoucher) => {
    setForm(formFromVoucher(v));
    setEditing(v);
    includedResolvedFor.current = null;
    setShowForm(true);
  };

  /** A voucher's categories, products, options and branches all belong to its brand. */
  const changeBrand = (value: string) =>
    setForm((f) => ({
      ...f,
      brand_id: value === '' ? '' : Number(value),
      category_ids: [],
      product_ids: [],
      included_choice_ids: [],
      eligibility_branch_ids: [],
    }));

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = payloadFromForm(form, choices);
      return editing != null
        ? adminService.updatePrintedVoucher(editing.id, payload)
        : adminService.createPrintedVoucher(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printed-vouchers'] });
      toast.success(editing != null ? 'Voucher updated' : 'Voucher added');
      close();
    },
    onError: (e: unknown) => toast.error(apiError(e, 'Failed to save the voucher')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deletePrintedVoucher(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printed-vouchers'] });
      toast.success('Voucher removed');
    },
    onError: (e: unknown) => toast.error(apiError(e, 'Failed to remove the voucher')),
  });

  const submit = () => {
    const error = voucherFormError(form);
    if (error) {
      toast.error(error);
      return;
    }
    // The saved options are still being matched to the brand's lists.
    if (editing != null && fixedPrice && !options) {
      toast.error('Still loading this brand’s menu — try again in a moment');
      return;
    }
    saveMutation.mutate();
  };

  const list = vouchers ?? [];
  const today = todayYmd();
  const byBrand = useMemo(() => {
    const groups = new Map<string, PrintedVoucher[]>();
    for (const v of vouchers ?? []) {
      const key = v.brand_name ?? `Brand #${v.brand_id}`;
      groups.set(key, [...(groups.get(key) ?? []), v]);
    }
    return [...groups.entries()];
  }, [vouchers]);

  const appliesTo = (v: PrintedVoucher): string => {
    const names = [...v.category_names, ...v.product_names];
    return names.length > 0 ? names.join(', ') : 'Entire menu';
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MdOutlineConfirmationNumber size={24} />
        </span>
        <div className="min-w-[280px] flex-1">
          <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">Printed Vouchers</h1>
          <p className="max-w-[760px] text-[14px] leading-relaxed text-gray-500">
            The paper vouchers from your coupon book. A cashier taps one on the checkout screen when the customer
            hands it over. Only one voucher can be used per order, and it switches off every other discount on that
            order. What was redeemed shows under{' '}
            <Link to="/admin/reports/printed-vouchers" className="font-semibold text-red-600 hover:underline">
              Reports → Printed Vouchers
            </Link>
            .
          </p>
        </div>
        {canCreatePerm && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex flex-none items-center gap-2 rounded-[11px] bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98]"
          >
            <span className="text-lg leading-none">+</span>Add a voucher
          </button>
        )}
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-[11px] border border-amber-100 bg-amber-50/60 px-4 py-3 text-[12.5px] leading-relaxed text-amber-800">
        <MdInfoOutline size={16} className="mt-px shrink-0" />
        <span>
          There is no usage limit: the system does not know whether a paper voucher was used before, so staff should
          collect it. A fixed-price voucher covers <span className="font-semibold">one</span> item per order — the
          one where the customer saves most — and extras are charged on top.
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-gray-700">No vouchers yet</p>
          <p className="mt-1 text-[13px] text-gray-500">
            Add one for each kind of voucher in your coupon book. Cashiers see a voucher as soon as it is active.
          </p>
        </div>
      ) : (
        byBrand.map(([brandName, group]) => (
          <section key={brandName} className="mb-8">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-gray-400">
                {brandName} · {group.length}
              </h2>
              <span className="text-[12.5px] text-gray-400">{group.filter((v) => v.is_active).length} active</span>
            </div>
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
              {group.map((v) => {
                const expired = v.valid_until != null && v.valid_until < today;
                return (
                  <div
                    key={v.id}
                    data-testid={`voucher-${v.id}`}
                    className={`flex min-h-[170px] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-[20px] shadow-sm transition-shadow hover:shadow-md ${v.is_active && !expired ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[26px] font-extrabold leading-none tracking-tight text-red-600">
                          {voucherFace(v)}
                        </span>
                        <div className="mt-2 text-[15px] font-semibold text-gray-800">{v.name}</div>
                        <dl className="mt-2 space-y-1 text-[12.5px] leading-snug text-gray-500">
                          <div>
                            <dt className="inline font-semibold text-gray-600">Applies to: </dt>
                            <dd className="inline">{appliesTo(v)}</dd>
                          </div>
                          {v.included_modifier_names.length > 0 && (
                            <div>
                              <dt className="inline font-semibold text-gray-600">Price includes: </dt>
                              <dd className="inline">{[...new Set(v.included_modifier_names)].join(', ')}</dd>
                            </div>
                          )}
                          {v.voucher_type === 'percentage' && v.max_discount_amount != null && (
                            <div>
                              <dt className="inline font-semibold text-gray-600">Maximum: </dt>
                              <dd className="inline">Rs {Number(v.max_discount_amount).toLocaleString('en-US')}</dd>
                            </div>
                          )}
                          <div>
                            <dt className="inline font-semibold text-gray-600">Branches: </dt>
                            <dd className="inline">{v.branch_names.length > 0 ? v.branch_names.join(', ') : 'All'}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="flex flex-none gap-1.5">
                        {canEditPerm && (
                          <button
                            type="button"
                            onClick={() => startEdit(v)}
                            title="Edit"
                            aria-label={`Edit ${v.name}`}
                            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <MdEdit size={15} />
                          </button>
                        )}
                        {canDeletePerm && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: `Delete voucher "${v.name}"?`,
                                  text: 'Orders that already used it keep their record and stay in the report.',
                                  confirmText: 'Delete',
                                })
                              )
                                deleteMutation.mutate(v.id);
                            }}
                            title="Delete"
                            aria-label={`Delete ${v.name}`}
                            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gray-100 text-red-500 transition-colors hover:bg-red-100"
                          >
                            <MdDelete size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3 border-t border-gray-100 pt-3">
                      <div className="text-[12px] text-gray-400">
                        {voucherOrderTypesText(v.order_types)} · {voucherValidityText(v.valid_from, v.valid_until)}
                      </div>
                      {expired ? (
                        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Expired</span>
                      ) : v.is_active ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Inactive</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* Add / edit */}
      <OfferModal
        open={showForm}
        onClose={close}
        title={editing != null ? 'Edit voucher' : 'Add a voucher'}
        subtitle="One voucher per order — it replaces every other discount"
        width={640}
        icon={<MdOutlineConfirmationNumber size={18} />}
        footer={
          <>
            <div className="flex items-center gap-3">
              <SegToggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} ariaLabel="Active" />
              <span className="text-[13.5px] font-semibold text-gray-700">Active</span>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={close}
                className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-5 py-[11px] text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saveMutation.isPending}
                className="rounded-[11px] bg-red-600 px-6 py-[11px] text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.97] disabled:opacity-60"
              >
                {editing != null ? 'Save changes' : 'Add voucher'}
              </button>
            </div>
          </>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-[17px] overflow-y-auto px-[26px] py-[22px]">
          <div>
            <label className={offerLabel} htmlFor="voucher-name">
              Voucher name <span className="text-red-500">*</span>
            </label>
            <input
              id="voucher-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={offerInput}
              placeholder="Any Large Pizza"
              autoFocus
            />
            <p className="mt-2 text-[12px] leading-snug text-gray-400">
              Shown on the checkout button, the receipt and the report.
            </p>
          </div>

          <div>
            <label className={offerLabel} htmlFor="voucher-brand">
              Brand <span className="text-red-500">*</span>
            </label>
            <select
              id="voucher-brand"
              value={form.brand_id === '' ? '' : String(form.brand_id)}
              onChange={(e) => changeBrand(e.target.value)}
              className={offerInput}
            >
              <option value="">Choose a brand</option>
              {(brands ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {isEntityInactive(b) ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[12px] leading-snug text-gray-400">
              The checkout shows a voucher only when the cart is this brand&apos;s.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={offerLabel} htmlFor="voucher-type">
                Type
              </label>
              <select
                id="voucher-type"
                value={form.voucher_type}
                onChange={(e) =>
                  setForm({ ...form, voucher_type: e.target.value === 'percentage' ? 'percentage' : 'fixed_price' })
                }
                className={offerInput}
              >
                <option value="fixed_price">Fixed price for one item</option>
                <option value="percentage">Percentage off</option>
              </select>
            </div>
            <div>
              <label className={offerLabel} htmlFor="voucher-value">
                {fixedPrice ? 'Voucher price' : 'Percent off'} <span className="text-red-500">*</span>
                <span className="ml-1 font-normal text-gray-400">{fixedPrice ? '(Rs)' : '(%)'}</span>
              </label>
              <input
                id="voucher-value"
                type="number"
                min={0}
                max={fixedPrice ? undefined : 100}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value === '' ? '' : Number(e.target.value) })}
                className={offerInput}
                placeholder={fixedPrice ? '999' : '30'}
              />
            </div>
          </div>
          <p className="-mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-gray-400">
            <MdInfoOutline size={14} className="mt-px shrink-0" />
            {fixedPrice
              ? 'One qualifying item is charged at this price. Extra toppings and add-ons are charged on top. The price is always honoured, even below cost or past your maximum-discount setting.'
              : 'Taken off every qualifying item, extras included. Deals are never discounted.'}
          </p>

          {!fixedPrice && (
            <div>
              <label className={offerLabel} htmlFor="voucher-max">
                Maximum discount (Rs) <span className="font-normal text-gray-400">— optional</span>
              </label>
              <input
                id="voucher-max"
                type="number"
                min={0}
                value={form.max_discount_amount}
                onChange={(e) =>
                  setForm({ ...form, max_discount_amount: e.target.value === '' ? '' : Number(e.target.value) })
                }
                className={offerInput}
                placeholder="no maximum"
              />
            </div>
          )}

          {brandId == null ? (
            <p className="rounded-[11px] border border-gray-100 bg-gray-50 px-3.5 py-3 text-[12.5px] text-gray-500">
              Choose a brand to pick the categories, products and branches.
            </p>
          ) : (
            <>
              <div>
                <SearchableMultiSelect
                  options={options?.categories ?? []}
                  selectedIds={form.category_ids}
                  onChange={(ids) => setForm({ ...form, category_ids: ids })}
                  placeholder={optionsLoading && !options ? 'Loading…' : 'Search categories'}
                  label="Applies to categories"
                  maxHeight="12rem"
                />
                <p className="mt-2 text-[12px] leading-snug text-gray-400">
                  Every item in these categories qualifies. Add or remove a category at any time.
                </p>
              </div>
              <div>
                <SearchableMultiSelect
                  options={(options?.products ?? []).map((p) => ({
                    id: p.id,
                    name: p.category_name ? `${p.name} — ${p.category_name}` : p.name,
                    inactive: !p.is_active,
                  }))}
                  selectedIds={form.product_ids}
                  onChange={(ids) => setForm({ ...form, product_ids: ids })}
                  placeholder={optionsLoading && !options ? 'Loading…' : 'Search products'}
                  label="Applies to products"
                  maxHeight="12rem"
                />
                <p className="mt-2 text-[12px] leading-snug text-gray-400">
                  {fixedPrice
                    ? 'For a voucher on one specific item. An item qualifies if it is picked here or sits in a picked category.'
                    : 'Leave both lists empty to take the percentage off the entire menu.'}
                </p>
              </div>

              {fixedPrice && choices.length > 0 && (
                <div>
                  <SearchableMultiSelect
                    options={choices}
                    selectedIds={form.included_choice_ids}
                    onChange={(ids) => setForm({ ...form, included_choice_ids: ids })}
                    placeholder="Nothing extra"
                    label="Price also includes (optional)"
                    maxHeight="12rem"
                  />
                  <p className="mt-2 text-[12px] leading-snug text-gray-400">
                    For a meal voucher: pick the option that adds the fries and drink. The item must then be ordered
                    with that option, and the option&apos;s price is part of the voucher price.
                  </p>
                </div>
              )}

              <div>
                <SearchableMultiSelect
                  options={options?.branches ?? []}
                  selectedIds={form.eligibility_branch_ids}
                  onChange={(ids) => setForm({ ...form, eligibility_branch_ids: ids })}
                  placeholder="All branches"
                  label="Branches"
                  maxHeight="10rem"
                />
                <p className="mt-2 text-[12px] leading-snug text-gray-400">
                  Leave empty to accept the voucher at every branch that sells this brand.
                </p>
              </div>
            </>
          )}

          <OfferOrderTypesField value={form.order_types} onChange={(v) => setForm({ ...form, order_types: v })} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={offerLabel} htmlFor="voucher-from">
                Valid from
              </label>
              <input
                id="voucher-from"
                type="date"
                value={form.valid_from}
                onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                className={offerInput}
              />
            </div>
            <div>
              <label className={offerLabel} htmlFor="voucher-until">
                Valid until
              </label>
              <input
                id="voucher-until"
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                className={offerInput}
              />
            </div>
          </div>
          <p className="-mt-2 text-[12px] leading-snug text-gray-400">
            Both days are included: a voucher valid until 30 November works all day on the 30th. Leave empty for no
            limit.
          </p>

          <div>
            <label className={offerLabel} htmlFor="voucher-order">
              Button order
            </label>
            <input
              id="voucher-order"
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value === '' ? '' : Number(e.target.value) })}
              className={offerInput}
              placeholder="0"
            />
            <p className="mt-2 text-[12px] leading-snug text-gray-400">
              Lowest first, left to right on the checkout screen.
            </p>
          </div>
        </div>
      </OfferModal>
    </div>
  );
};

export default PrintedVouchers;
