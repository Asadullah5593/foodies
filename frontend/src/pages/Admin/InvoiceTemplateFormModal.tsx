import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import LiveInvoicePreview from '../../invoices/LiveInvoicePreview';
import { richSampleInvoice } from '../../invoices/renderInvoice';
import {
  INVOICE_TOGGLE_GROUPS,
  InvoiceLayout,
  InvoiceTemplateConfig,
  LAYOUT_META,
} from '../../invoices/types';

export type InvoiceTemplateFormState = {
  id: number | null;
  name: string;
  layout: InvoiceLayout;
  brand_id: number | null;
  is_active: boolean;
  is_default: boolean;
  is_default_kitchen: boolean;
  config: InvoiceTemplateConfig;
};

interface Props {
  open: boolean;
  isEdit: boolean;
  form: InvoiceTemplateFormState;
  setForm: React.Dispatch<React.SetStateAction<InvoiceTemplateFormState>>;
  brands: Array<{ id: number; name: string }>;
  saving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

const LAYOUTS = Object.keys(LAYOUT_META) as InvoiceLayout[];

/** Font-weight choices for the typography overrides. 600 mirrors the info-box value column. */
const WEIGHT_OPTIONS = [
  { value: '400', label: 'Normal (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'Semi-bold (600) — matches values' },
  { value: '700', label: 'Bold (700)' },
  { value: '800', label: 'Extra-bold (800)' },
];

/* ---------------------------------------------------------------- icons -- */

type IconName = 'doc' | 'type' | 'list' | 'calc' | 'tag' | 'star' | 'info' | 'badge';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  doc: (
    <>
      <path d="M4 1.5h5.5L13 5v9.5H4z" />
      <path d="M9.5 1.5V5H13" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
      <line x1="6" y1="11" x2="11" y2="11" />
    </>
  ),
  type: (
    <>
      <path d="M3 4V2.8h10V4" />
      <line x1="8" y1="2.8" x2="8" y2="13.2" />
      <line x1="6" y1="13.2" x2="10" y2="13.2" />
    </>
  ),
  list: (
    <>
      <line x1="6" y1="4" x2="13" y2="4" />
      <line x1="6" y1="8" x2="13" y2="8" />
      <line x1="6" y1="12" x2="13" y2="12" />
      <circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  calc: (
    <>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <line x1="5.5" y1="5" x2="10.5" y2="5" />
      <line x1="5.5" y1="8.5" x2="5.6" y2="8.5" />
      <line x1="8" y1="8.5" x2="8.1" y2="8.5" />
      <line x1="10.5" y1="8.5" x2="10.6" y2="8.5" />
      <line x1="5.5" y1="11" x2="5.6" y2="11" />
    </>
  ),
  tag: (
    <>
      <path d="M2.5 7.5V3a.5.5 0 0 1 .5-.5h4.5L13.5 9 9 13.5z" />
      <circle cx="5.5" cy="5.5" r="1" />
    </>
  ),
  star: <path d="M8 2l1.7 3.6L13.5 6 10.8 8.8l.7 4L8 10.9 4.5 12.8l.7-4L2.5 6l3.8-.4z" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7.3" x2="8" y2="11" />
      <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  badge: (
    <>
      <circle cx="8" cy="6.5" r="4" />
      <path d="M5.5 9.8L4.5 14 8 12.3 11.5 14l-1-4.2" />
    </>
  ),
};

const Icon: React.FC<{ name: IconName; className?: string }> = ({ name, className }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {ICON_PATHS[name]}
  </svg>
);

/* ------------------------------------------------------------- toggles --- */

const SegToggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; ariaLabel?: string }> = ({
  on,
  onChange,
  ariaLabel,
}) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className="inline-flex flex-none select-none rounded-lg bg-gray-100 p-0.5"
  >
    <button
      type="button"
      onClick={() => onChange(true)}
      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
        on ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      On
    </button>
    <button
      type="button"
      onClick={() => onChange(false)}
      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
        !on ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      Off
    </button>
  </div>
);

const ToggleRow: React.FC<{ label: string; on: boolean; onChange: (v: boolean) => void }> = ({
  label,
  on,
  onChange,
}) => (
  <div className="flex min-h-[42px] items-center justify-between gap-3">
    <span className="text-sm text-gray-700">{label}</span>
    <SegToggle on={on} onChange={onChange} ariaLabel={label} />
  </div>
);

