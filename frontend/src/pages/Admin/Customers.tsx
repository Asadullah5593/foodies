import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { adminService } from '../../services/api';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER } from '../../utils/phone';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import { useHasPermission } from '../../hooks/useHasPermission';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import {
  CUSTOMER_SOURCES,
  CUSTOMER_SOURCE_BADGE,
  CUSTOMER_SOURCE_LABEL,
  customerSourceLabel,
} from '../../utils/customerSources';

type LoyaltyWallet = {
  wallet_type: 'pos' | 'app';
  brand_id: number | null;
  brand_name: string | null;
  balance: number;
};

type Customer = {
  id: number;
  name: string | null;
  phone: string;
  loyaltyPointsBalance?: number;
  loyaltyWallets?: LoyaltyWallet[];
  createdAt?: string;
  /** Where they signed up: pos | consumer_app | consumer_web | kiosk. */
  source?: string | null;
  brands?: { id: number; name: string }[];
};

const Customers: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('customers:create');
  const canEdit = useHasPermission('customers:edit');
  const canDelete = useHasPermission('customers:delete');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [filter, setFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const debouncedFilter = useDebouncedValue(filter, 300);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [linkConfirm, setLinkConfirm] = useState<{ name: string; phone: string; existingName: string | null } | null>(null);
  const [vouchersFor, setVouchersFor] = useState<Customer | null>(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: adminService.getCustomers,
  });

  const { data: voucherData, isFetching: vouchersLoading } = useQuery({
    queryKey: ['customer-vouchers', vouchersFor?.phone],
    queryFn: () => adminService.getCustomerVouchers(vouchersFor!.phone),
    enabled: !!vouchersFor?.phone,
  });

  const voucherStats = useMemo(() => {
    const list = voucherData?.vouchers ?? [];
    const active = list.filter((v) => v.status === 'active').length;
    const used = list.filter((v) => v.status === 'used' || v.status === 'exhausted').length;
    const expired = list.filter((v) => v.status === 'expired' || v.status === 'revoked').length;
    const timesUsed = list.reduce((s, v) => s + (v.uses ?? 0), 0);
    return { total: list.length, active, used, expired, timesUsed };
  }, [voucherData]);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; phone: string; link?: boolean }) =>
      adminService.createCustomer(data),
    onSuccess: (created: { linked?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
      setLinkConfirm(null);
      resetForm();
      toast.success(created?.linked ? 'Linked existing customer' : 'Customer added');
    },
    onError: (err: any, variables) => {
      const existing = err.response?.status === 409 ? err.response?.data?.existing : null;
      if (existing) {
        setShowForm(false);
        setLinkConfirm({ name: variables.name, phone: variables.phone, existingName: existing.name ?? null });
        return;
      }
      toast.error(err.response?.data?.message || 'Failed to add customer');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      adminService.updateCustomer(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setEditing(null);
      resetForm();
      toast.success('Customer updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update customer');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteCustomer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setDeleteTarget(null);
      toast.success('Customer removed');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to delete customer');
    },
  });

  const resetForm = () => {
    setName('');
    setPhone('');
    setPhoneError('');
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setName(c.name ?? '');
    setPhone(c.phone);
    setPhoneError('');
    setShowForm(true);
  };

  const validatePhone = (): boolean => {
    if (!phone.trim()) {
      setPhoneError('Phone is required');
      return false;
    }
    try {
      validatePakistaniPhone(phone);
      setPhoneError('');
      return true;
    } catch {
      setPhoneError('Use Pakistani format: 03XXXXXXXXX (e.g. 03001234567)');
      return false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Customer name is required');
      return;
    }
    if (!validatePhone()) return;

    if (editing) {
      updateMutation.mutate({ id: editing.id, name: trimmedName });
    } else {
      const normalizedPhone = validatePakistaniPhone(phone);
      createMutation.mutate({ name: trimmedName, phone: normalizedPhone });
    }
  };

  const filtered = React.useMemo(() => {
    let list = (customers ?? []) as Customer[];
    if (sourceFilter) list = list.filter((c) => (c.source ?? 'pos') === sourceFilter);
    if (!debouncedFilter.trim()) return list;
    const q = debouncedFilter.trim().toLowerCase();
    return list.filter((c) => (c.name ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q));
  }, [customers, debouncedFilter, sourceFilter]);

  /** How many customers came from each channel (before the text filter). */
  const sourceCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of (customers ?? []) as Customer[]) {
      const key = c.source ?? 'pos';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [customers]);

  const customerNameTypeahead = useTypeaheadSuggestions({
    query: debouncedFilter,
    options: ((customers ?? []) as Customer[])
      .map((c) => ({ id: String(c.id), label: (c.name ?? '').trim() }))
      .filter((o) => o.label !== ''),
    minChars: 2,
    limit: 8,
  });

  const paginatedFiltered = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filtered.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filtered, page]);
  React.useEffect(() => setPage(1), [debouncedFilter, sourceFilter]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading customers...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Customers</h1>
        {canCreate && <Button variant="primary" onClick={openCreate}>Add customer</Button>}
      </div>
      <p className="text-gray-600 mb-4">
        Name and phone (Pakistani format 03XXXXXXXXX) are required. Phone is the unique identifier for loyalty.
      </p>
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onFocus={() => customerNameTypeahead.setOpen(true)}
            onKeyDown={(e) => {
              const suggestions = customerNameTypeahead.suggestions;
              if (!suggestions.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                customerNameTypeahead.setActiveIndex(Math.min(customerNameTypeahead.activeIndex + 1, suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                customerNameTypeahead.setActiveIndex(Math.max(customerNameTypeahead.activeIndex - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const opt = suggestions[customerNameTypeahead.activeIndex];
                if (opt?.label) setFilter(opt.label);
                customerNameTypeahead.setOpen(false);
              } else if (e.key === 'Escape') {
                customerNameTypeahead.setOpen(false);
              }
            }}
            placeholder="Filter by name or phone..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <TypeaheadDropdown
            open={customerNameTypeahead.open && filter.trim().length >= 2}
            suggestions={customerNameTypeahead.suggestions}
            activeIndex={customerNameTypeahead.activeIndex}
            onHoverIndex={customerNameTypeahead.setActiveIndex}
            onSelect={(opt) => {
              setFilter(opt.label);
              customerNameTypeahead.setOpen(false);
            }}
            onClose={() => customerNameTypeahead.setOpen(false)}
          />
        </div>
        {/* Registration channel — POS/counter vs mobile app vs website. */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          aria-label="Registered from"
          className="w-full sm:w-56 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All sources</option>
          {CUSTOMER_SOURCES.map((s) => (
            <option key={s} value={s}>
              {CUSTOMER_SOURCE_LABEL[s]}
              {sourceCounts[s] ? ` (${sourceCounts[s]})` : ''}
            </option>
          ))}
        </select>
        </div>
      </Card>
      <div className="w-full space-y-3">
        {!customers?.length ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No customers yet. Add one to use in POS.</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No customers match the filter.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedFiltered.map((c: Customer, i: number) => (
                <AccentedListRow
                  key={c.id}
                  accent="active"
                  initial={(c.name ?? 'C').charAt(0)}
                  title={c.name ?? '—'}
                  subtitle={
                    <>
                      <p className="font-mono">{c.phone}</p>
                      <p className="mt-0.5">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            CUSTOMER_SOURCE_BADGE[String(c.source ?? 'pos')] ??
                            'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                          title="Where this customer registered"
                        >
                          {customerSourceLabel(c.source ?? 'pos')}
                        </span>
                      </p>
                      {c.loyaltyWallets && c.loyaltyWallets.length > 0 ? (
                        <p>
                          Loyalty:{' '}
                          {c.loyaltyWallets
                            .map((w) =>
                              w.wallet_type === 'app'
                                ? `App ${w.balance}`
                                : `${w.brand_name ?? 'Brand'} ${w.balance}`,
                            )
                            .join(' · ')}{' '}
                          pts
                        </p>
                      ) : (
                        <p>Loyalty: 0 pts</p>
                      )}
                      {c.brands && c.brands.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.brands.map((b) => (
                            <span
                              key={b.id}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200"
                            >
                              {b.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  }
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="outline" onClick={() => setVouchersFor(c)}>Vouchers</Button>
                      {canEdit && <Button size="small" variant="edit" onClick={() => openEdit(c)}>Edit</Button>}
                      {canDelete && <Button size="small" variant="danger" onClick={() => setDeleteTarget(c)}>Delete</Button>}
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={filtered.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="customers" />
          </>
        )}
      </div>

      <Modal
        isOpen={linkConfirm != null}
        onClose={() => setLinkConfirm(null)}
        title="Customer already exists"
      >
        {linkConfirm && (
          <div className="space-y-4">
            <p className="text-gray-700">
              <span className="font-mono">{linkConfirm.phone}</span> already belongs to{' '}
              <strong>{linkConfirm.existingName ?? 'an existing customer'}</strong> under another brand.
              Link this customer to your brand?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setLinkConfirm(null)}>Cancel</Button>
              <Button
                isLoading={createMutation.isPending}
                onClick={() => createMutation.mutate({ name: linkConfirm.name, phone: linkConfirm.phone, link: true })}
              >
                Link customer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!vouchersFor}
        onClose={() => setVouchersFor(null)}
        title={vouchersFor ? `Vouchers — ${vouchersFor.name ?? vouchersFor.phone}` : 'Vouchers'}
        size="large"
      >
        {vouchersLoading ? (
          <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total', value: voucherStats.total, cls: 'text-gray-800 dark:text-slate-100' },
                { label: 'Active', value: voucherStats.active, cls: 'text-green-600' },
                { label: 'Used', value: voucherStats.used, cls: 'text-gray-500' },
                { label: 'Expired', value: voucherStats.expired, cls: 'text-red-500' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-gray-200 dark:border-slate-700 p-3 text-center">
                  <div className={`text-2xl font-extrabold ${s.cls}`}>{s.value}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</div>
                </div>
              ))}
            </div>

            {(voucherData?.vouchers?.length ?? 0) === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">
                This customer has no vouchers yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {voucherData!.vouchers.map((v) => {
                  const usable = v.status === 'active';
                  const statusColor =
                    v.status === 'active' ? 'bg-green-100 text-green-700'
                    : v.status === 'used' || v.status === 'exhausted' ? 'bg-gray-200 text-gray-600'
                    : 'bg-red-100 text-red-700';
                  return (
                    <div
                      key={v.id}
                      className={`rounded-xl border-2 border-dashed p-3 ${usable ? 'border-foodies-primary/40 bg-foodies-primary/5' : 'border-gray-200 opacity-70'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-base font-extrabold text-foodies-primary">
                            {v.type === 'percentage' ? `${v.value}% OFF` : `Rs ${v.value} OFF`}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate">{v.title}</div>
                        </div>
                        {v.qr_token && usable && (
                          <div className="bg-white p-1 rounded shrink-0">
                            <QRCodeSVG value={v.qr_token} size={40} />
                          </div>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 font-mono text-gray-600">{v.reference}</span>
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>{v.status}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {v.expires_at ? `exp ${new Date(v.expires_at).toLocaleDateString()}` : 'no expiry'}
                        {v.uses ? ` · used ${v.uses}×` : ''}
                        {v.per_customer_limit ? ` / ${v.per_customer_limit}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete customer"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-gray-700">
              Remove <strong>{deleteTarget.name ?? '—'}</strong> ({deleteTarget.phone})? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => deleteMutation.mutate(deleteTarget.id)} isLoading={deleteMutation.isPending}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); resetForm(); }}
        title={editing ? 'Edit customer' : 'Add customer'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Customer name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone * (Pakistani: 03XXXXXXXXX)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
              required
              disabled={!!editing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              placeholder={PAKISTANI_PHONE_PLACEHOLDER}
            />
            {phoneError && <p className="mt-1 text-sm text-red-600">{phoneError}</p>}
            {editing && <p className="mt-1 text-xs text-gray-500">Phone cannot be changed (unique identifier).</p>}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Update' : 'Add'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Customers;
