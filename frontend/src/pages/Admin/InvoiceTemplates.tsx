import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import InvoicePreview from '../../invoices/InvoicePreview';
import { richSampleInvoice } from '../../invoices/renderInvoice';
import {
  DEFAULT_INVOICE_TEMPLATE_CONFIG,
  INVOICE_TOGGLE_GROUPS,
  InvoiceLayout,
  InvoiceTemplateConfig,
  LAYOUT_META,
  resolveInvoiceConfig,
} from '../../invoices/types';

type TemplateRow = {
  id: number;
  brand_id: number | null;
  name: string;
  layout: InvoiceLayout;
  is_active: boolean;
  is_default: boolean;
  config: InvoiceTemplateConfig;
};

const LAYOUTS = Object.keys(LAYOUT_META) as InvoiceLayout[];

const emptyForm = () => ({
  id: null as number | null,
  name: '',
  layout: 'bill_bordered' as InvoiceLayout,
  brand_id: null as number | null,
  is_active: true,
  is_default: false,
  config: { ...DEFAULT_INVOICE_TEMPLATE_CONFIG },
});

const InvoiceTemplates: React.FC = () => {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [previewRow, setPreviewRow] = useState<TemplateRow | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['invoice-templates'],
    queryFn: adminService.getInvoiceTemplates,
  });
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const r = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return r.data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['invoice-templates'] });
  const onErr = (e: { response?: { data?: { message?: string } } }) =>
    toast.error(e.response?.data?.message || 'Failed');

  const createM = useMutation({
    mutationFn: adminService.createInvoiceTemplate,
    onSuccess: () => { invalidate(); setShowForm(false); toast.success('Template created'); },
    onError: onErr,
  });
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      adminService.updateInvoiceTemplate(id, data),
    onSuccess: () => { invalidate(); setShowForm(false); toast.success('Template updated'); },
    onError: onErr,
  });
  const activateM = useMutation({
    mutationFn: adminService.activateInvoiceTemplate,
    onSuccess: () => { invalidate(); toast.success('Set as default'); },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: adminService.deleteInvoiceTemplate,
    onSuccess: () => { invalidate(); toast.success('Deleted'); },
    onError: onErr,
  });

  const openCreate = () => { setForm(emptyForm()); setShowForm(true); };
  const openEdit = (t: TemplateRow) => {
    setForm({
      id: t.id,
      name: t.name,
      layout: t.layout,
      brand_id: t.brand_id ?? null,
      is_active: t.is_active,
      is_default: t.is_default,
      config: resolveInvoiceConfig(t.config),
    });
    setShowForm(true);
  };

  const setCfg = (key: keyof InvoiceTemplateConfig, value: boolean | string | number | null) =>
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));

  const clampPct = (v: string) => Math.min(200, Math.max(50, Math.round(Number(v) || 100)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const data = {
      name: form.name.trim(),
      layout: form.layout,
      brand_id: form.brand_id,
      is_active: form.is_active,
      is_default: form.is_default,
      config: form.config,
    };
    if (form.id) updateM.mutate({ id: form.id, data });
    else createM.mutate(data);
  };

  const brandName = (id: number | null) =>
    id == null ? 'All brands' : brands?.find((b) => b.id === id)?.name ?? `Brand #${id}`;

  if (isLoading) return <Loader fullScreen text="Loading invoice templates..." />;
  const list = (templates as TemplateRow[]) ?? [];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Invoice Templates</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Selectable invoice/receipt schemas with per-field toggles. The default for each scope prints at checkout.
          </p>
        </div>
        <Button onClick={openCreate}>New Template</Button>
      </div>

      {list.length === 0 ? (
        <Card><p className="text-center text-gray-500 py-12">No invoice templates yet — a built-in thermal default is used until you add one.</p></Card>
      ) : (
        <AccentedList>
          {list.map((t, i) => (
            <AccentedListRow
              key={t.id}
              accent={t.is_active ? 'active' : 'inactive'}
              initial={(t.name || '?').charAt(0)}
              title={t.name}
              subtitle={
                <p className="text-gray-500 text-xs flex items-center gap-2">
                  <span>{LAYOUT_META[t.layout]?.label ?? t.layout} · {brandName(t.brand_id)}</span>
                  {t.is_default && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">DEFAULT</span>
                  )}
                </p>
              }
              statusLabel={t.is_active ? 'Active' : 'Inactive'}
              statusVariant={t.is_active ? 'active' : 'inactive'}
              animationIndex={i}
              actions={
                <>
                  <Button size="small" variant="outline" onClick={() => setPreviewRow(t)}>Preview</Button>
                  <Button size="small" variant="edit" onClick={() => openEdit(t)}>Edit</Button>
                  {!t.is_default && (
                    <Button size="small" variant="primary" onClick={() => activateM.mutate(t.id)}>Set default</Button>
                  )}
                  <Button size="small" variant="danger" onClick={async () => {
                    if (await confirmDialog({ title: `Delete "${t.name}"?`, confirmText: 'Delete' })) deleteM.mutate(t.id);
                  }}>Delete</Button>
                </>
              }
            />
          ))}
        </AccentedList>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={form.id ? 'Edit Invoice Template' : 'New Invoice Template'} size="xlarge">
        <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: settings */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm text-gray-700 dark:text-slate-300">Name *</span>
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600" />
              </label>
              <label className="block">
                <span className="text-sm text-gray-700 dark:text-slate-300">Schema / layout</span>
                <select value={form.layout} onChange={(e) => setForm({ ...form, layout: e.target.value as InvoiceLayout })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600">
                  {LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_META[l].label}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-sm text-gray-700 dark:text-slate-300">Applies to</span>
              <select value={form.brand_id ?? ''} onChange={(e) => setForm({ ...form, brand_id: e.target.value === '' ? null : Number(e.target.value) })}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600">
                <option value="">All brands (tenant default)</option>
                {(brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <p className="text-xs text-gray-400">
              Each brand's own logo prints on its receipt automatically — the Foodies logo is used only when a brand has none.
            </p>

            <label className="block">
              <span className="text-sm text-gray-700 dark:text-slate-300">Header text (legal name / address / tax reg #)</span>
              <textarea value={form.config.headerText ?? ''} onChange={(e) => setCfg('headerText', e.target.value || null)} rows={2}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700 dark:text-slate-300">Footer text (thank-you / return policy)</span>
              <textarea value={form.config.footerText ?? ''} onChange={(e) => setCfg('footerText', e.target.value || null)} rows={2}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600" />
            </label>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5">Typography</h4>
              <div className="grid grid-cols-3 gap-3 items-end">
                <label className="block">
                  <span className="text-sm text-gray-700 dark:text-slate-300">Font size (%)</span>
                  <input type="number" min={50} max={200} step={5} value={form.config.fontScalePct ?? 100}
                    onChange={(e) => setCfg('fontScalePct', clampPct(e.target.value))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600" />
                </label>
                <label className="block">
                  <span className="text-sm text-gray-700 dark:text-slate-300">“Powered by” size (%)</span>
                  <input type="number" min={50} max={200} step={5} value={form.config.poweredByFontPct ?? 95}
                    onChange={(e) => setCfg('poweredByFontPct', clampPct(e.target.value))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg dark:bg-slate-800 dark:border-slate-600" />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 pb-2.5">
                  <input type="checkbox" checked={Boolean(form.config.poweredByBold)}
                    onChange={(e) => setCfg('poweredByBold', e.target.checked)} />
                  “Powered by” bold
                </label>
              </div>
              <p className="text-xs text-gray-400 mt-1">Font size scales the whole receipt (50–200%). The “powered by” line has its own size &amp; weight so it stays readable.</p>
            </div>

            {INVOICE_TOGGLE_GROUPS.map((group) => (
              <div key={group.title}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5">{group.title}</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {group.items.map((item) => (
                    <label key={item.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                      <input type="checkbox" checked={Boolean(form.config[item.key])}
                        onChange={(e) => setCfg(item.key, e.target.checked)} />
                      {item.label}
                    </label>
                  ))}
                </div>
                {group.title === 'Discounts' && (
                  <p className="text-xs text-gray-400 mt-1">
                    Shows the combined total by default. Turn off “Show total discount” to itemize the promotional / coupon / card lines instead.
                  </p>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-4 border-t pt-3 dark:border-slate-700">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Set as default for this scope</label>
            </div>
          </div>

          {/* Right: live preview */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Live preview</h4>
            <div className="sticky top-2">
              <InvoicePreview data={richSampleInvoice()} layout={form.layout} config={form.config} />
            </div>
          </div>

          <div className="lg:col-span-2 flex gap-2 justify-end border-t pt-4 dark:border-slate-700">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" isLoading={createM.isPending || updateM.isPending}>{form.id ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!previewRow}
        onClose={() => setPreviewRow(null)}
        title={previewRow ? `Preview — ${previewRow.name}` : 'Preview'}
        size="large"
      >
        {previewRow && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {LAYOUT_META[previewRow.layout]?.label ?? previewRow.layout} · {brandName(previewRow.brand_id)} — sample order
              with variants, add-ons, modifiers, a deal, notes and every discount type.
            </p>
            <InvoicePreview data={richSampleInvoice()} layout={previewRow.layout} config={previewRow.config} />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default InvoiceTemplates;
