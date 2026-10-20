import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdArrowBack, MdOutlineCampaign, MdOutlineImage, MdSend } from 'react-icons/md';
import type {
  PushAudienceSpec,
  PushMessage,
  PushMessagePayload,
  PushMeta,
  PushTestResult,
} from '../../../types';
import { pushService } from '../../../services/api';
import apiClient from '../../../utils/apiClient';
import { confirmDialog } from '../../../utils/sweetAlert';
import { useHasPermission } from '../../../hooks/useHasPermission';
import SegToggle from '../../../components/SegToggle';
import Modal from '../../../components/Modal';
import { cu } from '../customersUi';
import { inputInline } from './pushUi';
import AudienceBuilder, { AudienceCounts } from './AudienceBuilder';
import SchedulePicker, { defaultRepeat, type ScheduleValue } from './SchedulePicker';
import PhonePreview from './PhonePreview';
import { AUTOMATION_PRESETS, audienceSummary, describeSchedule, perCustomerText } from './pushText';
import { wallClock } from './pushTime';

const EMPTY: PushAudienceSpec = { match: 'all', include: [], exclude: [] };
const card = `${cu.card} rounded-[16px] p-5`;
const h2 = `mb-3 text-[15.5px] font-bold ${cu.strong}`;

interface FormState {
  name: string;
  brand_id: number | null;
  title: string;
  body: string;
  image_url: string;
  expiry_hours: number;
  replace_previous: boolean;
  audience_mode: 'build' | 'saved';
  audience: PushAudienceSpec;
  audience_id: number | null;
  skip_order_in_progress: boolean;
  respect_cap: boolean;
  schedule: ScheduleValue;
  ab_on: boolean;
  variant_b: { title: string; body: string };
  ab_split: number;
  holdout_percent: number;
}

function fromMessage(m: PushMessage): FormState {
  return {
    name: m.name ?? '',
    brand_id: m.brand_id,
    title: m.title,
    body: m.body,
    image_url: m.image_url ?? '',
    expiry_hours: m.expiry_hours,
    replace_previous: m.replace_previous,
    audience_mode: m.audience_id ? 'saved' : 'build',
    audience: m.audience ?? EMPTY,
    audience_id: m.audience_id,
    skip_order_in_progress: m.skip_order_in_progress,
    respect_cap: m.respect_cap,
    schedule: {
      schedule_type: m.schedule_type,
      send_at: m.send_at,
      repeat: m.repeat,
      per_customer: m.per_customer,
      per_customer_days: m.per_customer_days,
    },
    ab_on: !!m.variant_b,
    variant_b: m.variant_b ?? { title: '', body: '' },
    ab_split: m.ab_split ?? 50,
    holdout_percent: m.holdout_percent ?? 0,
  };
}

function blank(meta: PushMeta): FormState {
  return {
    name: '',
    brand_id: meta.brand_locked && meta.options.brands.length === 1 ? meta.options.brands[0].id : null,
    title: '',
    body: '',
    image_url: '',
    expiry_hours: meta.settings.default_expiry_hours,
    replace_previous: false,
    audience_mode: 'build',
    audience: EMPTY,
    audience_id: null,
    skip_order_in_progress: meta.settings.skip_order_in_progress,
    respect_cap: true,
    schedule: { schedule_type: 'now', send_at: null, repeat: null, per_customer: 'every', per_customer_days: null },
    ab_on: false,
    variant_b: { title: '', body: '' },
    ab_split: 50,
    holdout_percent: 0,
  };
}

