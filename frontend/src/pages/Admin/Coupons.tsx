import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api/adminService';
import { Discount, CouponVoucher, OfferReport } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import OfferModal, { offerInput, offerLabel } from '../../components/OfferModal';
import SegToggle from '../../components/SegToggle';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';
import ValidityFields, { emptyValidity } from '../../components/ValidityFields';
import { confirmDialog } from '../../utils/sweetAlert';
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
import { isEntityInactive } from '../../utils/entityStatus';

const emptyForm = {
  name: '',
  code: '',
  type: 'flat' as 'flat' | 'percentage',
  value: 100,
  min_order_amount: '' as number | '',
  audience: 'all' as 'all' | 'specific' | 'new_customer',
  eligible_customer_ids: [] as number[],
  eligibility_brand_ids: [] as number[],
  per_customer_limit: 1 as number | '',
  voucher_validity_days: '' as number | '',
  is_active: true,
  ...emptyValidity,
};

const AUDIENCE_HELP: Record<string, string> = {
  all: 'Any customer can redeem it at checkout via its code. No per-customer vouchers are generated.',
  specific: 'Only the customers you pick below. A voucher is auto-generated for each of them (view them on the Vouchers screen).',
  new_customer: 'A voucher is auto-generated for every customer the moment they register.',
};

type Cust = { id: number; name?: string | null; phone?: string | null };