/* ---------------------------------------------------------- section defs -- */

type FieldDef =
  | { kind: 'text'; label: string; hint?: string; required?: boolean; placeholder?: string; value: string; onChange: (v: string) => void }
  | { kind: 'select'; label: string; hint?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }
  | { kind: 'textarea'; label: string; hint?: string; placeholder?: string; value: string; onChange: (v: string) => void }
  | { kind: 'number'; label: string; hint?: string; suffix?: string; value: number; min?: number; max?: number; step?: number; onChange: (v: string) => void }
  | { kind: 'toggle'; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }
  | { kind: 'image'; label: string; hint?: string; value: string; defaultHint?: string; onChange: (v: string) => void };

type Section =
  | { id: string; title: string; icon: IconName; desc: string; kind: 'fields'; fields: FieldDef[] }
  | { id: string; title: string; icon: IconName; desc: string; note?: string; kind: 'toggles'; items: Array<{ key: keyof InvoiceTemplateConfig; label: string }> };

const TOGGLE_GROUP_META: Record<string, { icon: IconName; desc: string; note?: string }> = {
  'Line items': { icon: 'list', desc: 'What prints under each ordered item.' },
  'Totals & charges': { icon: 'calc', desc: 'The money rows above the grand total.' },
  Discounts: {
    icon: 'tag',
    desc: 'How reductions are broken out.',
    note: 'Shows the combined total by default. Turn off “Show total discount” to itemize the promotional / coupon / card lines instead.',
  },
  Loyalty: { icon: 'star', desc: 'Points activity for the customer.' },
  Meta: { icon: 'info', desc: 'Order identifiers printed in the header block.' },
  Branding: { icon: 'badge', desc: 'Logo and the platform credit line.' },
};

/* ----------------------------------------------------------- component ---- */

