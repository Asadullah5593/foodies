import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdStorefront, MdAttachMoney, MdStars, MdPrint, MdInfoOutline, MdReceiptLong } from 'react-icons/md';
import { useAuth } from '../../contexts/AuthContext';
import { useHasPermission } from '../../hooks/useHasPermission';
import { adminService } from '../../services/api';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import SegToggle from '../../components/SegToggle';

const inputClass =
  'w-full rounded-[10px] border-[1.5px] border-gray-200 bg-white px-[13px] py-[11px] text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/10 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500';
const labelClass = 'mb-[7px] block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300';
const cardClass =
  'rounded-2xl border border-gray-200 bg-white px-[26px] py-6 shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-800';

/** Card header: a tinted icon chip beside the section name. */
const SectionHead: React.FC<{ icon: React.ReactNode; chip: string; title: string }> = ({ icon, chip, title }) => (
  <div className="mb-[18px] flex items-center gap-2.5">
    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-[9px] ${chip}`}>{icon}</span>
    <span className="text-[15px] font-bold text-gray-800 dark:text-slate-100">{title}</span>
  </div>
);

/** A settings row: what it does on the left, its On/Off toggle on the right. */
const ToggleRow: React.FC<{
  title: string;
  children: React.ReactNode;
  on: boolean;
  onChange: (v: boolean) => void;
}> = ({ title, children, on, onChange }) => (
  <div className="flex items-center justify-between gap-3.5">
    <div className="max-w-[520px]">
      <div className="text-[13.5px] font-semibold text-gray-700 dark:text-slate-200">{title}</div>
      <div className="mt-0.5 text-[12px] leading-relaxed text-gray-400 dark:text-slate-400">{children}</div>
    </div>
    <SegToggle on={on} onChange={onChange} ariaLabel={title} />
  </div>
);

const BusinessSettings: React.FC = () => {
  const { user } = useAuth();
  const canEdit = useHasPermission('business-settings:edit');
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    legal_name: '',
    gst_rate_cash: '', // GST % for cash tender
    gst_rate_card: '', // GST % for card/digital tender (blank = same as cash)
    loyalty_enabled: false,
    auto_print_invoices: false,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['business-settings'],
    queryFn: adminService.getBusinessSettings,
    enabled: (user?.tenant_id ?? null) != null,
  });

  const { data: fbrStatus } = useQuery({
    queryKey: ['fbr-status'],
    queryFn: adminService.getFbrStatus,
    enabled: (user?.tenant_id ?? null) != null,
  });

  // The "all branches at once" switch: rewrites every branch's own FBR flag.
  const fbrBulkMutation = useMutation({
    mutationFn: adminService.fbrBulkToggle,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['fbr-status'] });
      if (res.enabled) {
        toast.success(
          `FBR enabled on ${res.updated} branch${res.updated === 1 ? '' : 'es'}` +
            (res.skipped_missing_credentials > 0
              ? ` — ${res.skipped_missing_credentials} skipped (no credentials saved)`
              : ''),
        );
      } else {
        toast.success(`FBR disabled on ${res.updated} branch${res.updated === 1 ? '' : 'es'}`);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update FBR on branches');
    },
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        name: settings.name ?? '',
        legal_name: settings.legal_name ?? '',
        // API stores as fraction (0–1); UI shows percent (0–100).
        gst_rate_cash: settings.gst_rate_cash != null ? String(Number(settings.gst_rate_cash) * 100) : '',
        gst_rate_card: settings.gst_rate_card != null ? String(Number(settings.gst_rate_card) * 100) : '',
        loyalty_enabled: settings.loyalty_enabled ?? false,
        auto_print_invoices: settings.auto_print_invoices ?? false,
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      adminService.updateBusinessSettings({
        name: data.name,
        legal_name: data.legal_name || undefined,
        // UI uses percent (0–100); API expects fraction (0–1).
        gst_rate_cash: data.gst_rate_cash.trim() !== '' ? Number(data.gst_rate_cash) / 100 : null,
        gst_rate_card: data.gst_rate_card.trim() !== '' ? Number(data.gst_rate_card) / 100 : null,
        loyalty_enabled: data.loyalty_enabled,
        auto_print_invoices: data.auto_print_invoices,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      toast.success('Business details updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update business settings');
    },
  });

  if (user?.tenant_id == null) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
        <Card className="p-6">
          <p className="text-gray-600 dark:text-slate-400">Business settings are only available for tenant users. Super admins manage tenants from the Tenants module.</p>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return <Loader fullScreen text="Loading business settings..." />;
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Business name is required');
      return;
    }
    updateMutation.mutate(formData);
  };

  // The summary restates the form in the terms the owner cares about, so the
  // effect of a change is visible without scrolling back through the cards.
  const gstSummary = `${formData.gst_rate_cash ? `${formData.gst_rate_cash}% cash` : 'default cash'} / ${
    formData.gst_rate_card ? `${formData.gst_rate_card}% card` : 'default card'
  }`;
  const summaryRow = (label: string, value: string, tone?: boolean) => (
    <div>
      <div className="text-[11.5px] text-gray-400 dark:text-slate-500">{label}</div>
      <div
        className={`mt-0.5 text-[13.5px] font-bold ${
          tone === undefined
            ? 'text-gray-800 dark:text-slate-100'
            : tone
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-gray-400 dark:text-slate-500'
        }`}
      >
        {value}
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="w-full px-4 py-6 sm:px-6 lg:px-10">
      <div className="mb-[26px]">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-800 dark:text-slate-100 sm:text-[26px]">Business Settings</h1>
        <p className="mt-1.5 text-[13.5px] text-gray-500 dark:text-slate-400">Applies across all your brands and branches.</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={cardClass}>
            <SectionHead
              icon={<MdStorefront size={16} />}
              chip="bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
              title="Business Identity"
            />
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              <div>
                <label className={labelClass}>Business name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className={inputClass}
                  placeholder="Your business name"
                />
              </div>
              <div>
                <label className={labelClass}>Legal name</label>
                <input
                  type="text"
                  value={formData.legal_name}
                  onChange={(e) => setFormData({ ...formData, legal_name: e.target.value })}
                  className={inputClass}
                  placeholder="Legal entity name (if different)"
                />
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <SectionHead
              icon={<MdAttachMoney size={17} />}
              chip="bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
              title="Tax & Charges"
            />
            <div className="mb-3.5 grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              {([
                ['GST on cash payments', 'gst_rate_cash', 'e.g. 15'],
                ['GST on card / digital', 'gst_rate_card', 'e.g. 5'],
              ] as const).map(([label, key, placeholder]) => (
                <div key={key}>
                  <label className={labelClass}>{label}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={formData[key]}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                      className={`${inputClass} pr-8`}
                      placeholder={placeholder}
                    />
                    <span className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-[13px] text-gray-400 dark:text-slate-500">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 rounded-[10px] bg-gray-50 px-3.5 py-3 dark:bg-slate-900/40">
              <MdInfoOutline size={15} className="mt-px flex-none text-gray-400 dark:text-slate-500" />
              <span className="text-[12px] leading-relaxed text-gray-500 dark:text-slate-400">
                Pakistan FBR charges a lower GST on card/digital payments than cash. Leave blank to use the default tax rate for that tender. Split (part-cash/part-card) bills are taxed proportionally.
              </span>
            </div>
          </div>

          <div className={cardClass}>
            <SectionHead
              icon={<MdStars size={17} />}
              chip="bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
              title="Loyalty"
            />
            <ToggleRow
              title="Enable loyalty / rewards program"
              on={formData.loyalty_enabled}
              onChange={(v) => setFormData({ ...formData, loyalty_enabled: v })}
            >
              Configure reward points and redemption in{' '}
              <Link to="/admin/loyalty-settings" className="font-semibold text-red-600 hover:underline dark:text-red-400">
                Loyalty Settings
              </Link>
              .
            </ToggleRow>
          </div>

          <div className={cardClass}>
            <SectionHead
              icon={<MdPrint size={16} />}
              chip="bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-300"
              title="Printing"
            />
            <ToggleRow
              title="Auto-print invoices when an order is placed"
              on={formData.auto_print_invoices}
              onChange={(v) => setFormData({ ...formData, auto_print_invoices: v })}
            >
              Prints the customer invoice and kitchen invoice (KOT) as soon as an order is placed, using each one&apos;s default Invoice Template. The terminal&apos;s browser must allow pop-ups.
            </ToggleRow>
          </div>

          <div className={cardClass}>
            <SectionHead
              icon={<MdReceiptLong size={16} />}
              chip="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
              title="FBR Invoicing"
            />
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3.5">
              <div className="max-w-[520px]">
                <div className="text-[13.5px] font-semibold text-gray-700 dark:text-slate-200">
                  {fbrStatus
                    ? `Reporting on ${fbrStatus.enabled_branches} of ${fbrStatus.total_branches} branches`
                    : 'Loading branch status…'}
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-gray-400 dark:text-slate-400">
                  These buttons rewrite <strong>every branch&apos;s own</strong> FBR switch in one go. Credentials
                  (POS ID + token) are configured per branch under each Branch&apos;s settings; enabling skips
                  branches with no credentials saved.
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={fbrBulkMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Enable FBR reporting on ALL branches that have credentials saved?'))
                      fbrBulkMutation.mutate(true);
                  }}
                  className="rounded-[10px] border-[1.5px] border-emerald-500 px-3.5 py-2 text-[12.5px] font-bold text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                >
                  Enable on all
                </button>
                <button
                  type="button"
                  disabled={fbrBulkMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Disable FBR reporting on ALL branches? Receipts will reuse each branch’s last real FBR number.'))
                      fbrBulkMutation.mutate(false);
                  }}
                  className="rounded-[10px] border-[1.5px] border-red-500 px-3.5 py-2 text-[12.5px] font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Disable on all
                </button>
              </div>
            </div>
            {(fbrStatus?.branches?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                {fbrStatus!.branches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-[10px] bg-gray-50 px-3.5 py-2 dark:bg-slate-900/40"
                  >
                    <Link
                      to={`/admin/branches/${b.id}`}
                      className="truncate text-[12.5px] font-semibold text-gray-700 hover:underline dark:text-slate-200"
                    >
                      {b.name}
                    </Link>
                    <span className="flex flex-none items-center gap-2">
                      {!b.has_credentials && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                          No credentials
                        </span>
                      )}
                      {b.fbr_enabled && b.fbr_environment === 'sandbox' && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
                          Sandbox
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          b.fbr_enabled
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                            : 'bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
                        }`}
                      >
                        {b.fbr_enabled ? 'On' : 'Off'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-6">
          <div className="rounded-2xl border border-gray-200 bg-white px-[22px] py-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3.5 text-[12px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">Summary</div>
            <div className="flex flex-col gap-3">
              {summaryRow('Business', formData.name || '—')}
              {summaryRow('GST', gstSummary)}
              {summaryRow('Loyalty', formData.loyalty_enabled ? 'Enabled' : 'Disabled', formData.loyalty_enabled)}
              {summaryRow('Auto-print', formData.auto_print_invoices ? 'On' : 'Off', formData.auto_print_invoices)}
              {summaryRow(
                'FBR',
                fbrStatus ? `${fbrStatus.enabled_branches}/${fbrStatus.total_branches} branches` : '—',
                fbrStatus ? fbrStatus.enabled_branches > 0 : undefined,
              )}
            </div>
            {canEdit && <button
              type="submit"
              disabled={updateMutation.isPending}
              className="mt-[18px] w-full rounded-[11px] bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98] disabled:opacity-60"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>}
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 dark:border-blue-500/25 dark:bg-blue-500/10">
            <span className="mt-px flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full bg-blue-500 text-[11px] font-bold text-white">i</span>
            <span className="text-[12px] leading-relaxed text-blue-900/80 dark:text-blue-200">
              These settings apply business-wide. Per-branch overrides live under each Branch&apos;s own settings.
            </span>
          </div>
        </div>
      </div>
    </form>
  );
};

export default BusinessSettings;