function toPayload(f: FormState, action: 'draft' | 'schedule'): PushMessagePayload {
  return {
    action,
    name: f.name.trim() || null,
    brand_id: f.brand_id,
    title: f.title.trim(),
    body: f.body.trim(),
    image_url: f.image_url.trim() || null,
    expiry_hours: f.expiry_hours,
    replace_previous: f.replace_previous,
    audience: f.audience_mode === 'build' ? f.audience : undefined,
    audience_id: f.audience_mode === 'saved' ? f.audience_id : null,
    skip_order_in_progress: f.skip_order_in_progress,
    respect_cap: f.respect_cap,
    per_customer: f.schedule.schedule_type === 'repeat' ? f.schedule.per_customer : 'every',
    per_customer_days: f.schedule.per_customer === 'days' ? f.schedule.per_customer_days : null,
    schedule_type: f.schedule.schedule_type,
    send_at: f.schedule.schedule_type === 'once' ? f.schedule.send_at : null,
    repeat: f.schedule.schedule_type === 'repeat' ? f.schedule.repeat : null,
    variant_b: f.ab_on ? { title: f.variant_b.title.trim(), body: f.variant_b.body.trim() } : null,
    ab_split: f.ab_on ? f.ab_split : null,
    holdout_percent: f.holdout_percent,
  };
}

function errorText(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Something went wrong');
}

