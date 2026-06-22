import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { adminService } from '../../services/api';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import SearchableSelect from '../../components/SearchableSelect';

const inputClass =
  'w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 dark:focus:ring-red-500/40 focus:border-red-500 dark:focus:border-red-500 transition-colors';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';
const sectionTitleClass = 'text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2';

type LoyaltySettingsData = {
  loyalty_enabled: boolean;
  display_name: string;
  spend_per_point: number;
  min_order_to_earn: number;
  cash_value_per_point: number;
  min_order_to_redeem: number;
  expiry_period: number;
  expiry_unit: 'day' | 'month' | 'year';
};

const LoyaltySettings: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = user?.tenant_id ?? null;

  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [form, setForm] = useState<LoyaltySettingsData>({
    loyalty_enabled: false,
    display_name: 'Reward Points',
    spend_per_point: 1000,
    min_order_to_earn: 1,
    cash_value_per_point: 10,
    min_order_to_redeem: 1,
    expiry_period: 365,
    expiry_unit: 'day',
  });

  // Loyalty is now configured per brand. Owner/GM see all their brands; a
  // brand-locked admin only sees their own (enforced server-side).
  const { data: brands } = useQuery({
    queryKey: ['brands', 'loyalty'],
    queryFn: adminService.getBrands,
  });

  const effectiveBrandId = selectedBrandId ?? (brands?.[0]?.id ?? null);
  const { data: settings, isLoading } = useQuery({
    queryKey: ['loyalty-settings', 'brand', effectiveBrandId],
    queryFn: () => adminService.getLoyaltySettings(effectiveBrandId!),
    enabled: effectiveBrandId != null,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        loyalty_enabled: settings.loyalty_enabled ?? false,
        display_name: settings.display_name ?? 'Reward Points',
        spend_per_point: Number(settings.spend_per_point ?? 1000),
        min_order_to_earn: Number(settings.min_order_to_earn ?? 1),
        cash_value_per_point: Number(settings.cash_value_per_point ?? 10),
        min_order_to_redeem: Number(settings.min_order_to_redeem ?? 1),
        expiry_period: Number(settings.expiry_period ?? 365),
        expiry_unit: (settings.expiry_unit as 'day' | 'month' | 'year') ?? 'day',
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<LoyaltySettingsData>) =>
      adminService.updateLoyaltySettings(effectiveBrandId!, {
        loyalty_enabled: data.loyalty_enabled,
        display_name: data.display_name,
        spend_per_point: data.spend_per_point,
        min_order_to_earn: data.min_order_to_earn,
        cash_value_per_point: data.cash_value_per_point,
        min_order_to_redeem: data.min_order_to_redeem,
        expiry_period: data.expiry_period,
        expiry_unit: data.expiry_unit,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-settings', 'brand', effectiveBrandId] });
      toast.success('Loyalty settings updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update settings');
    },
  });

  if (effectiveBrandId == null && tenantId == null) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
        <Card className="p-6">
          <p className="text-gray-600 dark:text-slate-400">You need a tenant context to manage loyalty settings.</p>
        </Card>
      </div>
    );
  }

  const isSubmitting = updateMutation.isPending;
  if ((isLoading && !settings) || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading loyalty settings...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Reward Point Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Configure how customers earn and redeem reward points for each brand. Each brand runs its own program.</p>
      </div>

      {brands && brands.length > 1 && (
        <Card className="mb-6 p-4 sm:p-5">
          <SearchableSelect
            label="Brand"
            value={effectiveBrandId != null ? String(effectiveBrandId) : ''}
            onChange={(v) => setSelectedBrandId(v ? +v : null)}
            options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
            placeholder="Select brand"
            minWidth="min-w-[200px]"
          />
        </Card>
      )}

      <Card className="p-6 sm:p-8">
        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className={sectionTitleClass}>General</h2>
            <div className="flex flex-wrap items-center gap-6 gap-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="loyalty_enabled"
                  checked={form.loyalty_enabled}
                  onChange={(e) => setForm((f) => ({ ...f, loyalty_enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-red-600 focus:ring-red-500/50 dark:bg-slate-800 dark:checked:bg-red-600"
                />
                <label htmlFor="loyalty_enabled" className="text-sm font-medium text-gray-700 dark:text-slate-300 cursor-pointer">
                  Enable Reward Points
                </label>
              </div>
              <div className="min-w-0 flex-1 max-w-md">
                <label className={labelClass}>Reward Point display name</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  className={inputClass}
                  placeholder="Reward Points"
                />
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-12">
          <section className="space-y-4">
            <h2 className={sectionTitleClass}>Earning points</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">Customers earn points on completed orders. Rules are shown to customers for transparency.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Customer spending required to earn 1 point</label>
                <input
                  type="number"
                  min={1}
                  value={form.spend_per_point}
                  onChange={(e) => setForm((f) => ({ ...f, spend_per_point: Math.max(1, +e.target.value || 0) }))}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">e.g. 1000 = Rs 1000 spent earns 1 point</p>
              </div>
              <div>
                <label className={labelClass}>Minimum order amount to earn points</label>
                <input
                  type="number"
                  min={0}
                  value={form.min_order_to_earn}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_to_earn: Math.max(0, +e.target.value || 0) }))}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className={sectionTitleClass}>Redeem points</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">Points can be redeemed as discount at POS.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Cash value of 1 point (e.g. 10 = Rs 10)</label>
                <input
                  type="number"
                  min={0}
                  value={form.cash_value_per_point}
                  onChange={(e) => setForm((f) => ({ ...f, cash_value_per_point: Math.max(0, +e.target.value || 0) }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Minimum order amount to use points</label>
                <input
                  type="number"
                  min={0}
                  value={form.min_order_to_redeem}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_to_redeem: Math.max(0, +e.target.value || 0) }))}
                  className={inputClass}
                />
              </div>
            </div>
          </section>
          </div>

          <section className="space-y-4">
            <h2 className={sectionTitleClass}>Reward point expiry</h2>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex gap-2 items-end flex-wrap">
                <div>
                  <label className={labelClass}>Expiry period</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={form.expiry_period}
                      onChange={(e) => setForm((f) => ({ ...f, expiry_period: Math.max(1, +e.target.value || 0) }))}
                      className={`${inputClass} w-28`}
                    />
                    <select
                      value={form.expiry_unit}
                      onChange={(e) => setForm((f) => ({ ...f, expiry_unit: e.target.value as 'day' | 'month' | 'year' }))}
                      className={inputClass}
                    >
                      <option value="day">Day(s)</option>
                      <option value="month">Month(s)</option>
                      <option value="year">Year(s)</option>
                    </select>
                  </div>
                </div>
              </div>
              <Button
                variant="primary"
                onClick={() => updateMutation.mutate(form)}
                disabled={updateMutation.isPending}
                isLoading={updateMutation.isPending}
                className="ml-auto"
              >
                Update settings
              </Button>
            </div>
          </section>
        </div>
      </Card>
    </div>
  );
};

export default LoyaltySettings;