const InvoiceTemplateFormModal: React.FC<Props> = ({
  open,
  isEdit,
  form,
  setForm,
  brands,
  saving,
  onClose,
  onSubmit,
}) => {
  const [activeId, setActiveId] = useState('details');
  // Signal for the live preview to flash the receipt line a toggle affects.
  const [flash, setFlash] = useState<{ key: string; nonce: number }>({ key: '', nonce: 0 });
  // FBR-logo upload: hidden file input + in-flight flag.
  const fbrLogoInputRef = useRef<HTMLInputElement>(null);
  const [fbrLogoUploading, setFbrLogoUploading] = useState(false);

  const uploadFbrLogo = async (
    file: File,
    onChange: (v: string) => void,
  ): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    setFbrLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // 'misc' is an S3-IAM-permitted prefix (dedicated 'invoice-logos' would
      // need the media-uploader IAM policy widened first).
      fd.append('folder', 'misc');
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(data.url);
      toast.success('Logo uploaded.');
    } catch (e: unknown) {
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to upload logo.',
      );
    } finally {
      setFbrLogoUploading(false);
    }
  };

  useEffect(() => {
    if (open) setActiveId('details');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const setCfg = (key: keyof InvoiceTemplateConfig, value: boolean | string | number | null) =>
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));
  const clampPct = (v: string) => Math.min(200, Math.max(50, Math.round(Number(v) || 100)));
  const clampMm = (v: string) => Math.min(80, Math.max(0, Math.round(Number(v) || 0)));

  // A single field toggled → update it and flash its receipt line in the preview.
  const toggleField = (key: keyof InvoiceTemplateConfig, value: boolean) => {
    setCfg(key, value);
    setFlash((prev) => ({ key, nonce: prev.nonce + 1 }));
  };

  const setAll = (items: Array<{ key: keyof InvoiceTemplateConfig }>, value: boolean) =>
    setForm((f) => {
      const config = { ...f.config };
      items.forEach((it) => {
        (config[it.key] as boolean) = value;
      });
      return { ...f, config };
    });
  const countOn = (items: Array<{ key: keyof InvoiceTemplateConfig }>) =>
    items.filter((it) => Boolean(form.config[it.key])).length;

  const brandName = (id: number | null) =>
    id == null ? 'all brands' : brands.find((b) => b.id === id)?.name ?? `Brand #${id}`;

  const sections: Section[] = [
    {
      id: 'details',
      title: 'Template details',
      icon: 'doc',
      desc: 'Name, scope and the free-text header / footer printed on every receipt.',
      kind: 'fields',
      fields: [
        {
          kind: 'text',
          label: 'Template name',
          required: true,
          placeholder: 'e.g. Classic Mono',
          value: form.name,
          onChange: (v) => setForm((f) => ({ ...f, name: v })),
        },
        {
          kind: 'select',
          label: 'Schema / layout',
          value: form.layout,
          options: LAYOUTS.map((l) => ({ value: l, label: LAYOUT_META[l].label })),
          onChange: (v) => setForm((f) => ({ ...f, layout: v as InvoiceLayout })),
        },
        {
          kind: 'select',
          label: 'Applies to',
          hint: "each brand's own logo prints automatically",
          value: form.brand_id == null ? '' : String(form.brand_id),
          options: [
            { value: '', label: 'All brands (tenant default)' },
            ...brands.map((b) => ({ value: String(b.id), label: b.name })),
          ],
          onChange: (v) => setForm((f) => ({ ...f, brand_id: v === '' ? null : Number(v) })),
        },
        {
          kind: 'textarea',
          label: 'Header text',
          hint: 'legal name / address / tax reg #',
          placeholder: 'Fireaway Ltd · 12 High St · VAT 123456789',
          value: form.config.headerText ?? '',
          onChange: (v) => setCfg('headerText', v || null),
        },
        {
          kind: 'textarea',
          label: 'Footer text',
          hint: 'thank-you / return policy',
          placeholder: 'Thank you for your order!',
          value: form.config.footerText ?? '',
          onChange: (v) => setCfg('footerText', v || null),
        },
        {
          kind: 'text',
          label: 'App QR text',
          hint: 'shown left of the download QR — turn the QR on under Branding',
          placeholder: 'Scan to download the Foodies app',
          value: form.config.appQrText ?? '',
          onChange: (v) => setCfg('appQrText', v || null),
        },
        {
          kind: 'image',
          label: 'FBR invoice logo',
          hint: 'shown on the FBR fiscal block — turn “Show FBR invoice # + QR” on under Branding',
          defaultHint: 'Default: PRA logo',
          value: form.config.fbrLogoUrl ?? '',
          onChange: (v) => setCfg('fbrLogoUrl', v || null),
        },
      ],
    },
    {
      id: 'amounts',
      title: 'Amounts',
      icon: 'calc',
      desc: 'Where deal prices print, and how a zero amount prints wherever a line bills nothing — free items, modifiers, add-ons and deal components. Rates of 0 hide too (except in the 0.00 mode); a real rate stays next to an "Included" amount.',
      kind: 'fields',
      fields: [
        {
          kind: 'select',
          label: 'Deal price placement',
          hint: 'where a deal’s price prints — on its name line, its component lines, or both',
          value: form.config.dealPriceDisplay ?? 'both',
          options: [
            { value: 'both', label: 'On deal name + components' },
            { value: 'items_only', label: 'Only on components (no price on deal name)' },
            { value: 'deal_only', label: 'Only on deal name (components without prices)' },
          ],
          onChange: (v) => setCfg('dealPriceDisplay', v),
        },
        {
          kind: 'select',
          label: 'Zero amount display',
          hint: 'applies wherever a line bills nothing',
          value: form.config.zeroAmountDisplay ?? 'zero',
          options: [
            { value: 'zero', label: 'Show 0.00' },
            { value: 'included', label: 'Show “Included”' },
            { value: 'blank', label: 'Leave empty' },
          ],
          onChange: (v) => setCfg('zeroAmountDisplay', v),
        },
      ],
    },
    {
      id: 'typography',
      title: 'Typography',
      icon: 'type',
      desc: 'Font size scales the whole receipt. Info-box headings, footer, loyalty and discount lines default to exactly the info-box value column (black, semi-bold, same size) — adjust their weight/size here.',
      kind: 'fields',
      fields: [
        {
          kind: 'select',
          label: 'Table number style',
          hint: 'how the table prints when “Show table number” is on — dine-in bills and kitchen tickets',
          value: form.config.tableNumberDisplay ?? 'row',
          options: [
            { value: 'row', label: 'Normal row (as today)' },
            { value: 'row_large', label: 'Row with enlarged number' },
            { value: 'banner', label: 'Big centered banner' },
            { value: 'banner_inverted', label: 'Inverted band (white on black)' },
          ],
          onChange: (v) => setCfg('tableNumberDisplay', v),
        },
        {
          kind: 'number',
          label: 'Receipt font size',
          suffix: '%  (50–200)',
          value: form.config.fontScalePct ?? 100,
          onChange: (v) => setCfg('fontScalePct', clampPct(v)),
        },
        {
          kind: 'number',
          label: '“Powered by” size',
          suffix: '%',
          value: form.config.poweredByFontPct ?? 95,
          onChange: (v) => setCfg('poweredByFontPct', clampPct(v)),
        },
        {
          kind: 'toggle',
          label: '“Powered by” bold',
          value: Boolean(form.config.poweredByBold),
          onChange: (v) => setCfg('poweredByBold', v),
        },
        {
          kind: 'select',
          label: 'App-QR text weight',
          hint: '“Scan to download …” next to the app QR; defaults to the info-box values (600)',
          value: String(form.config.appQrTextFontWeight ?? 600),
          options: WEIGHT_OPTIONS,
          onChange: (v) => setCfg('appQrTextFontWeight', Number(v)),
        },
        {
          kind: 'number',
          label: 'App-QR text size',
          suffix: '%  (100 = same as info-box values)',
          value: form.config.appQrTextFontPct ?? 100,
          onChange: (v) => setCfg('appQrTextFontPct', clampPct(v)),
        },
        {
          kind: 'select',
          label: 'Info-box headings weight',
          hint: 'defaults to the values column (600)',
          value: String(form.config.metaLabelsFontWeight ?? 600),
          options: WEIGHT_OPTIONS,
          onChange: (v) => setCfg('metaLabelsFontWeight', Number(v)),
        },
        {
          kind: 'number',
          label: 'Info-box headings size',
          suffix: '%  (100 = same as values)',
          value: form.config.metaLabelsFontPct ?? 100,
          onChange: (v) => setCfg('metaLabelsFontPct', clampPct(v)),
        },
        {
          kind: 'select',
          label: 'Footer weight',
          hint: 'defaults to the info-box values (600)',
          value: String(form.config.footerFontWeight ?? 600),
          options: WEIGHT_OPTIONS,
          onChange: (v) => setCfg('footerFontWeight', Number(v)),
        },
        {
          kind: 'number',
          label: 'Footer size',
          suffix: '%  (100 = same as info-box values)',
          value: form.config.footerFontPct ?? 100,
          onChange: (v) => setCfg('footerFontPct', clampPct(v)),
        },
        {
          kind: 'select',
          label: 'Loyalty / points weight',
          hint: 'defaults to the info-box values (600)',
          value: String(form.config.loyaltyFontWeight ?? 600),
          options: WEIGHT_OPTIONS,
          onChange: (v) => setCfg('loyaltyFontWeight', Number(v)),
        },
        {
          kind: 'number',
          label: 'Loyalty / points size',
          suffix: '%  (100 = same as info-box values)',
          value: form.config.loyaltyFontPct ?? 100,
          onChange: (v) => setCfg('loyaltyFontPct', clampPct(v)),
        },
        {
          kind: 'select',
          label: 'Discount lines weight',
          hint: 'printed black; defaults to the info-box values (600)',
          value: String(form.config.discountFontWeight ?? 600),
          options: WEIGHT_OPTIONS,
          onChange: (v) => setCfg('discountFontWeight', Number(v)),
        },
        {
          kind: 'number',
          label: 'Discount lines size',
          suffix: '%  (100 = same as info-box values)',
          value: form.config.discountFontPct ?? 100,
          onChange: (v) => setCfg('discountFontPct', clampPct(v)),
        },
      ],
    },
    {
      id: 'printing',
      title: 'Printing',
      icon: 'info',
      desc: 'Thermal paper handling. If your printer cuts off the last line, increase the bottom feed until it clears the cutter.',
      kind: 'fields',
      fields: [
        {
          kind: 'number',
          label: 'Bottom feed (cutter clearance)',
          hint: 'blank paper fed after the last line so it clears the print-head-to-cutter/tear-bar gap (0 = off)',
          suffix: 'mm  (0–80)',
          value: form.config.bottomFeedMm ?? 22,
          min: 0,
          max: 80,
          step: 2,
          onChange: (v) => setCfg('bottomFeedMm', clampMm(v)),
        },
      ],
    },
    ...INVOICE_TOGGLE_GROUPS.map((g) => {
      const meta = TOGGLE_GROUP_META[g.title] ?? { icon: 'list' as IconName, desc: '' };
      return {
        id: g.title,
        title: g.title,
        icon: meta.icon,
        desc: meta.desc,
        note: meta.note,
        kind: 'toggles' as const,
        items: g.items,
      };
    }),
  ];

  const active = sections.find((s) => s.id === activeId) ?? sections[0];
  const widthMm = LAYOUT_META[form.layout]?.widthMm ?? 80;

  const renderField = (fld: FieldDef) => {
    const inputCls =
      'w-full rounded-[10px] border-[1.5px] border-gray-200 bg-white px-[13px] py-2.5 text-sm text-gray-800 outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/10';
    return (
      <div key={fld.label}>
        <label className="mb-[7px] block text-[13px] font-semibold text-gray-700">
          {fld.label}
          {'required' in fld && fld.required && <span className="text-red-500"> *</span>}
          {fld.hint && <span className="font-normal text-gray-400"> — {fld.hint}</span>}
        </label>
        {fld.kind === 'text' && (
          <input
            className={inputCls}
            value={fld.value}
            placeholder={fld.placeholder}
            onChange={(e) => fld.onChange(e.target.value)}
          />
        )}
        {fld.kind === 'select' && (
          <select className={inputCls} value={fld.value} onChange={(e) => fld.onChange(e.target.value)}>
            {fld.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {fld.kind === 'textarea' && (
          <textarea
            className={`${inputCls} min-h-[74px] resize-y`}
            value={fld.value}
            placeholder={fld.placeholder}
            onChange={(e) => fld.onChange(e.target.value)}
          />
        )}
        {fld.kind === 'number' && (
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={fld.min ?? 50}
              max={fld.max ?? 200}
              step={fld.step ?? 5}
              className={`${inputCls} w-[120px]`}
              value={fld.value}
              onChange={(e) => fld.onChange(e.target.value)}
            />
            {fld.suffix && <span className="text-[13px] text-gray-400">{fld.suffix}</span>}
          </div>
        )}
        {fld.kind === 'toggle' && (
          <div className="max-w-[280px]">
            <ToggleRow label={fld.label} on={fld.value} onChange={fld.onChange} />
          </div>
        )}
        {fld.kind === 'image' && (
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-[10px] border border-gray-200 bg-gray-50">
              {fld.value ? (
                <img src={fld.value} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="px-1 text-center text-[9px] leading-tight text-gray-400">
                  {fld.defaultHint ?? 'Default'}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={fbrLogoUploading}
                  onClick={() => fbrLogoInputRef.current?.click()}
                  className="rounded-[8px] border-[1.5px] border-gray-200 px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 transition-colors hover:border-red-500 hover:text-red-600 disabled:opacity-60"
                >
                  {fbrLogoUploading ? 'Uploading…' : fld.value ? 'Replace logo' : 'Upload logo'}
                </button>
                {fld.value && (
                  <button
                    type="button"
                    disabled={fbrLogoUploading}
                    onClick={() => fld.onChange('')}
                    className="rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold text-gray-500 transition-colors hover:text-red-600 disabled:opacity-60"
                  >
                    Use default
                  </button>
                )}
              </div>
              <span className="text-[11.5px] text-gray-400">
                {fld.value ? 'Custom logo in use.' : (fld.defaultHint ?? 'The default logo is used.')}
              </span>
            </div>
            <input
              ref={fbrLogoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFbrLogo(file, fld.onChange);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className="flex h-[92vh] max-h-[920px] w-full max-w-[1180px] flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl"
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 18 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex flex-none items-center justify-between gap-4 border-b border-gray-100 px-6 py-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-red-50 text-red-600">
                    <Icon name="doc" className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-lg font-bold tracking-tight text-gray-800">
                      {isEdit ? 'Edit Invoice Template' : 'New Invoice Template'}
                    </div>
                    <div className="truncate text-[12.5px] text-gray-400">
                      {LAYOUT_META[form.layout]?.label ?? form.layout} · applies to {brandName(form.brand_id)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex min-h-0 flex-1">
                {/* Nav rail */}
                <div className="w-[216px] flex-none overflow-y-auto border-r border-gray-100 bg-gray-50 p-3">
                  {sections.map((sec) => {
                    const isActive = sec.id === active.id;
                    const isToggles = sec.kind === 'toggles';
                    const on = isToggles ? countOn(sec.items) : 0;
                    const total = isToggles ? sec.items.length : 0;
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => setActiveId(sec.id)}
                        className={`relative mb-0.5 flex w-full items-center gap-[11px] rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                          isActive ? 'bg-red-50' : 'hover:bg-gray-100'
                        }`}
                      >
                        <span
                          className={`absolute bottom-2 left-0 top-2 w-[3px] rounded-full ${
                            isActive ? 'bg-red-600' : 'bg-transparent'
                          }`}
                        />
                        <Icon
                          name={sec.icon}
                          className={`h-5 w-5 flex-none ${isActive ? 'text-red-600' : 'text-gray-400'}`}
                        />
                        <span
                          className={`flex-1 text-[13.5px] ${
                            isActive ? 'font-bold text-red-600' : 'font-medium text-gray-600'
                          }`}
                        >
                          {sec.title}
                        </span>
                        {isToggles && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                              isActive ? 'bg-white text-red-600' : 'bg-gray-200 text-gray-500'
                            }`}
                          >
                            {on}/{total}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Panel */}
                <div className="flex-1 overflow-y-auto px-7 py-6">
                  <div className="flex items-start justify-between gap-3.5">
                    <div>
                      <div className="text-[17px] font-bold tracking-tight text-gray-800">{active.title}</div>
                      {active.desc && (
                        <div className="mt-[3px] max-w-[420px] text-[13px] leading-relaxed text-gray-400">
                          {active.desc}
                        </div>
                      )}
                    </div>
                    {active.kind === 'toggles' && (
                      <div className="flex flex-none gap-2">
                        <button
                          type="button"
                          onClick={() => setAll(active.items, true)}
                          className="rounded-lg bg-gray-100 px-[11px] py-[7px] text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-200"
                        >
                          All on
                        </button>
                        <button
                          type="button"
                          onClick={() => setAll(active.items, false)}
                          className="rounded-lg bg-gray-100 px-[11px] py-[7px] text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-200"
                        >
                          All off
                        </button>
                      </div>
                    )}
                  </div>

                  {active.kind === 'toggles' ? (
                    <>
                      <div className="mt-3.5 grid grid-cols-1 gap-x-[30px] md:grid-cols-2">
                        {active.items.map((it) => (
                          <ToggleRow
                            key={it.key}
                            label={it.label}
                            on={Boolean(form.config[it.key])}
                            onChange={(v) => toggleField(it.key, v)}
                          />
                        ))}
                      </div>
                      {active.note && (
                        <div className="mt-4 flex items-start gap-2.5 rounded-[11px] border border-blue-100 bg-blue-50 px-3.5 py-3">
                          <span className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                            i
                          </span>
                          <div className="text-[12.5px] leading-relaxed text-slate-600">{active.note}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-[18px] flex flex-col gap-[18px]">{active.fields.map(renderField)}</div>
                  )}
                </div>

                {/* Live preview */}
                <div className="flex w-[340px] flex-none flex-col border-l border-gray-100 bg-gray-50">
                  <div className="flex flex-none items-center justify-between px-5 pb-3 pt-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Live preview</span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                      <span className="h-[7px] w-[7px] rounded-full bg-emerald-600" />
                      {widthMm}mm
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
                    <LiveInvoicePreview
                      data={richSampleInvoice()}
                      layout={form.layout}
                      config={form.config}
                      flashKey={flash.key || null}
                      flashNonce={flash.nonce}
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex flex-none items-center justify-between gap-4 border-t border-gray-100 bg-gray-50 px-6 py-4">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13.5px] font-semibold text-gray-700">Active</span>
                    <SegToggle
                      on={form.is_active}
                      onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                      ariaLabel="Active"
                    />
                  </div>
                  {(
                    [
                      { key: 'is_default' as const, label: 'Customer invoice default' },
                      { key: 'is_default_kitchen' as const, label: 'Kitchen invoice default' },
                    ]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, [key]: !f[key] }))}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={`flex h-[19px] w-[19px] flex-none items-center justify-center rounded-md border-[1.5px] ${
                          form[key] ? 'border-red-600 bg-red-600' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {form[key] && (
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3,8.5 6.5,12 13,4.5" />
                          </svg>
                        )}
                      </span>
                      <span className="text-[13.5px] text-gray-700">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-5 py-[11px] text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onSubmit}
                    disabled={saving}
                    className="rounded-[11px] bg-red-600 px-6 py-[11px] text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.97] disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : isEdit ? 'Update template' : 'Create template'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default InvoiceTemplateFormModal;
