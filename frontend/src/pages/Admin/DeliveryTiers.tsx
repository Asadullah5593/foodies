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
  'w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-colors';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';
const sectionTitleClass =
  'text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400';

type Band = { maxKm: number; fee: number };
type TierForm = {
  enabled: boolean;
  name: string;
  bands: Band[];
  etaMinMinutes: number;
  etaMaxMinutes: number;
};
type DeliveryTiersForm = {
  delivery_tiers_enabled: boolean;
  saver: TierForm;
  standard: TierForm;
  priority: TierForm;
  saverHoldMinutes: number;
  maxBatchSize: number;
};

const TIER_KEYS = ['saver', 'standard', 'priority'] as const;
type TierKey = (typeof TIER_KEYS)[number];

const TIER_META: Record<TierKey, { label: string; blurb: string }> = {
  saver: { label: 'Saver', blurb: 'Cheapest, longest ETA. Held briefly to batch with other orders.' },
  standard: { label: 'Standard', blurb: 'Default delivery; opportunistically batched.' },
  priority: { label: 'Priority', blurb: 'Fastest, dispatched immediately to a dedicated rider.' },
};

const emptyTier = (label: string): TierForm => ({
  enabled: false,
  name: label,
  bands: [{ maxKm: 5, fee: 0 }],
  etaMinMinutes: 30,
  etaMaxMinutes: 50,
});

const initialForm: DeliveryTiersForm = {
  delivery_tiers_enabled: false,
  saver: emptyTier('Saver'),
  standard: emptyTier('Standard'),
  priority: emptyTier('Priority'),
  saverHoldMinutes: 8,
  maxBatchSize: 1,
};

