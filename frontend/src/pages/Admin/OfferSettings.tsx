import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api/adminService';
import { OfferSettings as Settings } from '../../types';
import Loader from '../../components/Loader';
import SegToggle from '../../components/SegToggle';
import { offerInput } from '../../components/OfferModal';
import { useHasPermission } from '../../hooks/useHasPermission';

type ToggleDef = { key: keyof Settings; label: string; help: string };

const GROUPS: { title: string; icon: React.ReactNode; rules: ToggleDef[] }[] = [
  {
    title: 'Discount cap rules',
    icon: <path d="M8 1.5v13M4 4.5h6a2 2 0 0 1 0 4H5a2 2 0 0 0 0 4h7" />,
    rules: [
      { key: 'capIncludesCardOffers', label: 'Count bank-card offers toward the cap', help: 'Off = bank-funded card offers are exempt from the max-total-discount cap.' },
      { key: 'capIncludesLoyalty', label: 'Count loyalty toward the cap', help: 'Whether redeemed loyalty is included in the max-total-discount cap.' },
      { key: 'costFloorEnabled', label: 'Enforce never-below-cost floor', help: 'A line is never discounted below its cost (where cost is known).' },
      { key: 'priceOverrideBypassesCostFloor', label: 'Price override may go below cost', help: 'On = a manager override is not clamped to cost.' },
    ],
  },
  {
    title: 'Stacking & eligibility',
    icon: <><path d="M8 2l6 3-6 3-6-3z" /><path d="M2 8l6 3 6-3" /><path d="M2 11l6 3 6-3" /></>,
    rules: [
      { key: 'dealsCountTowardThresholds', label: 'Deals count toward coupon min-order', help: 'Deal value helps reach a "spend X" threshold, but deals are never discounted.' },
      { key: 'loyaltyAppliesToDeals', label: 'Loyalty can reduce deal value', help: 'Off = deal lines are untouched by loyalty redemption.' },
      { key: 'allowOffersOnDeals', label: 'Allow offers on deals', help: 'Off = discounts & coupons never touch deal lines (POS can override per order).' },
      { key: 'allowVoucherStacking', label: 'Allow voucher stacking', help: 'Off = one voucher per order.' },
      { key: 'offersApplyToOverriddenLines', label: 'Offers apply to price-overridden lines', help: 'Off = a POS price-overridden line gets no auto-discount/coupon.' },
    ],
  },
];

const OfferSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const canEdit = useHasPermission('offer-settings:edit');
  const { data, isLoading } = useQuery({ queryKey: ['offer-settings'], queryFn: adminService.getOfferSettings });
  const [form, setForm] = useState<Settings>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: Partial<Settings>) => adminService.updateOfferSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-settings'] });
      toast.success('Offer settings saved');
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed to save'),
  });

  if (isLoading) return <Loader fullScreen text="Loading offer settings..." />;

  const saveBtn = !canEdit ? null : (
    <button
      onClick={() => save.mutate(form)}
      disabled={save.isPending}
      className="rounded-[11px] bg-red-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98] disabled:opacity-60"
    >
      Save settings
    </button>
  );

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      <div className="mx-auto max-w-[920px]">
        {/* Header */}
        <div className="mb-7 flex items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2 2 2.8-.4.4 2.8 2 2-1.4 2.6 1.4 2.6-2 2-.4 2.8L14 21l-2 2-2-2-2.8.4-.4-2.8-2-2 1.4-2.6L4.8 11.4l2-2 .4-2.8L10 5z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <div>
              <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">Offer Settings</h1>
              <p className="max-w-[620px] text-[14.5px] leading-relaxed text-gray-500">
                Global rules for how discounts, coupons, card offers and loyalty stack. Applies to POS and the app identically.
              </p>
            </div>
          </div>
          <div className="flex-none">{saveBtn}</div>
        </div>

        {/* Max total discount cap */}
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="text-[16px] font-bold text-gray-800">Max total discount per order</div>
          <div className="mb-4 mt-1 text-[13px] text-gray-400">The ceiling every order's combined reductions are capped to. Leave a field empty to disable that limit.</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">Percent of {form.maxTotalDiscountBase === 'full_subtotal' ? 'full' : 'non-deal'} subtotal</label>
              <div className="relative">
                <input type="number" min={0} max={100} value={form.maxTotalDiscountPercent ?? ''} onChange={(e) => setForm({ ...form, maxTotalDiscountPercent: e.target.value === '' ? null : Number(e.target.value) })} placeholder="off" className={offerInput} style={{ paddingRight: 34 }} />
                <span className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">Absolute cap</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-[13px] text-gray-400">Rs.</span>
                <input type="number" min={0} value={form.maxTotalDiscountAmount ?? ''} onChange={(e) => setForm({ ...form, maxTotalDiscountAmount: e.target.value === '' ? null : Number(e.target.value) })} placeholder="off" className={offerInput} style={{ paddingLeft: 40 }} />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">Cap base</label>
              <select value={form.maxTotalDiscountBase ?? 'non_deal_subtotal'} onChange={(e) => setForm({ ...form, maxTotalDiscountBase: e.target.value as Settings['maxTotalDiscountBase'] })} className={offerInput}>
                <option value="non_deal_subtotal">Non-deal subtotal</option>
                <option value="full_subtotal">Full subtotal</option>
              </select>
            </div>
          </div>
        </div>

        {/* Toggle groups */}
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="flex items-center gap-2.5 border-b border-gray-100 px-[22px] py-4">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">{g.icon}</svg>
              </span>
              <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-gray-400">{g.title}</span>
            </div>
            <div className="px-[22px]">
              {g.rules.map((r, i) => (
                <div key={String(r.key)} className={`flex items-center justify-between gap-5 py-[15px] ${i < g.rules.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold text-gray-800">{r.label}</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-gray-400">{r.help}</div>
                  </div>
                  <div className="flex-none">
                    <SegToggle on={Boolean(form[r.key])} onChange={(v) => setForm({ ...form, [r.key]: v })} ariaLabel={r.label} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end pt-1">{saveBtn}</div>
      </div>
    </div>
  );
};

export default OfferSettings;
