import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { adminService } from '../../services/api';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';

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
  const isSuperAdmin = user?.is_super_admin === true;

  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(tenantId);
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

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: adminService.getTenants,
    enabled: isSuperAdmin,
  });

  const effectiveTenantId = selectedTenantId ?? (tenants?.[0]?.id ?? tenantId);
  const { data: settings, isLoading } = useQuery({
    queryKey: ['loyalty-settings', effectiveTenantId],
    queryFn: () => adminService.getLoyaltySettings(effectiveTenantId!),
    enabled: effectiveTenantId != null,
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
      adminService.updateLoyaltySettings(effectiveTenantId!, {
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
      queryClient.invalidateQueries({ queryKey: ['loyalty-settings', effectiveTenantId] });
      toast.success('Loyalty settings updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update settings');
    },
  });

  if (effectiveTenantId == null && !isSuperAdmin) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Card className="p-4">
          <p className="text-gray-600">You need a tenant context to manage loyalty settings.</p>
        </Card>
      </div>
    );
  }

  if (isLoading && !settings) {
    return <Loader fullScreen text="Loading loyalty settings..." />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Reward Point Settings</h1>

      {isSuperAdmin && tenants && tenants.length > 1 && (
        <Card className="mb-4 p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Tenant</h4>
          <select
            value={effectiveTenantId ?? ''}
            onChange={(e) => setSelectedTenantId(e.target.value ? +e.target.value : null)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Card>
      )}

      <Card className="p-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="loyalty_enabled"
                checked={form.loyalty_enabled}
                onChange={(e) => setForm((f) => ({ ...f, loyalty_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="loyalty_enabled" className="font-medium text-gray-800">
                Enable Reward Points
              </label>
            </div>

            <div className="max-w-md">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reward Point display name</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Reward Points"
              />
            </div>

            <hr className="border-gray-200 my-8" />

            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
              <div>
                <h2 className="font-semibold text-gray-800 mb-1">Earning points</h2>
                <p className="text-sm text-gray-600 mb-4">Customers earn points on completed orders. Rules are shown to customers for transparency.</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer spending required to earn 1 point</label>
                    <input
                      type="number"
                      min={1}
                      value={form.spend_per_point}
                      onChange={(e) => setForm((f) => ({ ...f, spend_per_point: Math.max(1, +e.target.value || 0) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">e.g. 1000 = Rs 1000 spent earns 1 point</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Minimum order amount to earn points</label>
                    <input
                      type="number"
                      min={0}
                      value={form.min_order_to_earn}
                      onChange={(e) => setForm((f) => ({ ...f, min_order_to_earn: Math.max(0, +e.target.value || 0) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h2 className="font-semibold text-gray-800 mb-1">Redeem points</h2>
                <p className="text-sm text-gray-600 mb-4">Points can be redeemed as discount at POS.</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cash value of 1 point (e.g. 10 = Rs 10)</label>
                    <input
                      type="number"
                      min={0}
                      value={form.cash_value_per_point}
                      onChange={(e) => setForm((f) => ({ ...f, cash_value_per_point: Math.max(0, +e.target.value || 0) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Minimum order amount to use points</label>
                    <input
                      type="number"
                      min={0}
                      value={form.min_order_to_redeem}
                      onChange={(e) => setForm((f) => ({ ...f, min_order_to_redeem: Math.max(0, +e.target.value || 0) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-gray-200 my-8" />

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reward point expiry period</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={form.expiry_period}
                    onChange={(e) => setForm((f) => ({ ...f, expiry_period: Math.max(1, +e.target.value || 0) }))}
                    className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={form.expiry_unit}
                    onChange={(e) => setForm((f) => ({ ...f, expiry_unit: e.target.value as 'day' | 'month' | 'year' }))}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="day">Day(s)</option>
                    <option value="month">Month(s)</option>
                    <option value="year">Year(s)</option>
                  </select>
                </div>
              </div>
              <Button
                onClick={() => updateMutation.mutate(form)}
                disabled={updateMutation.isPending}
                isLoading={updateMutation.isPending}
                className="ml-auto"
              >
                Update settings
              </Button>
            </div>
          </div>
        </Card>
    </div>
  );
};

export default LoyaltySettings;
