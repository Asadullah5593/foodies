import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { adminService } from '../../services/api';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';

const inputClass =
  'w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 dark:focus:ring-red-500/40 focus:border-red-500 dark:focus:border-red-500 transition-colors';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

const BusinessSettings: React.FC = () => {
  const { user } = useAuth();
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

  const isSubmitting = updateMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading business settings...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Business Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Update your business details below. These settings apply across your brands and branches.</p>
      </div>

      <Card className="p-6 sm:p-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMutation.mutate(formData);
          }}
          className="space-y-8"
        >
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-12">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2">Business identity</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Business name *</label>
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
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-12">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2">Tax & charges</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>GST on cash payments (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.gst_rate_cash}
                    onChange={(e) => setFormData({ ...formData, gst_rate_cash: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. 15"
                  />
                </div>
                <div>
                  <label className={labelClass}>GST on card / digital payments (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.gst_rate_card}
                    onChange={(e) => setFormData({ ...formData, gst_rate_card: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. 5"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Pakistan FBR charges a lower GST on card/digital payments than cash. Leave blank to use the default tax rate for that tender. Split (part-cash/part-card) bills are taxed proportionally.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2">Loyalty</h2>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="loyalty_enabled"
                  checked={formData.loyalty_enabled}
                  onChange={(e) => setFormData({ ...formData, loyalty_enabled: e.target.checked })}
                  className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-red-600 focus:ring-red-500/50 dark:bg-slate-800 dark:checked:bg-red-600"
                />
                <div>
                  <label htmlFor="loyalty_enabled" className="text-sm font-medium text-gray-700 dark:text-slate-300 cursor-pointer">
                    Enable loyalty / rewards program
                  </label>
                  <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                    Configure reward points and redemption in{' '}
                    <Link to="/admin/loyalty-settings" className="text-red-600 dark:text-red-400 hover:underline font-medium">
                      Loyalty Settings
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2">Printing</h2>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="auto_print_invoices"
                  checked={formData.auto_print_invoices}
                  onChange={(e) => setFormData({ ...formData, auto_print_invoices: e.target.checked })}
                  className="mt-1 h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-red-600 focus:ring-red-500/50 dark:bg-slate-800 dark:checked:bg-red-600"
                />
                <div>
                  <label htmlFor="auto_print_invoices" className="text-sm font-medium text-gray-700 dark:text-slate-300 cursor-pointer">
                    Auto-print invoices when an order is placed
                  </label>
                  <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                    The POS terminal prints the customer invoice and the kitchen invoice (KOT) as soon as an order is
                    placed. Each uses its own default template from Invoice Templates. The browser must allow pop-ups
                    on the terminal for printing to start automatically.
                  </p>
                </div>
              </div>
            </section>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" isLoading={updateMutation.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default BusinessSettings;
