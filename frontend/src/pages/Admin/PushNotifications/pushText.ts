/**
 * How the Push Notifications pages put things into words: statuses, schedules
 * ("Every Friday at 7:00 PM"), audiences ("Ordered from Wok & Go · no order in
 * 30 days") and the ready-made automations.
 */
import type {
  PushAudienceRule,
  PushAudienceSpec,
  PushMessageStatus,
  PushMeta,
  PushPerCustomer,
  PushRepeatRule,
  PushRuleDef,
  PushRuleGroup,
  PushScheduleType,
  PushSkipReason,
} from '../../../types';
import { formatOrderType } from '../../../utils/format';
import { orderSourceLabel } from '../../../utils/orderSources';
import { formatPoints } from '../../../utils/customerDisplay';

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const STATUS_META: Record<PushMessageStatus, { label: string; pill: string }> = {
  draft: { label: 'Draft', pill: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300' },
  scheduled: { label: 'Scheduled', pill: 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  active: { label: 'Repeating', pill: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  paused: { label: 'Paused', pill: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  sending: { label: 'Sending…', pill: 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  sent: { label: 'Sent', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  completed: { label: 'Finished', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  cancelled: { label: 'Cancelled', pill: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400' },
  failed: { label: 'Failed', pill: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

export const GROUP_LABEL: Record<PushRuleGroup, string> = {
  who: 'Who',
  where: 'Where they order',
  when: 'When',
  how_much: 'How much',
  what: 'What they order',
  loyalty: 'Loyalty',
  cart: 'Cart',
  phone: 'Phone',
};

export const SKIP_LABEL: Record<PushSkipReason, string> = {
  no_app: 'not on the app',
  rider: 'id shared with a rider',
  opt_out: 'asked to stop',
  repeat: 'already got this one',
  in_progress: 'order in progress',
  cap: 'reached the limit',
};

export const PLATFORM_LABEL: Record<string, string> = { android: 'Android', ios: 'iPhone' };

/** "7:00 PM" from "19:00". */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "24 Oct" (or "24 Oct 2027" outside the current year) from "2026-10-24". */
export function shortDate(ymd: string, now: Date = new Date()): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const base = `${d} ${MONTHS[m - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

/** "Fri 24 Oct, 7:00 PM" for a moment the server read on the business clock. */
export function momentLabel(m: { local_date: string; local_time: string; weekday: number }, now?: Date): string {
  return `${WEEKDAYS_SHORT[m.weekday]} ${shortDate(m.local_date, now)}, ${time12(m.local_time)}`;
}

/** A browser-local instant as "Fri 24 Oct, 7:00 PM". */
export function instantLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return momentLabel({ local_date: ymd, local_time: hm, weekday: d.getDay() }, now);
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function sameDays(a: number[] | undefined, b: number[]): boolean {
  const x = [...(a ?? [])].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export const WEEKDAY_SET = [1, 2, 3, 4, 5];
export const WEEKEND_SET = [6, 0];

/** "Every Friday at 7:00 PM, from 24 Oct until 31 Dec" */
export function describeRepeat(rule: PushRepeatRule, now?: Date): string {
  const at = `at ${time12(rule.time)}`;
  let head: string;
  switch (rule.frequency) {
    case 'daily':
      head = `Every day ${at}`;
      break;
    case 'weekly': {
      const days = rule.weekdays ?? [];
      if (sameDays(days, WEEKDAY_SET)) head = `Every weekday (Mon–Fri) ${at}`;
      else if (sameDays(days, WEEKEND_SET)) head = `Every weekend day (Sat–Sun) ${at}`;
      else if (days.length === 7) head = `Every day ${at}`;
      else {
        const names = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS_LONG[d]);
        const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
        head = `Every ${list} ${at}`;
      }
      break;
    }
    case 'monthly':
      head =
        rule.month_day === -1
          ? `On the last day of every month ${at}`
          : `On the ${ordinal(rule.month_day ?? 1)} of every month ${at}`;
      break;
    case 'every_n_days':
      head = `Every ${rule.interval_days ?? 2} days ${at}`;
      break;
    default:
      head = 'Repeats';
  }
  const parts = [head];
  const today = now ?? new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (rule.starts_on > todayKey) parts.push(`from ${shortDate(rule.starts_on, now)}`);
  if (rule.ends === 'on' && rule.ends_on) parts.push(`until ${shortDate(rule.ends_on, now)}`);
  if (rule.ends === 'after' && rule.max_runs) parts.push(`${rule.max_runs} time${rule.max_runs === 1 ? '' : 's'} in all`);
  return parts.join(', ');
}

export function describeSchedule(
  m: { schedule_type: PushScheduleType; send_at: string | null; repeat: PushRepeatRule | null },
  now?: Date,
): string {
  if (m.schedule_type === 'repeat' && m.repeat) return describeRepeat(m.repeat, now);
  if (m.schedule_type === 'once' && m.send_at) return `Once, ${instantLabel(m.send_at, now)}`;
  return 'Sent straight away';
}

export function perCustomerText(mode: PushPerCustomer, days: number | null | undefined): string {
  if (mode === 'once') return 'Each customer gets it only once, ever';
  if (mode === 'days') return `Each customer gets it at most once every ${days ?? '?'} day${days === 1 ? '' : 's'}`;
  return 'Each customer gets every send';
}

function names(ids: unknown, list: Array<{ id: number; name: string }>): string {
  const arr = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
  const picked = arr.map((id) => list.find((o) => o.id === Number(id))?.name ?? `#${String(id)}`);
  if (picked.length <= 2) return picked.join(' or ');
  return `${picked.slice(0, 2).join(', ')} or ${picked.length - 2} more`;
}

function within(p: Record<string, unknown>): string {
  return p.within_days != null ? ` in the last ${String(p.within_days)} days` : '';
}

/** One rule as a short phrase. */
export function ruleSummary(r: PushAudienceRule, meta: PushMeta | undefined): string {
  const p = r.params ?? {};
  const o = meta?.options;
  switch (r.rule) {
    case 'phone':
      return `Phone ${String(p.phone ?? '').replace(/^(\d{3})/, '0$1')}`;
    case 'phone_list':
      return `${Array.isArray(p.phones) ? p.phones.length : 0} pasted phone numbers`;
    case 'got_message': {
      const msg = o?.messages.find((m) => m.id === Number(p.message_id));
      const base = `Got “${msg?.label ?? `#${String(p.message_id)}`}”`;
      return p.no_order_within_days != null ? `${base} and did not order within ${String(p.no_order_within_days)} days` : base;
    }
    case 'ordered_from_brand':
      return `Ordered from ${names(p.brand_ids, o?.brands ?? [])}${within(p)}`;
    case 'ordered_at_branch':
      return `Ordered at ${names(p.branch_ids, o?.branches ?? [])}${within(p)}`;
    case 'near_branch':
      return `Lives within ${String(p.km)} km of ${names(p.branch_id, o?.branches ?? [])}`;
    case 'ordered_recently':
      return `Ordered in the last ${String(p.days)} days`;
    case 'lapsed':
      return `No order in ${String(p.days)} days`;
    case 'never_ordered':
      return 'Signed up, never ordered';
    case 'joined':
      return Number(p.from_days) === 0
        ? `Joined in the last ${String(p.to_days)} day${Number(p.to_days) === 1 ? '' : 's'}`
        : `Joined ${String(p.from_days)}–${String(p.to_days)} days ago`;
    case 'min_orders':
      return `${String(p.count)}+ orders${within(p)}`;
    case 'min_spend':
      return `Spent Rs ${formatPoints(Number(p.amount))}+${within(p)}`;
    case 'ordered_item':
      return `Ordered ${names(p.item_ids, o?.items ?? [])}${within(p)}`;
    case 'ordered_category':
      return `Ordered from ${names(p.category_ids, o?.categories ?? [])}${within(p)}`;
    case 'mostly_order_type':
      return `Usually orders ${(Array.isArray(p.order_types) ? p.order_types : []).map((t) => formatOrderType(String(t)).toLowerCase()).join(' or ')}`;
    case 'ordered_via':
      return `Ordered through ${(Array.isArray(p.sources) ? p.sources : []).map((s) => orderSourceLabel(String(s))).join(' or ')}${within(p)}`;
    case 'app_points':
      return `${formatPoints(Number(p.points))}+ app points`;
    case 'abandoned_cart':
      return `Left items in the cart (last ${String(p.within_hours)} h)`;
    case 'platform':
      return `${PLATFORM_LABEL[String(p.platform)] ?? String(p.platform)} users`;
    default: {
      const def = meta?.rules.find((d: PushRuleDef) => d.key === r.rule);
      return def?.label ?? r.rule;
    }
  }
}

/** "Everyone with the app" or the rules joined with "and" / "or", then "but not …". */
export function audienceSummary(a: PushAudienceSpec | null | undefined, meta: PushMeta | undefined): string {
  if (!a || (a.include.length === 0 && a.exclude.length === 0)) return 'Everyone with the app';
  const inc = a.include.map((r) => ruleSummary(r, meta));
  const head = inc.length ? inc.join(a.match === 'any' ? ' or ' : ' · ') : 'Everyone with the app';
  const exc = a.exclude.map((r) => ruleSummary(r, meta));
  return exc.length ? `${head} — but not: ${exc.join(', ')}` : head;
}

/** Default params for a freshly added rule (defaults from the server's definition). */
export function defaultParams(def: PushRuleDef): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const pd of def.params) {
    if (pd.default != null) p[pd.name] = pd.default;
    else if (pd.type === 'platform') p[pd.name] = 'android';
    else if (pd.type === 'order_types') p[pd.name] = ['delivery'];
    else if (pd.type === 'sources') p[pd.name] = ['consumer_app'];
  }
  return p;
}

/** Text with the placeholders filled with example values, for the previews. */
export function sampleText(text: string, tokens: Array<{ key: string; example: string }>): string {
  return text
    .replace(/\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}/g, (whole, key: string) => {
      const t = tokens.find((x) => x.key === key);
      return t ? t.example : whole;
    })
    .replace(/[ \t]{2,}/g, ' ');
}

export function percent(part: number, whole: number): string {
  if (!whole) return '0%';
  const v = (part / whole) * 100;
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`;
}

export interface AutomationPreset {
  key: string;
  label: string;
  description: string;
  title: string;
  body: string;
  audience: PushAudienceSpec;
  repeat: Omit<PushRepeatRule, 'starts_on'>;
  per_customer: PushPerCustomer;
  per_customer_days?: number;
}

/** One click fills the whole composer; everything stays editable. */
export const AUTOMATION_PRESETS: AutomationPreset[] = [
  {
    key: 'welcome',
    label: 'Welcome new customers',
    description: 'Every evening, to everyone who joined that day — once each.',
    title: 'Welcome to Foodies, {first_name|there}! 👋',
    body: 'Your favourite food is a few taps away. Browse the menu and place your first order tonight.',
    audience: { match: 'all', include: [{ rule: 'joined', params: { from_days: 0, to_days: 1 } }], exclude: [] },
    repeat: { frequency: 'daily', time: '19:00', ends: 'never' },
    per_customer: 'once',
  },
  {
    key: 'first_order',
    label: 'First-order nudge',
    description: 'Signed up 3 days ago and still has not ordered — once each.',
    title: 'Still hungry, {first_name|there}? 🍕',
    body: 'You signed up but have not ordered yet. Your first meal is waiting — order in a few taps.',
    audience: {
      match: 'all',
      include: [
        { rule: 'joined', params: { from_days: 3, to_days: 4 } },
        { rule: 'never_ordered', params: {} },
      ],
      exclude: [],
    },
    repeat: { frequency: 'daily', time: '18:00', ends: 'never' },
    per_customer: 'once',
  },
  {
    key: 'win_back',
    label: 'Win back lapsed customers',
    description: 'No order in 30 days — at most once a month each.',
    title: 'We miss you, {first_name|there}!',
    body: 'It has been a while. Come back for your favourite — {last_brand|we} would love to cook for you again.',
    audience: { match: 'all', include: [{ rule: 'lapsed', params: { days: 30 } }], exclude: [] },
    repeat: { frequency: 'daily', time: '17:00', ends: 'never' },
    per_customer: 'days',
    per_customer_days: 30,
  },
  {
    key: 'points',
    label: 'Points reminder',
    description: '500+ app points — every Thursday, at most once a fortnight each.',
    title: 'You have {app_points} points to spend 🎁',
    body: 'Use your Foodies points on your next app order before the weekend.',
    audience: { match: 'all', include: [{ rule: 'app_points', params: { points: 500 } }], exclude: [] },
    repeat: { frequency: 'weekly', weekdays: [4], time: '18:00', ends: 'never' },
    per_customer: 'days',
    per_customer_days: 14,
  },
  {
    key: 'weekend',
    label: 'Weekend promo',
    description: 'Every Friday at 6 PM, to everyone with the app.',
    title: 'Weekend deals are live! 🎉',
    body: 'Treat yourself this weekend — fresh deals on your favourites, tonight only.',
    audience: { match: 'all', include: [], exclude: [] },
    repeat: { frequency: 'weekly', weekdays: [5], time: '18:00', ends: 'never' },
    per_customer: 'every',
  },
];

/** Title / body lengths beyond which phones start cutting the text off. */
export const VISIBLE_TITLE = 50;
export const VISIBLE_BODY = 110;
