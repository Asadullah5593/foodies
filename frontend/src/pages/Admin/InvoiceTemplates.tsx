import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import { useHasPermission } from '../../hooks/useHasPermission';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import InvoicePreview from '../../invoices/InvoicePreview';
import { richSampleInvoice } from '../../invoices/renderInvoice';
import InvoiceTemplateFormModal from './InvoiceTemplateFormModal';
import {
  DEFAULT_INVOICE_TEMPLATE_CONFIG,
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
  is_default_kitchen: boolean;
  config: InvoiceTemplateConfig;
};

const emptyForm = () => ({
  id: null as number | null,
  name: '',
  layout: 'bill_bordered' as InvoiceLayout,
  brand_id: null as number | null,
  is_active: true,
  is_default: false,
  is_default_kitchen: false,
  config: { ...DEFAULT_INVOICE_TEMPLATE_CONFIG },
});

const InvoiceTemplates: React.FC = () => {
  const qc = useQueryClient();
  const canCreate = useHasPermission('invoice-templates:create');
  const canEdit = useHasPermission('invoice-templates:edit');
  const canDelete = useHasPermission('invoice-templates:delete');
  const canSetDefault = useHasPermission('invoice-templates:set-default');
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
    mutationFn: ({ id, purpose }: { id: number; purpose: 'customer' | 'kitchen' }) =>
      adminService.activateInvoiceTemplate(id, purpose),
    onSuccess: (_d, { purpose }) => {
      invalidate();
      toast.success(purpose === 'kitchen' ? 'Set as kitchen invoice default' : 'Set as customer invoice default');
    },
    onError: onErr,
  });
  const deleteM = useMutation({
    mutationFn: adminService.deleteInvoiceTemplate,
    onSuccess: () => { invalidate(); toast.success('Deleted'); },
    onError: onErr,
  });

  const openCreate = () => { setForm(emptyForm()); setShowForm(true); };
  /** Prefill the create form from an existing template: every setting and the
   *  schema carry over; the name is editable before saving (and later via edit).
   *  Default markers reset — a copy never steals the original's default slot. */
  const openDuplicate = (t: TemplateRow) => {
    setForm({
      id: null,
      name: `${t.name} (copy)`,
      layout: t.layout,
      brand_id: t.brand_id ?? null,
      is_active: t.is_active,
      is_default: false,
      is_default_kitchen: false,
      config: resolveInvoiceConfig(t.config),
    });
    setShowForm(true);
  };
  const openEdit = (t: TemplateRow) => {
    setForm({
      id: t.id,
      name: t.name,
      layout: t.layout,
      brand_id: t.brand_id ?? null,
      is_active: t.is_active,
      is_default: t.is_default,
      is_default_kitchen: t.is_default_kitchen,
      config: resolveInvoiceConfig(t.config),
    });
    setShowForm(true);
  };

  const submit = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const data = {
      name: form.name.trim(),
      layout: form.layout,
      brand_id: form.brand_id,
      is_active: form.is_active,
      is_default: form.is_default,
      is_default_kitchen: form.is_default_kitchen,
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
            Selectable invoice/receipt schemas with per-field toggles. Customer and kitchen (KOT) prints each
            have their own default per scope — kitchen falls back to the customer default until one is set.
          </p>
        </div>
        {canCreate && <Button onClick={openCreate}>New Template</Button>}
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
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">CUSTOMER DEFAULT</span>
                  )}
                  {t.is_default_kitchen && (
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">KITCHEN DEFAULT</span>
                  )}
                </p>
              }
              statusLabel={t.is_active ? 'Active' : 'Inactive'}
              statusVariant={t.is_active ? 'active' : 'inactive'}
              animationIndex={i}
              actions={
                <>
                  <Button size="small" variant="outline" onClick={() => setPreviewRow(t)}>Preview</Button>
                  {canEdit && <Button size="small" variant="edit" onClick={() => openEdit(t)}>Edit</Button>}
                  {canCreate && <Button size="small" variant="outline" onClick={() => openDuplicate(t)}>Duplicate</Button>}
                  {canSetDefault && !t.is_default && (
                    <Button size="small" variant="primary" onClick={() => activateM.mutate({ id: t.id, purpose: 'customer' })}>Set customer default</Button>
                  )}
                  {canSetDefault && !t.is_default_kitchen && (
                    <Button size="small" variant="outline" onClick={() => activateM.mutate({ id: t.id, purpose: 'kitchen' })}>Set kitchen default</Button>
                  )}
                  {canDelete && <Button size="small" variant="danger" onClick={async () => {
                    if (await confirmDialog({ title: `Delete "${t.name}"?`, confirmText: 'Delete' })) deleteM.mutate(t.id);
                  }}>Delete</Button>}
                </>
              }
            />
          ))}
        </AccentedList>
      )}

      <InvoiceTemplateFormModal
        open={showForm}
        isEdit={form.id != null}
        form={form}
        setForm={setForm}
        brands={brands ?? []}
        saving={createM.isPending || updateM.isPending}
        onClose={() => setShowForm(false)}
        onSubmit={submit}
      />

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