const Coupons: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreatePerm = useHasPermission('coupons:create');
  const canEditPerm = useHasPermission('coupons:edit');
  const canDeletePerm = useHasPermission('coupons:delete');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [vouchersFor, setVouchersFor] = useState<Discount | null>(null);
  const [reportFor, setReportFor] = useState<Discount | null>(null);
  const { user } = useAuth();
  const allowedBrandIds = user?.allowed_brand_ids ?? null;

  const { data: coupons, isLoading } = useQuery({ queryKey: ['coupons'], queryFn: adminService.getCoupons });
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: adminService.getCustomers });
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return res.data;
    },
  });
  const { data: vouchers } = useQuery<CouponVoucher[]>({
    queryKey: ['coupon-vouchers', vouchersFor?.id],
    queryFn: () => adminService.getCouponVouchers(vouchersFor!.id),
    enabled: vouchersFor != null,
  });
  const { data: report } = useQuery<OfferReport>({
    queryKey: ['coupon-report', reportFor?.id],
    queryFn: () => adminService.getCouponReport(reportFor!.id),
    enabled: reportFor != null,
  });

  const list = coupons ?? [];
  const custList: Cust[] = (customers as Cust[] | undefined) ?? [];
  const custOptions: SearchableMultiSelectOption[] = custList.map((c) => ({
    id: c.id,
    name: `${c.name || 'Customer'}${c.phone ? ` · ${c.phone}` : ''}`,
  }));
  const brandOptions: SearchableMultiSelectOption[] = (brands ?? []).map((b) => ({ id: b.id, name: b.name, inactive: isEntityInactive(b) }));
  const brandNameById = useMemo(
    () => new Map((brands ?? []).map((b) => [b.id, b.name])),
    [brands],
  );
  const paginated = useMemo(() => list.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE), [list, page]);
  const vAudience = vouchersFor?.audience ?? 'all';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['coupons'] });
  const onErr = (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed');

  const createM = useMutation({ mutationFn: adminService.createCoupon, onSuccess: () => { invalidate(); setShowForm(false); setForm({ ...emptyForm }); toast.success('Coupon created'); }, onError: onErr });
  const updateM = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<Discount> }) => adminService.updateCoupon(id, data), onSuccess: () => { invalidate(); setShowForm(false); setEditing(null); toast.success('Updated'); }, onError: onErr });
  const deleteM = useMutation({ mutationFn: adminService.deleteCoupon, onSuccess: () => { invalidate(); toast.success('Deleted'); }, onError: onErr });

  const handleEdit = (c: Discount) => {
    setEditing(c);
    setForm({
      name: c.name,
      code: c.code ?? '',
      type: c.type === 'percentage' ? 'percentage' : 'flat',
      value: c.value,
      min_order_amount: c.min_order_amount ?? '',
      audience: (c.audience as 'all' | 'specific' | 'new_customer') ?? 'all',
      eligible_customer_ids: c.eligible_customer_ids ?? [],
      eligibility_brand_ids: c.eligibility_brand_ids ?? [],
      per_customer_limit: c.per_customer_limit ?? '',
      voucher_validity_days: c.voucher_validity_days ?? '',
      is_active: c.is_active,
      valid_from: c.valid_from ? c.valid_from.slice(0, 10) : '',
      valid_until: c.valid_until ? c.valid_until.slice(0, 10) : '',
      valid_time_start: c.valid_time_start ?? '',
      valid_time_end: c.valid_time_end ?? '',
      valid_days_of_week: c.valid_days_of_week ?? [],
    });
    setShowForm(true);
  };

  const generateCode = () => setForm((f) => ({ ...f, code: 'SAVE' + Math.floor(100 + Math.random() * 900) }));

  const handleSubmit = () => {
    if (form.audience === 'specific' && form.eligible_customer_ids.length === 0) {
      toast.error('Pick at least one customer for a "specific customers" coupon');
      return;
    }
    const data: Partial<Discount> = {
      name: form.name,
      code: form.code.trim() ? form.code.trim().toUpperCase() : undefined,
      type: form.type,
      value: Number(form.value),
      min_order_amount: form.min_order_amount === '' ? undefined : Number(form.min_order_amount),
      audience: form.audience,
      eligible_customer_ids: form.audience === 'specific' ? form.eligible_customer_ids : null,
      eligibility_brand_ids: form.eligibility_brand_ids,
      per_customer_limit: form.per_customer_limit === '' ? null : Number(form.per_customer_limit),
      voucher_validity_days: form.voucher_validity_days === '' ? null : Number(form.voucher_validity_days),
      is_active: form.is_active,
      valid_from: form.valid_from || undefined,
      valid_until: form.valid_until || undefined,
      valid_time_start: form.valid_time_start || null,
      valid_time_end: form.valid_time_end || null,
      valid_days_of_week: form.valid_days_of_week,
    };
    if (editing) updateM.mutate({ id: editing.id, data });
    else createM.mutate(data);
  };

  if (isLoading) return <Loader fullScreen text="Loading coupons..." />;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Coupons</h1>
          <p className="text-sm text-gray-500">A coupon is the offer &amp; its code. Its <span className="font-medium">vouchers</span> (the customer's physical form, with a QR) are generated automatically from the audience — view them on the Vouchers screen.</p>
        </div>
        {canCreatePerm && <Button onClick={() => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); }}>Add Coupon</Button>}
      </div>

      {/* Create / edit */}
      <OfferModal
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? 'Edit Coupon' : 'Create Coupon'}
        subtitle="A code customers enter at checkout — vouchers are generated from the audience"
        width={980}
        icon={
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6a1.5 1.5 0 0 0 0 3v2.5h15V9a1.5 1.5 0 0 1 0-3V3.5h-15z" /><line x1="10" y1="4" x2="10" y2="15" strokeDasharray="1.5 2" />
          </svg>
        }
        footer={
          <>
            <div className="flex items-center gap-2.5">
              <SegToggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} ariaLabel="Active" />
              <span className="text-[13.5px] font-semibold text-gray-700">Active</span>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-5 py-[11px] text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleSubmit} disabled={createM.isPending || updateM.isPending} className="rounded-[11px] bg-red-600 px-6 py-[11px] text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.97] disabled:opacity-60">{editing ? 'Update' : 'Create'}</button>
            </div>
          </>
        }
      >
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label className={offerLabel}>Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rs 100 off — all" className={offerInput} />
            </div>
            <div>
              <label className={offerLabel}>Code</label>
              <div className="flex gap-2">
                <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="auto-generated" className={`${offerInput} font-mono tracking-wide`} />
                <button type="button" onClick={generateCode} className="flex-none rounded-[10px] border-[1.5px] border-violet-200 bg-violet-50 px-3.5 text-[12.5px] font-bold text-violet-700 transition-colors hover:bg-violet-100">Generate</button>
              </div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-4">
            <div>
              <label className={offerLabel}>Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'flat' | 'percentage' })} className={offerInput}>
                <option value="flat">Flat (Rs)</option><option value="percentage">Percentage</option>
              </select>
            </div>
            <div>
              <label className={offerLabel}>Value</label>
              <input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} className={offerInput} />
            </div>
            <div>
              <label className={offerLabel}>Min order (Rs)</label>
              <input type="number" min={0} value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="none" className={offerInput} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={offerLabel}>Per-customer limit</label>
              <input type="number" min={1} value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="unlimited" className={offerInput} />
            </div>
            <div>
              <label className={offerLabel}>Voucher valid <span className="font-normal text-gray-400">— days after issue</span></label>
              <input type="number" min={1} value={form.voucher_validity_days} onChange={(e) => setForm({ ...form, voucher_validity_days: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="use coupon window" className={offerInput} />
            </div>
          </div>

          <div className="my-5 h-px bg-gray-100" />

          <div className="mb-5">
            <div className="mb-2.5 text-[13px] font-semibold text-gray-700">Who can use it</div>
            <div className="mb-2.5 grid grid-cols-3 gap-2.5">
              {([
                ['all', 'All customers'],
                ['specific', 'Specific'],
                ['new_customer', 'New customers'],
              ] as const).map(([a, label]) => {
                const on = form.audience === a;
                return (
                  <button key={a} type="button" onClick={() => setForm({ ...form, audience: a })}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-[1.5px] px-2.5 py-3.5 transition-colors ${on ? 'border-red-600 bg-red-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                    <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg ${on ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                        {a === 'all' ? (
                          <><circle cx="6" cy="6.5" r="2.3" /><path d="M2 15c0-2.2 1.8-4 4-4s4 1.8 4 4" /><circle cx="12.5" cy="6.5" r="1.9" /><path d="M11 11.4c2 .2 3.5 1.9 3.5 3.6" /></>
                        ) : a === 'specific' ? (
                          <><circle cx="9" cy="6" r="2.6" /><path d="M3.5 15.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /></>
                        ) : (
                          <><circle cx="9" cy="6" r="2.6" /><path d="M4 15.5c0-2.8 2.2-4.8 5-4.8" /><line x1="13" y1="11" x2="13" y2="15" /><line x1="11" y1="13" x2="15" y2="13" /></>
                        )}
                      </svg>
                    </span>
                    <span className={`text-[13.5px] font-semibold ${on ? 'text-red-700' : 'text-gray-700'}`}>{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-start gap-2.5 rounded-[11px] border border-blue-100 bg-blue-50 px-3.5 py-3">
              <span className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">i</span>
              <div className="text-[12.5px] leading-relaxed text-slate-600">{AUDIENCE_HELP[form.audience]}</div>
            </div>
            {form.audience === 'specific' && (
              <div className="mt-3">
                <SearchableMultiSelect
                  options={custOptions}
                  selectedIds={form.eligible_customer_ids}
                  onChange={(ids) => setForm({ ...form, eligible_customer_ids: ids })}
                  placeholder="Search customers by name / phone…"
                  label={`Eligible customers * (${form.eligible_customer_ids.length} selected)`}
                  required
                  maxHeight="14rem"
                />
              </div>
            )}
          </div>

          {allowedBrandIds == null && (
            <div className="mb-5">
              <SearchableMultiSelect
                options={brandOptions}
                selectedIds={form.eligibility_brand_ids}
                onChange={(ids) => setForm({ ...form, eligibility_brand_ids: ids })}
                placeholder="All brands"
                label="Brands"
                maxHeight="12rem"
              />
              <p className="mt-2 text-[12.5px] text-gray-500">Leave empty to apply to all brands.</p>
            </div>
          )}

          <div className="mb-1">
            <div className="text-[13px] font-semibold text-gray-700">Valid at <span className="text-red-500">(required)</span></div>
            <div className="mb-3 text-[12.5px] text-gray-400">The window the coupon can be redeemed in.</div>
            <ValidityFields
              requireDates
              value={{ valid_from: form.valid_from, valid_until: form.valid_until, valid_time_start: form.valid_time_start, valid_time_end: form.valid_time_end, valid_days_of_week: form.valid_days_of_week }}
              onChange={(v) => setForm({ ...form, ...v })}
            />
          </div>
        </div>
      </OfferModal>

      {/* Vouchers — auto-generated per the coupon's audience; read-only + QR */}
      <Modal isOpen={vouchersFor != null} onClose={() => setVouchersFor(null)} title={`Vouchers — ${vouchersFor?.name ?? ''}`} size="xlarge">
        {vouchersFor && (
          <div className="mb-4 rounded-lg bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 px-4 py-3 text-sm text-blue-800 dark:text-blue-200">
            {vAudience === 'new_customer'
              ? '⚡ A template voucher is generated up front (shown below). When a customer registers, a real copy is minted and linked to them automatically. Nothing to do here.'
              : vAudience === 'specific'
                ? '🎯 Auto-generated for the eligible customers you set on the coupon. To add/remove people, edit the coupon\'s "Specific customers" list.'
                : '🌐 A voucher is auto-generated for every existing customer (and for each new sign-up) so it appears in their app. Redemption stays limited per customer by the usage rules.'}
          </div>
        )}
        <div className="max-h-[30rem] overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pr-1">
          {(vouchers ?? []).slice(0, 120).map((v) => {
            const isTemplate = v.is_template || v.status === 'template';
            const statusColor =
              isTemplate ? 'bg-indigo-100 text-indigo-700'
              : v.status === 'active' ? 'bg-green-100 text-green-700'
              : v.status === 'exhausted' ? 'bg-gray-200 text-gray-600'
              : 'bg-red-100 text-red-700';
            return (
              <div key={v.id} className={`relative rounded-xl border-2 border-dashed p-3 overflow-hidden ${isTemplate ? 'border-indigo-400/60 bg-indigo-50 dark:bg-slate-800' : 'border-foodies-primary/40 bg-foodies-primary/5 dark:bg-slate-800'}`}>
                <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white dark:bg-slate-900 border border-foodies-primary/30" />
                <span className="absolute -right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white dark:bg-slate-900 border border-foodies-primary/30" />
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-base font-extrabold text-foodies-primary">
                      {vouchersFor && (vouchersFor.type === 'percentage' ? `${vouchersFor.value}% OFF` : `Rs ${vouchersFor.value} OFF`)}
                    </div>
                    {isTemplate ? (
                      <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Master template</div>
                    ) : (
                      <>
                        <div className="text-xs font-medium text-gray-800 dark:text-slate-200 truncate">{v.customer_name || 'Customer'}</div>
                        <div className="text-[10px] text-gray-500 dark:text-slate-400">{v.customer_phone}</div>
                      </>
                    )}
                  </div>
                  {v.qr_token && !isTemplate && (
                    <div className="bg-white p-1 rounded shrink-0">
                      <QRCodeSVG value={v.qr_token} size={44} />
                    </div>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 font-mono">{v.reference ?? `VCH-${v.id}`}</span>
                  {v.code && <span className="font-mono text-gray-500">code {v.code}</span>}
                </div>
                {isTemplate ? (
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>template</span>
                    <span className="text-[10px] text-gray-400">auto-linked on sign-up</span>
                  </div>
                ) : (
                  <>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>{v.status}</span>
                      <span className="text-[10px] text-gray-400">{v.expires_at ? `exp ${new Date(v.expires_at).toLocaleDateString()}` : 'no expiry'}</span>
                    </div>
                    {v.uses > 0 && <div className="mt-0.5 text-[10px] text-gray-500">used {v.uses}×</div>}
                  </>
                )}
              </div>
            );
          })}
          {(vouchers?.length ?? 0) > 120 && (
            <p className="col-span-full px-3 py-3 text-center text-xs text-gray-400">
              Showing 120 of {vouchers?.length} vouchers. Use Report for full usage stats.
            </p>
          )}
          {(vouchers?.length ?? 0) === 0 && (
            <p className="col-span-full px-3 py-10 text-center text-sm text-gray-400">
              {vAudience === 'new_customer'
                ? 'Re-save this coupon (Edit → Update) to generate its template voucher — a linked copy is then minted for each new sign-up.'
                : vAudience === 'specific'
                  ? 'No vouchers yet — add eligible customers on the coupon (Edit) and one is auto-generated for each.'
                  : 'No vouchers yet — re-save this coupon (Edit → Update) to generate one for every existing customer.'}
            </p>
          )}
        </div>
      </Modal>

      {/* Report */}
      <Modal isOpen={reportFor != null} onClose={() => setReportFor(null)} title={`Usage — ${reportFor?.name ?? ''}`} size="large">
        {report ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-green-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-green-700">{report.total_redemptions ?? 0}</div><div className="text-xs text-gray-500">Redemptions</div></div>
              <div className="rounded-xl bg-blue-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-blue-700">Rs {report.total_value ?? 0}</div><div className="text-xs text-gray-500">Value given</div></div>
              <div className="rounded-xl bg-amber-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-amber-700">{report.reversed ?? 0}</div><div className="text-xs text-gray-500">Reversed</div></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Redemptions</h4>
              <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-slate-800 sticky top-0">
                    <tr className="text-left text-gray-500"><th className="px-3 py-2">Order</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">When</th><th className="px-3 py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {(report.rows ?? []).map((r) => (
                      <tr key={r.id} className={r.reversed_at ? 'text-gray-400 line-through' : ''}>
                        <td className="px-3 py-2">#{r.order_id}</td>
                        <td className="px-3 py-2">{r.customer_phone ?? r.customer_id ?? '—'}</td>
                        <td className="px-3 py-2 text-right">Rs {r.amount}</td>
                        <td className="px-3 py-2">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                        <td className="px-3 py-2">{r.reversed_at ? 'reversed' : 'active'}</td>
                      </tr>
                    ))}
                    {(report.rows?.length ?? 0) === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No redemptions yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : <Loader text="Loading…" />}
      </Modal>

      <div className="w-full space-y-3">
        {list.length === 0 ? (
          <Card><p className="text-center text-gray-500 py-12">No coupons yet.</p></Card>
        ) : (
          <>
            <AccentedList>
              {paginated.map((c, i) => (
                <AccentedListRow
                  key={c.id}
                  accent={c.is_active ? 'active' : 'inactive'}
                  initial={c.name.charAt(0)}
                  title={c.name}
                  subtitle={
                    <>
                      <p className="text-gray-500 text-xs flex items-center gap-2 flex-wrap">
                        <span>{c.type === 'flat' ? `Rs ${c.value} off` : `${c.value}% off`} · {c.audience ?? 'all'} · limit {c.per_customer_limit ?? '∞'}</span>
                        <BrandScopeBadge
                          effectiveBrandIds={c.effective_brand_ids}
                          brandNameById={brandNameById}
                          allowedBrandIds={allowedBrandIds}
                        />
                      </p>
                      {c.code && <p className="font-mono text-xs text-gray-400">{c.code}</p>}
                      <BrandScopeNotice manageScope={c.manage_scope} noun="coupon" />
                    </>
                  }
                  statusLabel={c.is_active ? 'Active' : 'Inactive'}
                  statusVariant={c.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    c.manage_scope === 'read_only' ? null : (
                      <>
                        {/* Vouchers carry customer identity and Report aggregates every
                            brand's redemptions, so both follow Edit's gate. */}
                        {canEditPerm && canEdit(c.manage_scope) && (
                          <>
                            <Button size="small" variant="outline" onClick={() => setVouchersFor(c)}>Vouchers</Button>
                            <Button size="small" variant="outline" onClick={() => setReportFor(c)}>Report</Button>
                            <Button size="small" variant="edit" onClick={() => handleEdit(c)}>Edit</Button>
                          </>
                        )}
                        {canDeletePerm && <Button
                          size="small"
                          variant="danger"
                          onClick={async () => {
                            if (await confirmDialog(removeDialog(c.manage_scope, 'coupon', c.name))) deleteM.mutate(c.id);
                          }}
                        >
                          {removeLabel(c.manage_scope)}
                        </Button>}
                      </>
                    )
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={list.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="coupons" />
          </>
        )}
      </div>
    </div>
  );
};

export default Coupons;