const PushComposer: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const editId = id ? Number(id) : null;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canSend = useHasPermission('push-notifications:send');

  const { data: meta } = useQuery({ queryKey: ['push-meta'], queryFn: pushService.meta });
  const { data: existing } = useQuery({
    queryKey: ['push-message', editId],
    queryFn: () => pushService.detail(editId!),
    enabled: editId != null,
  });
  const { data: templates = [] } = useQuery({ queryKey: ['push-templates'], queryFn: pushService.templates });
  const { data: savedAudiences = [] } = useQuery({ queryKey: ['push-audiences'], queryFn: pushService.audiences });
  const resendId = search.get('resend') ? Number(search.get('resend')) : null;
  const { data: resendFrom } = useQuery({
    queryKey: ['push-message', resendId],
    queryFn: () => pushService.detail(resendId!),
    enabled: resendId != null,
  });

  const [f, setF] = useState<FormState | null>(null);
  const set = (patch: Partial<FormState>) => setF((prev) => (prev ? { ...prev, ...patch } : prev));
  const lastField = useRef<{ field: 'title' | 'body' | 'b_title' | 'b_body'; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [testResults, setTestResults] = useState<PushTestResult[] | null>(null);
  const [saveAudienceOpen, setSaveAudienceOpen] = useState(false);
  const [audienceName, setAudienceName] = useState('');

  // —— start the form once everything it needs has loaded ——
  useEffect(() => {
    if (f || !meta) return;
    if (editId != null) {
      if (!existing) return;
      if (!['draft', 'scheduled', 'active', 'paused'].includes(existing.message.status)) {
        navigate(`/admin/push-notifications/${editId}`, { replace: true });
        return;
      }
      setF(fromMessage(existing.message));
      return;
    }
    if (resendId != null && !resendFrom) return;
    let start = blank(meta);
    const tpl = templates.find((t) => t.id === Number(search.get('template')));
    if (tpl) start = { ...start, title: tpl.title, body: tpl.body, image_url: tpl.imageUrl ?? '' };
    const aud = search.get('audience');
    if (aud) start = { ...start, audience_mode: 'saved', audience_id: Number(aud) };
    const preset = AUTOMATION_PRESETS.find((p) => p.key === search.get('preset'));
    if (preset) start = applyPreset(start, preset.key, meta);
    if (resendFrom) {
      const days = Number(search.get('days') ?? 3);
      start = {
        ...start,
        name: `Reminder: ${resendFrom.message.name || resendFrom.message.title}`,
        title: resendFrom.message.title,
        body: resendFrom.message.body,
        image_url: resendFrom.message.image_url ?? '',
        brand_id: resendFrom.message.brand_id,
        audience: {
          match: 'all',
          include: [{ rule: 'got_message', params: { message_id: resendFrom.message.id, no_order_within_days: days } }],
          exclude: [],
        },
      };
    }
    setF(start);
  }, [meta, existing, templates, resendFrom, f, editId, resendId, search, navigate]);

  function applyPreset(base: FormState, key: string, m: PushMeta): FormState {
    const p = AUTOMATION_PRESETS.find((x) => x.key === key);
    if (!p) return base;
    return {
      ...base,
      name: p.label,
      title: p.title,
      body: p.body,
      audience_mode: 'build',
      audience: p.audience,
      audience_id: null,
      schedule: {
        schedule_type: 'repeat',
        send_at: null,
        repeat: { ...p.repeat, starts_on: wallClock(new Date(), m.settings.timezone).date },
        per_customer: p.per_customer,
        per_customer_days: p.per_customer_days ?? null,
      },
    };
  }

  const insertToken = (key: string) => {
    if (!f) return;
    const target = lastField.current ?? null;
    const token = `{${key}}`;
    const field = target?.field ?? 'body';
    const current =
      field === 'title' ? f.title : field === 'body' ? f.body : field === 'b_title' ? f.variant_b.title : f.variant_b.body;
    const pos = target?.el.selectionStart ?? current.length;
    const next = current.slice(0, pos) + token + current.slice(target?.el.selectionEnd ?? pos);
    if (field === 'title') set({ title: next });
    else if (field === 'body') set({ body: next });
    else if (field === 'b_title') set({ variant_b: { ...f.variant_b, title: next } });
    else set({ variant_b: { ...f.variant_b, body: next } });
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', 'promotions');
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!data?.url?.trim()) throw new Error('no url');
      set({ image_url: data.url });
      toast.success('Image uploaded');
    } catch {
      toast.error('Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  const testMutation = useMutation({
    mutationFn: () =>
      pushService.test({
        title: f!.title,
        body: f!.body,
        image_url: f!.image_url || null,
        expiry_hours: f!.expiry_hours,
        replace_previous: f!.replace_previous,
      }),
    onSuccess: (d) => {
      setTestResults(d.results);
      const ok = d.results.reduce((s, r) => s + r.sent, 0);
      if (ok > 0) toast.success(`Test sent to ${ok} phone${ok === 1 ? '' : 's'}`);
      else toast.error('The test did not reach any phone — see why below');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const saveMutation = useMutation({
    mutationFn: (action: 'draft' | 'schedule') =>
      editId != null ? pushService.update(editId, toPayload(f!, action)) : pushService.create(toPayload(f!, action)),
    onSuccess: (d, action) => {
      qc.invalidateQueries({ queryKey: ['push-messages'] });
      qc.invalidateQueries({ queryKey: ['push-message', d.message.id] });
      qc.invalidateQueries({ queryKey: ['push-overview'] });
      toast.success(action === 'draft' ? 'Draft saved' : d.message.schedule_type === 'now' ? 'Sending now' : 'Scheduled');
      navigate(`/admin/push-notifications/${d.message.id}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const saveAudienceMutation = useMutation({
    mutationFn: () => pushService.saveAudience({ name: audienceName.trim(), rules: f!.audience }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['push-audiences'] });
      setSaveAudienceOpen(false);
      setAudienceName('');
      set({ audience_mode: 'saved', audience_id: a.id });
      toast.success('Audience saved');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const primaryLabel = useMemo(() => {
    if (!f) return 'Send';
    if (f.schedule.schedule_type === 'now') return 'Send now';
    if (f.schedule.schedule_type === 'once') return 'Schedule';
    return 'Start repeating';
  }, [f]);

  if (!meta || !f) {
    return <div className={`${cu.page} text-gray-500`}>Loading…</div>;
  }
  if (!canSend) {
    return <div className={`${cu.page} text-gray-500`}>You can view notifications but not send them.</div>;
  }

  const tokens = meta.personal_tokens;
  const selectedSaved = savedAudiences.find((a) => a.id === f.audience_id);
  const audienceForSummary = f.audience_mode === 'saved' ? selectedSaved?.rules : f.audience;

  const confirmAndSend = async () => {
    if (!f.title.trim() || !f.body.trim()) {
      toast.error('Write a title and a message first');
      return;
    }
    let counts: { eligible: number; phones: number } | null = null;
    try {
      counts = await pushService.previewAudience({
        audience: f.audience_mode === 'build' ? f.audience : undefined,
        audience_id: f.audience_mode === 'saved' ? f.audience_id : null,
        skip_order_in_progress: f.skip_order_in_progress,
        respect_cap: f.respect_cap,
      });
    } catch (e) {
      toast.error(errorText(e));
      return;
    }
    const who = `${counts.eligible.toLocaleString('en-US')} customer${counts.eligible === 1 ? '' : 's'} (${counts.phones.toLocaleString('en-US')} phone${counts.phones === 1 ? '' : 's'})`;
    const text =
      f.schedule.schedule_type === 'now'
        ? `It goes to ${who} within a minute. A sent notification cannot be taken back.`
        : f.schedule.schedule_type === 'once'
          ? `${describeSchedule(f.schedule)}. Right now that would reach ${who}; the audience is counted again when it goes out.`
          : `${describeSchedule(f.schedule)}. ${perCustomerText(f.schedule.per_customer, f.schedule.per_customer_days)}. Right now one send would reach ${who}.`;
    const ok = await confirmDialog({
      title: f.schedule.schedule_type === 'now' ? 'Send this notification now?' : primaryLabel + '?',
      text,
      confirmText: primaryLabel,
    });
    if (ok) saveMutation.mutate('schedule');
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    key: 'title' | 'body' | 'b_title' | 'b_body',
    max: number,
    multiline = false,
  ) => (
    <label className="block">
      <span className={`${cu.fieldLabel} flex justify-between`}>
        <span>{label}</span>
        <span className={value.length > max ? 'text-red-600' : ''}>
          {value.length}/{max}
        </span>
      </span>
      {multiline ? (
        <textarea
          className={`${cu.input} min-h-[96px]`}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => (lastField.current = { field: key, el: e.currentTarget })}
          onSelect={(e) => (lastField.current = { field: key, el: e.currentTarget })}
          placeholder="Get 20% off all orders above Rs. 1,500 tonight!"
        />
      ) : (
        <input
          className={cu.input}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => (lastField.current = { field: key, el: e.currentTarget })}
          onSelect={(e) => (lastField.current = { field: key, el: e.currentTarget })}
          placeholder="Special weekend deal! 🍕"
        />
      )}
    </label>
  );

  return (
    <div className={cu.page}>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/admin/push-notifications" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800" aria-label="Back">
          <MdArrowBack size={20} />
        </Link>
        <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-900/30">
          <MdOutlineCampaign size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className={`text-[22px] font-extrabold tracking-tight ${cu.strong}`}>
            {editId ? 'Edit notification' : 'New push notification'}
          </h1>
          <p className={`text-[13px] ${cu.muted}`}>To customers who have the app. Tapping it opens the app.</p>
        </div>
        {!editId && (
          <div className="flex flex-wrap gap-2">
            {templates.length > 0 && (
              <select
                className={inputInline}
                value=""
                onChange={(e) => {
                  const t = templates.find((x) => x.id === Number(e.target.value));
                  if (t) set({ title: t.title, body: t.body, image_url: t.imageUrl ?? '' });
                }}
                aria-label="Start from a template"
              >
                <option value="">Start from a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className={inputInline}
              value=""
              onChange={(e) => e.target.value && setF(applyPreset(f, e.target.value, meta))}
              aria-label="Ready-made automation"
            >
              <option value="">Ready-made automation…</option>
              {AUTOMATION_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!meta.firebase_configured && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Firebase is not set up on this server, so nothing can actually be sent from here.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          {/* 1. Message */}
          <section className={card}>
            <h2 className={h2}>1 · The message</h2>
            <div className="space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={cu.fieldLabel}>Name (for you; customers don't see it)</span>
                  <input className={cu.input} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Weekend deal – Oct" />
                </label>
                <label>
                  <span className={cu.fieldLabel}>Brand</span>
                  <select
                    className={cu.input}
                    value={f.brand_id ?? ''}
                    disabled={meta.brand_locked && meta.options.brands.length === 1}
                    onChange={(e) => set({ brand_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    {!meta.brand_locked && <option value="">All brands / Foodies</option>}
                    {meta.options.brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {field('Title', f.title, (v) => set({ title: v }), 'title', meta.limits.title)}
              {field('Message', f.body, (v) => set({ body: v }), 'body', meta.limits.body, true)}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-[12px] ${cu.muted}`}>Personal touch:</span>
                {tokens.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => insertToken(t.key)}
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-600 hover:border-red-300 hover:text-red-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    title={`Inserts {${t.key}} — e.g. "${t.example}". Add a fallback with a bar: {${t.key}|there}`}
                  >
                    + {t.label}
                  </button>
                ))}
              </div>
              <div>
                <span className={cu.fieldLabel}>Image (optional · Android only)</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${cu.input} min-w-[220px] flex-1`}
                    value={f.image_url}
                    onChange={(e) => set({ image_url: e.target.value })}
                    placeholder="https://…"
                    aria-label="Image link"
                  />
                  <label className={`${cu.btnOutline} inline-flex cursor-pointer items-center gap-1.5`}>
                    <MdOutlineImage size={16} />
                    {uploading ? 'Uploading…' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadImage(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {f.image_url && (
                    <button type="button" className="text-[12.5px] font-semibold text-red-600 hover:underline" onClick={() => set({ image_url: '' })}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 2. Audience */}
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className={`text-[15.5px] font-bold ${cu.strong}`}>2 · Who gets it</h2>
              <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-slate-700" role="radiogroup" aria-label="Audience source">
                {(['build', 'saved'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={f.audience_mode === m}
                    onClick={() => set({ audience_mode: m })}
                    className={`rounded-md px-3 py-1 text-[12.5px] font-bold ${f.audience_mode === m ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}
                  >
                    {m === 'build' ? 'Build an audience' : 'Use a saved one'}
                  </button>
                ))}
              </div>
            </div>

            {f.audience_mode === 'build' ? (
              <AudienceBuilder meta={meta} value={f.audience} onChange={(a) => set({ audience: a })} />
            ) : (
              <div className="space-y-2">
                <select
                  className={cu.input}
                  value={f.audience_id ?? ''}
                  onChange={(e) => set({ audience_id: e.target.value ? Number(e.target.value) : null })}
                  aria-label="Saved audience"
                >
                  <option value="">Pick a saved audience…</option>
                  {savedAudiences.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {selectedSaved && <p className={`text-[12.5px] ${cu.soft}`}>{audienceSummary(selectedSaved.rules, meta)}</p>}
                <p className={`text-[11.5px] ${cu.muted}`}>Every send reads the audience's current rules, so editing it updates this notification too.</p>
              </div>
            )}

            <div className="mt-4 space-y-2.5 border-t border-gray-100 pt-4 dark:border-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className={`text-[13px] ${cu.text}`}>Leave out customers with an order in progress</span>
                <SegToggle on={f.skip_order_in_progress} onChange={(v) => set({ skip_order_in_progress: v })} ariaLabel="Leave out customers with an order in progress" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-[13px] ${cu.text}`}>
                  Respect the limit per customer
                  <span className={`ml-1 ${cu.muted}`}>
                    ({meta.settings.cap_per_day ?? '∞'} a day, {meta.settings.cap_per_week ?? '∞'} a week)
                  </span>
                </span>
                <SegToggle on={f.respect_cap} onChange={(v) => set({ respect_cap: v })} ariaLabel="Respect the limit per customer" />
              </div>
            </div>

            <div className="mt-4">
              <AudienceCounts
                meta={meta}
                audience={f.audience_mode === 'build' ? f.audience : undefined}
                audienceId={f.audience_mode === 'saved' ? f.audience_id : null}
                skipOrderInProgress={f.skip_order_in_progress}
                respectCap={f.respect_cap}
              />
              {f.audience_mode === 'build' && (f.audience.include.length > 0 || f.audience.exclude.length > 0) && (
                <button type="button" className="mt-2 text-[12.5px] font-semibold text-red-600 hover:underline dark:text-red-400" onClick={() => setSaveAudienceOpen(true)}>
                  Save this audience for later
                </button>
              )}
            </div>
          </section>

          {/* 3. When */}
          <section className={card}>
            <h2 className={h2}>3 · When</h2>
            <SchedulePicker
              value={f.schedule}
              onChange={(s) => set({ schedule: s.schedule_type === 'repeat' && !s.repeat ? { ...s, repeat: defaultRepeat(meta.settings.timezone) } : s })}
              settings={meta.settings}
              runsCount={existing?.message.runs_count ?? 0}
              skipDates={existing?.message.skip_dates ?? []}
            />
          </section>

          {/* 4. Options */}
          <section className={card}>
            <h2 className={h2}>4 · More options</h2>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={cu.fieldLabel}>Expires after</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={672}
                      className={`${cu.input} max-w-[110px]`}
                      value={f.expiry_hours}
                      onChange={(e) => set({ expiry_hours: Number(e.target.value) })}
                    />
                    <span className={`text-[12.5px] ${cu.muted}`}>hours</span>
                  </div>
                  <span className={`mt-1 block text-[11.5px] ${cu.muted}`}>A phone that was off longer than this never shows it — no stale lunch deals at midnight.</span>
                </label>
                <div className="flex items-start justify-between gap-3 pt-5">
                  <span className={`text-[13px] ${cu.text}`}>
                    Replace my previous promo
                    <span className={`block text-[11.5px] ${cu.muted}`}>A newer promo takes the older one's place in the phone's list instead of piling up.</span>
                  </span>
                  <SegToggle on={f.replace_previous} onChange={(v) => set({ replace_previous: v })} ariaLabel="Replace my previous promo" />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-3.5 dark:border-slate-700">
                <div className="flex items-start justify-between gap-3">
                  <span className={`text-[13px] font-semibold ${cu.text}`}>
                    A/B test — try two versions
                    <span className={`block text-[11.5px] font-normal ${cu.muted}`}>Part of the audience gets version B; the results compare the orders each version brought in.</span>
                  </span>
                  <SegToggle on={f.ab_on} onChange={(v) => set({ ab_on: v })} ariaLabel="A/B test" />
                </div>
                {f.ab_on && (
                  <div className="mt-3 space-y-3">
                    {field('Version B title', f.variant_b.title, (v) => set({ variant_b: { ...f.variant_b, title: v } }), 'b_title', meta.limits.title)}
                    {field('Version B message', f.variant_b.body, (v) => set({ variant_b: { ...f.variant_b, body: v } }), 'b_body', meta.limits.body, true)}
                    <label className="block">
                      <span className={cu.fieldLabel}>Share that gets version B: {f.ab_split}%</span>
                      <input type="range" min={10} max={90} step={5} value={f.ab_split} onChange={(e) => set({ ab_split: Number(e.target.value) })} className="w-full accent-red-600" />
                    </label>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 p-3.5 dark:border-slate-700">
                <span className={`text-[13px] font-semibold ${cu.text}`}>Hold back to measure: {f.holdout_percent}%</span>
                <span className={`block text-[11.5px] ${cu.muted}`}>
                  This share of the audience is picked at random and not sent it, so the results can show the orders the notification really added.
                </span>
                <input type="range" min={0} max={50} step={5} value={f.holdout_percent} onChange={(e) => set({ holdout_percent: Number(e.target.value) })} className="mt-2 w-full accent-red-600" aria-label="Hold back" />
              </div>
            </div>
          </section>
        </div>

        {/* Right: preview + actions */}
        <aside className="min-w-0">
          <div className="space-y-4 lg:sticky lg:top-4">
            <section className={card}>
              <h2 className={h2}>Preview</h2>
              <PhonePreview title={f.title} body={f.body} imageUrl={f.image_url || null} tokens={tokens} caption={f.ab_on ? 'Version A' : undefined} />
              {f.ab_on && (
                <div className="mt-4">
                  <PhonePreview title={f.variant_b.title} body={f.variant_b.body} imageUrl={f.image_url || null} tokens={tokens} caption="Version B" />
                </div>
              )}
            </section>

            <section className={card}>
              <dl className="space-y-2 text-[12.5px]">
                <div>
                  <dt className={cu.fieldLabel}>Audience</dt>
                  <dd className={cu.text}>{audienceForSummary ? audienceSummary(audienceForSummary, meta) : 'Pick a saved audience'}</dd>
                </div>
                <div>
                  <dt className={cu.fieldLabel}>When</dt>
                  <dd className={cu.text}>{describeSchedule(f.schedule)}</dd>
                  {f.schedule.schedule_type === 'repeat' && (
                    <dd className={cu.muted}>{perCustomerText(f.schedule.per_customer, f.schedule.per_customer_days)}</dd>
                  )}
                </div>
              </dl>

              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => void confirmAndSend()}
                  disabled={saveMutation.isPending}
                  className={`${cu.btnPrimary} flex w-full items-center justify-center gap-2 disabled:opacity-60`}
                >
                  <MdSend size={16} />
                  {saveMutation.isPending ? 'Saving…' : primaryLabel}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={cu.btnOutline} onClick={() => saveMutation.mutate('draft')} disabled={saveMutation.isPending}>
                    Save draft
                  </button>
                  <button
                    type="button"
                    className={cu.btnOutline}
                    onClick={() => testMutation.mutate()}
                    disabled={testMutation.isPending}
                    title={meta.settings.test_phones.length ? `Sends to ${meta.settings.test_phones.join(', ')}` : 'Add test phones in Settings first'}
                  >
                    {testMutation.isPending ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                {meta.settings.test_phones.length === 0 && (
                  <p className={`text-[11.5px] ${cu.muted}`}>
                    Add your own phone under <Link to="/admin/push-notifications?tab=settings" className="font-semibold text-red-600 hover:underline">Settings → Test phones</Link> to try a message first.
                  </p>
                )}
                {testResults && (
                  <ul className="space-y-1 rounded-lg bg-gray-50 p-2.5 text-[12px] dark:bg-slate-900/40" data-testid="test-results">
                    {testResults.map((r) => (
                      <li key={r.phone} className={r.sent > 0 ? cu.good : cu.warn}>
                        {r.phone}
                        {r.customer?.name ? ` (${r.customer.name})` : ''}: {r.sent > 0 ? `reached ${r.sent} phone${r.sent === 1 ? '' : 's'}` : (r.error ?? 'not sent')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>

      <Modal isOpen={saveAudienceOpen} onClose={() => setSaveAudienceOpen(false)} title="Save this audience" size="small">
        <div className="space-y-3">
          <p className={`text-[12.5px] ${cu.soft}`}>{audienceSummary(f.audience, meta)}</p>
          <input className={cu.input} value={audienceName} onChange={(e) => setAudienceName(e.target.value)} placeholder="e.g. Lapsed Wok & Go regulars" autoFocus />
          <div className="flex justify-end gap-2">
            <button type="button" className={cu.btnOutline} onClick={() => setSaveAudienceOpen(false)}>
              Cancel
            </button>
            <button type="button" className={cu.btnPrimary} disabled={!audienceName.trim() || saveAudienceMutation.isPending} onClick={() => saveAudienceMutation.mutate()}>
              Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PushComposer;
