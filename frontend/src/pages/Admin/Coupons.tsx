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
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';
import ValidityFields, { emptyValidity } from '../../components/ValidityFields';
import { confirmDialog } from '../../utils/sweetAlert';

const emptyForm = {
  name: '',
  code: '',
  type: 'flat' as 'flat' | 'percentage',
  value: 100,
  min_order_amount: '' as number | '',
  audience: 'all' as 'all' | 'specific' | 'new_customer',
  eligible_customer_ids: [] as number[],
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
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [vouchersFor, setVouchersFor] = useState<Discount | null>(null);
  const [reportFor, setReportFor] = useState<Discount | null>(null);

  const { data: coupons, isLoading } = useQuery({ queryKey: ['coupons'], queryFn: adminService.getCoupons });
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: adminService.getCustomers });
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        <Button onClick={() => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); }}>Add Coupon</Button>
      </div>

      {/* Create / edit */}
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Coupon' : 'Create Coupon'} size="xlarge">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: value + audience */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                  <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="auto-generated" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <label className="block"><span className="text-sm text-gray-700">Type</span>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'flat' | 'percentage' })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="flat">Flat (Rs)</option><option value="percentage">Percentage</option>
                  </select>
                </label>
                <label className="block"><span className="text-sm text-gray-700">Value</span>
                  <input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
                <label className="block"><span className="text-sm text-gray-700">Min order (Rs)</span>
                  <input type="number" min={0} value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="none" className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block"><span className="text-sm text-gray-700">Per-customer limit</span>
                  <input type="number" min={1} value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="unlimited" className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
                <label className="block"><span className="text-sm text-gray-700">Voucher valid (days after issue)</span>
                  <input type="number" min={1} value={form.voucher_validity_days} onChange={(e) => setForm({ ...form, voucher_validity_days: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="use coupon window" className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Who can use it</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['all', 'specific', 'new_customer'] as const).map((a) => (
                    <button key={a} type="button" onClick={() => setForm({ ...form, audience: a })}
                      className={`px-3 py-2 rounded-lg text-sm border ${form.audience === a ? 'border-foodies-primary bg-foodies-primary/10 text-foodies-primary font-medium' : 'border-gray-300 text-gray-600'}`}>
                      {a === 'all' ? 'All customers' : a === 'specific' ? 'Specific' : 'New customers'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{AUDIENCE_HELP[form.audience]}</p>
                {form.audience === 'specific' && (
                  <div className="mt-2">
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
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
            </div>

            {/* Right: validity (mandatory, same as discounts) */}
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
                      <p className="text-gray-500 text-xs">{c.type === 'flat' ? `Rs ${c.value} off` : `${c.value}% off`} · {c.audience ?? 'all'} · limit {c.per_customer_limit ?? '∞'}</p>
                      {c.code && <p className="font-mono text-xs text-gray-400">{c.code}</p>}
                    </>
                  }
                  statusLabel={c.is_active ? 'Active' : 'Inactive'}
                  statusVariant={c.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="outline" onClick={() => setVouchersFor(c)}>Vouchers</Button>
                      <Button size="small" variant="outline" onClick={() => setReportFor(c)}>Report</Button>
                      <Button size="small" variant="edit" onClick={() => handleEdit(c)}>Edit</Button>
                      <Button size="small" variant="danger" onClick={async () => { if (await confirmDialog({ title: `Delete "${c.name}"?`, confirmText: 'Delete' })) deleteM.mutate(c.id); }}>Delete</Button>
                    </>
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