const DeliveryTiers: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = user?.tenant_id ?? null;

  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
  const [form, setForm] = useState<DeliveryTiersForm>(initialForm);

  const { data: brands } = useQuery({
    queryKey: ['brands', 'delivery-tiers'],
    queryFn: adminService.getBrands,
  });

  const effectiveBrandId = selectedBrandId ?? brands?.[0]?.id ?? null;
  const { data: settings, isLoading } = useQuery({
    queryKey: ['delivery-tiers', 'brand', effectiveBrandId],
    queryFn: () => adminService.getDeliveryTiers(effectiveBrandId!),
    enabled: effectiveBrandId != null,
  });

  useEffect(() => {
    if (!settings) return;
    const t = settings.tiers ?? {};
    const tier = (key: TierKey): TierForm => {
      const s = t[key] ?? {};
      const def = emptyTier(TIER_META[key].label);
      return {
        enabled: s.enabled ?? false,
        name: s.name ?? def.name,
        bands: Array.isArray(s.bands) && s.bands.length ? s.bands : def.bands,
        etaMinMinutes: Number(s.etaMinMinutes ?? def.etaMinMinutes),
        etaMaxMinutes: Number(s.etaMaxMinutes ?? def.etaMaxMinutes),
      };
    };
    setForm({
      delivery_tiers_enabled: settings.delivery_tiers_enabled ?? false,
      saver: tier('saver'),
      standard: tier('standard'),
      priority: tier('priority'),
      saverHoldMinutes: Number(t.saverHoldMinutes ?? 8),
      maxBatchSize: Number(t.maxBatchSize ?? 1),
    });
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: () =>
      adminService.updateDeliveryTiers(effectiveBrandId!, {
        delivery_tiers_enabled: form.delivery_tiers_enabled,
        tiers: {
          saver: form.saver,
          standard: form.standard,
          priority: form.priority,
          saverHoldMinutes: form.saverHoldMinutes,
          maxBatchSize: form.maxBatchSize,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-tiers', 'brand', effectiveBrandId] });
      toast.success('Delivery tiers updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update delivery tiers');
    },
  });

  const setTier = (key: TierKey, patch: Partial<TierForm>) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const setBand = (key: TierKey, idx: number, patch: Partial<Band>) =>
    setForm((f) => ({
      ...f,
      [key]: {
        ...f[key],
        bands: f[key].bands.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
      },
    }));
  const addBand = (key: TierKey) =>
    setForm((f) => {
      const last = f[key].bands[f[key].bands.length - 1];
      const nextKm = last ? last.maxKm + 5 : 5;
      return { ...f, [key]: { ...f[key], bands: [...f[key].bands, { maxKm: nextKm, fee: 0 }] } };
    });
  const removeBand = (key: TierKey, idx: number) =>
    setForm((f) => ({
      ...f,
      [key]: { ...f[key], bands: f[key].bands.filter((_, i) => i !== idx) },
    }));

  if (effectiveBrandId == null && tenantId == null) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
        <Card className="p-6">
          <p className="text-gray-600 dark:text-slate-400">You need a tenant context to manage delivery tiers.</p>
        </Card>
      </div>
    );
  }

  const isSubmitting = updateMutation.isPending;
  if ((isLoading && !settings) || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading delivery tiers...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Delivery Tiers</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Per-brand Saver / Standard / Priority delivery with a fee per distance band and a static ETA.
          When off, the brand's flat delivery fee is used.
        </p>
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
          <section className="flex items-center gap-3">
            <input
              type="checkbox"
              id="delivery_tiers_enabled"
              checked={form.delivery_tiers_enabled}
              onChange={(e) => setForm((f) => ({ ...f, delivery_tiers_enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500/50"
            />
            <label htmlFor="delivery_tiers_enabled" className="text-sm font-medium text-gray-700 dark:text-slate-300 cursor-pointer">
              Enable tier-based delivery for this brand
            </label>
          </section>

          {TIER_KEYS.map((key) => {
            const t = form[key];
            return (
              <section key={key} className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`enabled_${key}`}
                      checked={t.enabled}
                      onChange={(e) => setTier(key, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500/50"
                    />
                    <label htmlFor={`enabled_${key}`} className={`${sectionTitleClass} cursor-pointer`}>
                      {TIER_META[key].label}
                    </label>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-slate-400">{TIER_META[key].blurb}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelClass}>Display name</label>
                    <input
                      type="text"
                      value={t.name}
                      onChange={(e) => setTier(key, { name: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>ETA min (minutes)</label>
                    <input
                      type="number"
                      min={0}
                      value={t.etaMinMinutes}
                      onChange={(e) => setTier(key, { etaMinMinutes: Math.max(0, +e.target.value || 0) })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>ETA max (minutes)</label>
                    <input
                      type="number"
                      min={0}
                      value={t.etaMaxMinutes}
                      onChange={(e) => setTier(key, { etaMaxMinutes: Math.max(0, +e.target.value || 0) })}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Distance-band fees (ascending by max km)</label>
                  <div className="space-y-2">
                    {t.bands.map((b, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-slate-400 w-12">≤ km</span>
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={b.maxKm}
                          onChange={(e) => setBand(key, idx, { maxKm: Math.max(0, +e.target.value || 0) })}
                          className={`${inputClass} w-28`}
                        />
                        <span className="text-sm text-gray-500 dark:text-slate-400">fee</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={b.fee}
                          onChange={(e) => setBand(key, idx, { fee: Math.max(0, +e.target.value || 0) })}
                          className={`${inputClass} w-32`}
                        />
                        <Button
                          variant="outline"
                          size="small"
                          onClick={() => removeBand(key, idx)}
                          disabled={t.bands.length <= 1}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="small" onClick={() => addBand(key)} className="mt-2">
                    + Add band
                  </Button>
                </div>
              </section>
            );
          })}

          <section className="space-y-4">
            <h2 className={sectionTitleClass}>Dispatch knobs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div>
                <label className={labelClass}>Saver hold (minutes before dispatch)</label>
                <input
                  type="number"
                  min={0}
                  value={form.saverHoldMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, saverHoldMinutes: Math.max(0, +e.target.value || 0) }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Max batch size (1 = no stacking)</label>
                <input
                  type="number"
                  min={1}
                  value={form.maxBatchSize}
                  onChange={(e) => setForm((f) => ({ ...f, maxBatchSize: Math.max(1, +e.target.value || 1) }))}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              isLoading={updateMutation.isPending}
            >
              Update delivery tiers
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default DeliveryTiers;
