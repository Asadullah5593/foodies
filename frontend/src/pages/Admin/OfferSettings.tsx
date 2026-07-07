import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api/adminService';
import { OfferSettings as Settings } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';

const TOGGLES: { key: keyof Settings; label: string; help: string }[] = [
  { key: 'capIncludesCardOffers', label: 'Count bank-card offers toward the cap', help: 'Off = bank-funded card offers are exempt from the max-total-discount cap.' },
  { key: 'capIncludesLoyalty', label: 'Count loyalty toward the cap', help: 'Whether redeemed loyalty is included in the max-total-discount cap.' },
  { key: 'costFloorEnabled', label: 'Enforce never-below-cost floor', help: 'A line is never discounted below its cost (where cost is known).' },
  { key: 'dealsCountTowardThresholds', label: 'Deals count toward coupon min-order', help: 'Deal value helps reach a "spend X" threshold, but deals are never discounted.' },
  { key: 'loyaltyAppliesToDeals', label: 'Loyalty can reduce deal value', help: 'Off = deal lines are untouched by loyalty redemption.' },
  { key: 'allowOffersOnDeals', label: 'Allow offers on deals', help: 'Off = discounts & coupons never touch deal lines (POS can override per order).' },
  { key: 'allowVoucherStacking', label: 'Allow voucher stacking', help: 'Off = one voucher per order.' },
  { key: 'offersApplyToOverriddenLines', label: 'Offers apply to price-overridden lines', help: 'Off = a POS price-overridden line gets no auto-discount/coupon.' },
  { key: 'priceOverrideBypassesCostFloor', label: 'Price override may go below cost', help: 'On = a manager override is not clamped to cost.' },
];

const OfferSettings: React.FC = () => {
  const queryClient = useQueryClient();
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

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-3xl">
      <h1 className="text-3xl font-bold text-gray-800 mb-2">Offer Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Global rules for how discounts, coupons, card offers and loyalty stack. Applies to POS and the app identically.</p>

      <Card className="p-6 space-y-6">
        <div>
          <h2 className="font-semibold text-gray-800 mb-3">Max total discount per order</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-sm text-gray-700">Percent of {form.maxTotalDiscountBase === 'full_subtotal' ? 'full' : 'non-deal'} subtotal</span>
              <input type="number" min={0} max={100} value={form.maxTotalDiscountPercent ?? ''}
                onChange={(e) => setForm({ ...form, maxTotalDiscountPercent: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="off"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Absolute cap (Rs)</span>
              <input type="number" min={0} value={form.maxTotalDiscountAmount ?? ''}
                onChange={(e) => setForm({ ...form, maxTotalDiscountAmount: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="off"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Cap base</span>
              <select value={form.maxTotalDiscountBase ?? 'non_deal_subtotal'}
                onChange={(e) => setForm({ ...form, maxTotalDiscountBase: e.target.value as Settings['maxTotalDiscountBase'] })}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="non_deal_subtotal">Non-deal subtotal</option>
                <option value="full_subtotal">Full subtotal</option>
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-3">
          {TOGGLES.map((t) => (
            <label key={t.key} className="flex items-start gap-3">
              <input type="checkbox" checked={Boolean(form[t.key])}
                onChange={(e) => setForm({ ...form, [t.key]: e.target.checked })}
                className="h-4 w-4 mt-1 text-blue-600 border-gray-300 rounded" />
              <span>
                <span className="text-sm font-medium text-gray-800">{t.label}</span>
                <span className="block text-xs text-gray-500">{t.help}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate(form)} isLoading={save.isPending}>Save settings</Button>
        </div>
      </Card>
    </div>
  );
};

export default OfferSettings;
