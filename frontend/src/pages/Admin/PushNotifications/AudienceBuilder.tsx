import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdAdd, MdClose, MdPeopleOutline } from 'react-icons/md';
import type {
  PushAudienceCounts,
  PushAudienceRule,
  PushAudienceSpec,
  PushMeta,
  PushPerCustomer,
  PushRuleDef,
  PushRuleGroup,
  PushRuleParam,
} from '../../../types';
import { pushService } from '../../../services/api';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import SearchableMultiSelect from '../../../components/SearchableMultiSelect';
import SearchableSelect from '../../../components/SearchableSelect';
import { formatOrderType } from '../../../utils/format';
import { orderSourceLabel } from '../../../utils/orderSources';
import { formatPhone } from '../../../utils/customerDisplay';
import { cu } from '../customersUi';
import { defaultParams, GROUP_LABEL, PLATFORM_LABEL, SKIP_LABEL } from './pushText';

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
    on
      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
  }`;

/** Saved phones are their last 10 digits ("3001234567"); show them as dialled. */
const withZero = (v: string) => (/^3\d{9}$/.test(v) ? `0${v}` : v);

const GROUP_ORDER: PushRuleGroup[] = ['who', 'where', 'when', 'how_much', 'what', 'loyalty', 'cart', 'phone'];

/** Every required input of every rule filled in? (Until then there is nothing to count.) */
export function audienceComplete(a: PushAudienceSpec | undefined, meta: PushMeta | undefined): boolean {
  if (!a || !meta) return true;
  return [...a.include, ...a.exclude].every((r) => {
    const def = meta.rules.find((d) => d.key === r.rule);
    if (!def) return true;
    return def.params.every((pd) => {
      if (!pd.required) return true;
      const v = r.params?.[pd.name];
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim() !== '';
      return v != null;
    });
  });
}

// ———————————————————————————————————————————————————————————————————————————
// One input for one rule parameter, chosen by its type
// ———————————————————————————————————————————————————————————————————————————

const ParamInput: React.FC<{
  def: PushRuleParam;
  value: unknown;
  meta: PushMeta;
  onChange: (v: unknown) => void;
}> = ({ def, value, meta, onChange }) => {
  const ids = (Array.isArray(value) ? value : value == null ? [] : [value]).map(Number);
  const o = meta.options;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  switch (def.type) {
    case 'brands':
      return <SearchableMultiSelect options={o.brands} selectedIds={ids} onChange={onChange} placeholder="Pick brands" />;
    case 'branches':
      return <SearchableMultiSelect options={o.branches} selectedIds={ids} onChange={onChange} placeholder="Pick branches" />;
    case 'categories':
      return (
        <SearchableMultiSelect
          options={o.categories}
          selectedIds={ids}
          onChange={onChange}
          placeholder="Pick categories"
          getOptionLabel={(opt) => {
            const c = o.categories.find((x) => x.id === opt.id);
            return c?.brand_name ? `${opt.name} · ${c.brand_name}` : opt.name;
          }}
        />
      );
    case 'items':
      return (
        <SearchableMultiSelect
          options={o.items}
          selectedIds={ids}
          onChange={onChange}
          placeholder="Search menu items"
          getOptionLabel={(opt) => {
            const c = o.items.find((x) => x.id === opt.id);
            return c?.brand_name ? `${opt.name} · ${c.brand_name}` : opt.name;
          }}
        />
      );
    case 'branch':
      return (
        <SearchableSelect
          value={value != null ? String(value) : ''}
          onChange={(v) => onChange(v ? Number(v) : null)}
          options={o.branches.map((b) => ({
            value: String(b.id),
            label: b.has_location ? b.name : `${b.name} (no map pin)`,
            disabled: !b.has_location,
          }))}
          placeholder="Pick a branch"
          ariaLabel={def.label}
        />
      );
    case 'message':
      return (
        <SearchableSelect
          value={value != null ? String(value) : ''}
          onChange={(v) => onChange(v ? Number(v) : null)}
          options={o.messages.map((m) => ({ value: String(m.id), label: m.label }))}
          placeholder={o.messages.length ? 'Pick a notification' : 'No notification has been sent yet'}
          ariaLabel={def.label}
        />
      );
    case 'order_types': {
      const list = (Array.isArray(value) ? value : []).map(String);
      return (
        <div className="flex flex-wrap gap-1.5">
          {o.order_types.map((t) => (
            <button key={t} type="button" className={chip(list.includes(t))} onClick={() => onChange(toggle(list, t))}>
              {formatOrderType(t)}
            </button>
          ))}
        </div>
      );
    }
    case 'sources': {
      const list = (Array.isArray(value) ? value : []).map(String);
      return (
        <div className="flex flex-wrap gap-1.5">
          {o.sources.map((s) => (
            <button key={s} type="button" className={chip(list.includes(s))} onClick={() => onChange(toggle(list, s))}>
              {orderSourceLabel(s)}
            </button>
          ))}
        </div>
      );
    }
    case 'platform':
      return (
        <div className="flex gap-1.5">
          {o.platforms.map((p) => (
            <button key={p} type="button" className={chip(value === p)} onClick={() => onChange(p)}>
              {PLATFORM_LABEL[p] ?? p}
            </button>
          ))}
        </div>
      );
    case 'phone':
      return (
        <input
          className={cu.input}
          inputMode="tel"
          placeholder="0300 1234567"
          value={typeof value === 'string' ? withZero(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={def.label}
        />
      );
    case 'phones':
      return (
        <textarea
          className={`${cu.input} min-h-[90px] font-mono text-[12.5px]`}
          placeholder={'03001234567\n03211234567'}
          value={Array.isArray(value) ? value.map((v) => withZero(String(v))).join('\n') : typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={def.label}
        />
      );
    case 'int':
    case 'money':
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={`${cu.input} max-w-[140px]`}
            min={def.min}
            max={def.max}
            value={value == null ? '' : String(value)}
            placeholder={def.required ? '' : 'any time'}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            aria-label={def.label}
          />
          {def.suffix && <span className={`text-[12.5px] ${cu.muted}`}>{def.suffix}</span>}
        </div>
      );
    default:
      return null;
  }
};

// ———————————————————————————————————————————————————————————————————————————
// One rule row
// ———————————————————————————————————————————————————————————————————————————

const RuleRow: React.FC<{
  rule: PushAudienceRule;
  def: PushRuleDef | undefined;
  meta: PushMeta;
  onChange: (r: PushAudienceRule) => void;
  onRemove: () => void;
  joiner: string | null;
}> = ({ rule, def, meta, onChange, onRemove, joiner }) => (
  <div>
    {joiner && (
      <div className="my-1.5 pl-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">{joiner}</div>
    )}
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/30" data-testid={`rule-${rule.rule}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[13.5px] font-bold ${cu.strong}`}>{def?.label ?? rule.rule}</p>
          {def?.description && <p className={`text-[12px] leading-snug ${cu.muted}`}>{def.description}</p>}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${def?.label ?? rule.rule}`}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-slate-700"
        >
          <MdClose size={16} />
        </button>
      </div>
      {def && def.params.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {def.params.map((pd) => (
            <label key={pd.name} className={pd.type === 'phones' || pd.type === 'items' ? 'sm:col-span-2' : ''}>
              <span className={cu.fieldLabel}>
                {pd.label}
                {!pd.required && <span className="ml-1 font-normal normal-case tracking-normal">(optional)</span>}
              </span>
              <ParamInput
                def={pd}
                meta={meta}
                value={rule.params?.[pd.name]}
                onChange={(v) => onChange({ ...rule, params: { ...(rule.params ?? {}), [pd.name]: v } })}
              />
              {pd.hint && <span className={`mt-1 block text-[11.5px] ${cu.muted}`}>{pd.hint}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  </div>
);

// ———————————————————————————————————————————————————————————————————————————
// "+ Add a rule" menu, grouped
// ———————————————————————————————————————————————————————————————————————————

const AddRuleMenu: React.FC<{ meta: PushMeta; label: string; onPick: (def: PushRuleDef) => void }> = ({ meta, label, onPick }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const groups = GROUP_ORDER.map((g) => ({ g, rules: meta.rules.filter((r) => r.group === g) })).filter((x) => x.rules.length);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-gray-300 px-3 py-2 text-[13px] font-semibold text-gray-600 hover:border-red-300 hover:text-red-700 dark:border-slate-600 dark:text-slate-300"
      >
        <MdAdd size={16} />
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1.5 max-h-[60vh] w-[min(420px,calc(100vw-48px))] overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        >
          {groups.map(({ g, rules }) => (
            <div key={g} className="mb-1">
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">{GROUP_LABEL[g]}</p>
              {rules.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onPick(r);
                    setOpen(false);
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                  <span className={`block text-[13px] font-semibold ${cu.strong}`}>{r.label}</span>
                  <span className={`block text-[11.5px] leading-snug ${cu.muted}`}>{r.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ———————————————————————————————————————————————————————————————————————————
// The builder
// ———————————————————————————————————————————————————————————————————————————

interface BuilderProps {
  meta: PushMeta;
  value: PushAudienceSpec;
  onChange: (a: PushAudienceSpec) => void;
}

/** "Send to customers who match all/any of … but not …" with data-driven rule inputs. */
export const AudienceBuilder: React.FC<BuilderProps> = ({ meta, value, onChange }) => {
  const defOf = (key: string) => meta.rules.find((r) => r.key === key);
  const update = (part: 'include' | 'exclude', i: number, r: PushAudienceRule) =>
    onChange({ ...value, [part]: value[part].map((x, j) => (j === i ? r : x)) });
  const remove = (part: 'include' | 'exclude', i: number) =>
    onChange({ ...value, [part]: value[part].filter((_, j) => j !== i) });
  const add = (part: 'include' | 'exclude', def: PushRuleDef) =>
    onChange({ ...value, [part]: [...value[part], { rule: def.key, params: defaultParams(def) }] });

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`text-[13.5px] font-semibold ${cu.text}`}>Send to customers who match</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-slate-700" role="radiogroup" aria-label="Match">
            {(['all', 'any'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={value.match === m}
                onClick={() => onChange({ ...value, match: m })}
                className={`rounded-md px-3 py-1 text-[12.5px] font-bold ${value.match === m ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}
              >
                {m === 'all' ? 'all' : 'any'}
              </button>
            ))}
          </div>
          <span className={`text-[13.5px] font-semibold ${cu.text}`}>of these:</span>
        </div>
        {value.include.length === 0 ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-3 text-[13px] text-gray-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
            <MdPeopleOutline size={18} className="flex-none" />
            Everyone who has the app. Add a rule to narrow it down.
          </div>
        ) : (
          <div className="mb-2">
            {value.include.map((r, i) => (
              <RuleRow
                key={`inc-${i}`}
                rule={r}
                def={defOf(r.rule)}
                meta={meta}
                onChange={(nr) => update('include', i, nr)}
                onRemove={() => remove('include', i)}
                joiner={i === 0 ? null : value.match === 'all' ? 'and' : 'or'}
              />
            ))}
          </div>
        )}
        <AddRuleMenu meta={meta} label="Add a rule" onPick={(d) => add('include', d)} />
      </div>

      <div className="border-t border-gray-100 pt-4 dark:border-slate-700">
        <p className={`mb-2 text-[13.5px] font-semibold ${cu.text}`}>But leave out customers who:</p>
        {value.exclude.map((r, i) => (
          <RuleRow
            key={`exc-${i}`}
            rule={r}
            def={defOf(r.rule)}
            meta={meta}
            onChange={(nr) => update('exclude', i, nr)}
            onRemove={() => remove('exclude', i)}
            joiner={i === 0 ? null : 'or'}
          />
        ))}
        <div className={value.exclude.length ? 'mt-2' : ''}>
          <AddRuleMenu meta={meta} label="Leave some out" onPick={(d) => add('exclude', d)} />
        </div>
      </div>
    </div>
  );
};

// ———————————————————————————————————————————————————————————————————————————
// Live counts
// ———————————————————————————————————————————————————————————————————————————

interface CountsProps {
  /** Lets the counter wait until every rule is filled in. */
  meta?: PushMeta;
  audience?: PushAudienceSpec;
  audienceId?: number | null;
  skipOrderInProgress?: boolean;
  respectCap?: boolean;
  messageId?: number | null;
  perCustomer?: PushPerCustomer;
  perCustomerDays?: number | null;
  compact?: boolean;
}

/** "640 match → 214 have the app → 231 phones", refreshed as the audience changes. */
export const AudienceCounts: React.FC<CountsProps> = (props) => {
  const request = useMemo(
    () => ({
      audience: props.audienceId ? undefined : props.audience,
      audience_id: props.audienceId ?? null,
      skip_order_in_progress: props.skipOrderInProgress,
      respect_cap: props.respectCap,
      message_id: props.messageId ?? null,
      per_customer: props.perCustomer,
      per_customer_days: props.perCustomerDays ?? null,
    }),
    [props.audience, props.audienceId, props.skipOrderInProgress, props.respectCap, props.messageId, props.perCustomer, props.perCustomerDays],
  );
  const debounced = useDebouncedValue(JSON.stringify(request), 450);
  const [showSample, setShowSample] = useState(false);
  const complete = props.audienceId ? true : audienceComplete(props.audience, props.meta);
  const { data, isFetching, error } = useQuery<PushAudienceCounts>({
    queryKey: ['push-audience-preview', debounced],
    queryFn: () => pushService.previewAudience(JSON.parse(debounced) as Parameters<typeof pushService.previewAudience>[0]),
    placeholderData: (prev) => prev,
    retry: false,
    enabled: complete,
  });
  if (!complete) {
    return (
      <div className={`rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-[13px] dark:border-slate-700 dark:bg-slate-900/30 ${cu.muted}`} data-testid="audience-counts">
        Finish the rules above to see who gets it.
      </div>
    );
  }
  const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;
  if (error && message) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        {message}
      </div>
    );
  }
  const skips = data
    ? (Object.entries(data.skipped) as Array<[keyof typeof SKIP_LABEL, number]>).filter(([k, n]) => n > 0 && k !== 'no_app')
    : [];
  return (
    <div
      className={`rounded-xl border border-red-100 bg-red-50/50 px-3.5 py-3 dark:border-red-900/50 dark:bg-red-900/10 ${isFetching ? 'opacity-70' : ''}`}
      data-testid="audience-counts"
      aria-live="polite"
    >
      {!data ? (
        <p className={`text-[13px] ${cu.muted}`}>Counting…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
            <span>
              <b className={`text-[18px] font-black tabular-nums ${cu.strong}`}>{data.matched.toLocaleString('en-US')}</b>{' '}
              <span className={cu.muted}>match</span>
            </span>
            <span className={cu.faint}>→</span>
            <span>
              <b className={`text-[18px] font-black tabular-nums ${cu.strong}`}>{data.with_app.toLocaleString('en-US')}</b>{' '}
              <span className={cu.muted}>have the app</span>
            </span>
            <span className={cu.faint}>→</span>
            <span>
              <b className="text-[18px] font-black tabular-nums text-red-600 dark:text-red-400">{data.eligible.toLocaleString('en-US')}</b>{' '}
              <span className={cu.muted}>
                get it, on {data.phones.toLocaleString('en-US')} phone{data.phones === 1 ? '' : 's'}
              </span>
            </span>
          </div>
          {!props.compact && skips.length > 0 && (
            <p className={`mt-1 text-[12px] ${cu.muted}`}>
              Left out: {skips.map(([k, n]) => `${n.toLocaleString('en-US')} ${SKIP_LABEL[k]}`).join(' · ')}
            </p>
          )}
          {!props.compact && data.sample.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowSample((v) => !v)} className="text-[12px] font-semibold text-red-600 hover:underline dark:text-red-400">
                {showSample ? 'Hide' : 'See'} who {data.eligible > data.sample.length ? `(first ${data.sample.length})` : ''}
              </button>
              {showSample && (
                <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-2">
                  {data.sample.map((s) => (
                    <li key={s.id} className={`truncate ${cu.text}`}>
                      {s.name || 'No name'} <span className={cu.muted}>· {formatPhone(s.phone)}</span>
                      {s.phones > 1 && <span className={cu.muted}> · {s.phones} phones</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AudienceBuilder;
