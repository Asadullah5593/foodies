import type { ActivityLogRow } from '../../services/api/activityLogService';

/**
 * Turns an activity row into words.
 *
 * Done at display time, not at write time, on purpose: the table is append-only,
 * so a sentence stored with the row could never be improved — and every row
 * written before the wording existed would stay unreadable. Everything here is
 * derived from columns each row already carries.
 */

/**
 * The columns a sentence is built from. Looser than a full row so the shorter
 * "related" rows can be worded by the same function.
 */
export type Describable = Pick<ActivityLogRow, 'action' | 'outcome'> &
  Partial<
    Pick<
      ActivityLogRow,
      | 'action_group'
      | 'entity_type'
      | 'entity_id'
      | 'entity_label'
      | 'summary'
      | 'route'
      | 'http_method'
    >
  >;

const words = (value: string): string => value.replace(/[-_]+/g, ' ').trim();

const capitalise = (value: string): string =>
  value ? value[0].toUpperCase() + value.slice(1) : value;

/** Names that would read wrongly if merely capitalised. */
const SUBJECT_NAMES: Record<string, string> = {
  kot: 'kitchen ticket (KOT)',
  'z-report': 'Z-report',
  'shift-report': 'shift report',
  'inventory-ledger': 'stock ledger',
  'inventory-items': 'inventory list',
  'product-sales': 'product-wise sales',
  'activity-log': 'activity log',
  'rider-profiles': 'rider profiles',
};

const subjectName = (subject: string): string =>
  SUBJECT_NAMES[subject] ?? words(subject);

/** verb → [what happened, what was attempted] */
const VERBS: Record<string, [string, string]> = {
  view: ['Viewed', 'view'],
  create: ['Created', 'create'],
  update: ['Changed', 'change'],
  edit: ['Changed', 'change'],
  manage: ['Changed', 'change'],
  delete: ['Deleted', 'delete'],
  open: ['Opened', 'open'],
  close: ['Closed', 'close'],
  void: ['Voided', 'void'],
  refund: ['Refunded', 'refund'],
  cancel: ['Cancelled', 'cancel'],
  pay: ['Took payment for', 'take payment for'],
  status: ['Changed the status of', 'change the status of'],
  'cash-out': ['Recorded a cash-out on', 'record a cash-out on'],
  override: ['Overrode', 'override'],
  'update-status': ['Changed the status of', 'change the status of'],
  'assign-rider': ['Assigned a rider to', 'assign a rider to'],
};

export const OUTCOME_LABELS: Record<string, string> = {
  success: 'Succeeded',
  denied: 'Refused',
  failed: 'Failed',
  error: 'Server error',
};

export const OUTCOME_HINTS: Record<string, string> = {
  success: 'The action went through',
  denied: 'Not signed in, or not permitted to do this',
  failed: 'Rejected — invalid or incomplete request',
  error: 'Something broke on the server',
};

export const outcomeLabel = (outcome: string): string =>
  OUTCOME_LABELS[outcome] ?? capitalise(outcome);

const AREA_LABELS: Record<string, string> = {
  access: 'Users & roles',
  auth: 'Sign-ins',
  menu: 'Menu',
  offers: 'Discounts & offers',
  shifts: 'Shifts & cash',
  inventory: 'Inventory',
  orders: 'Orders',
  reports: 'Reports',
  audit: 'Activity log',
  client: 'Prints, exports & screens',
  other: 'Other',
};

/** `menu_item` → `Menu item` */
export const recordTypeLabel = (type: string): string => capitalise(words(type));

export const areaLabel = (group: string | null | undefined): string =>
  group ? (AREA_LABELS[group] ?? capitalise(words(group))) : '—';

const ACTOR_TYPE_LABELS: Record<string, string> = {
  staff: 'Staff',
  rider: 'Rider',
  customer: 'Customer',
  kiosk: 'Kiosk',
  anonymous: 'Not signed in',
  system: 'System',
};

export const actorTypeLabel = (type: string): string =>
  ACTOR_TYPE_LABELS[type] ?? capitalise(type);

/** `/admin/reports/sales-summary` → `sales summary`; null for the bare path. */
const reportName = (route: string | null | undefined): string | null => {
  const match = /\/reports\/([a-z][a-z0-9-]*)/i.exec(route ?? '');
  return match ? words(match[1]) : null;
};

/** A read — folded together when several land at once. A change never is. */
export const isRead = (row: ActivityLogRow): boolean =>
  row.http_method === 'GET' || row.action === 'client.page-view';

/** True when the row names one specific record rather than a whole list. */
export const hasRecord = (row: Describable): boolean =>
  row.action_group !== 'client' &&
  (row.entity_label != null || row.entity_id != null);

const clientSentence = (row: Describable): string | null => {
  const subject = subjectName(row.entity_type ?? 'screen');
  const record = row.entity_label
    ? ` "${row.entity_label}"`
    : row.entity_id
      ? ` #${row.entity_id}`
      : '';
  const automatic = /automatic/i.test(row.summary ?? '');
  switch (row.action) {
    case 'client.page-view':
      return `Opened the ${capitalise(subject)} screen`;
    case 'client.print':
      return `${automatic ? 'Auto-printed' : 'Printed'} ${subject}${record}`;
    case 'client.export':
      return `Exported ${subject}${record} to a file`;
    default:
      return null;
  }
};

const authSentence = (row: Describable, ok: boolean): string | null => {
  const account = row.entity_label ? ` "${row.entity_label}"` : '';
  if (row.action === 'auth.login.failed' || (row.action === 'auth.login' && !ok)) {
    return `Sign-in failed${account ? ` for${account}` : ''}`;
  }
  if (row.action === 'auth.login') {
    return `Signed in${account ? ` as${account}` : ''}`;
  }
  if (row.action === 'auth.logout') return 'Signed out';
  return null;
};

const auditSentence = (row: Describable): string | null => {
  if (!row.action.startsWith('activity-log.')) return null;
  if (row.action === 'activity-log.events') return 'Reported screen activity';
  if (row.action === 'activity-log.purge') {
    return `Archived and removed the log for ${row.entity_id ?? 'a past month'}`;
  }
  if (row.action === 'activity-log.purge.denied') {
    return 'Tried to remove a month of the log — password was wrong';
  }
  if (row.http_method === 'GET') return 'Viewed the activity log';
  if (/settings/.test(row.route ?? '')) return 'Changed activity log settings';
  return null;
};

/**
 * What happened, as a sentence without the person's name — the list shows who
 * in its own column, and repeating it made every row start the same way.
 *
 * A request that did not succeed reads as an attempt ("Tried to view…"), so the
 * sentence never claims something happened that did not.
 */
export const describeActivity = (row: Describable): string => {
  const ok = row.outcome === 'success';

  const special = clientSentence(row) ?? authSentence(row, ok) ?? auditSentence(row);
  if (special) return special;

  // The service that did the work said what happened; nothing derived from a
  // route can say it better. Led by the record, so the line stands on its own.
  if (ok && row.summary) {
    const name = row.entity_label?.split(' · ')[0];
    const record = row.entity_type
      ? `${capitalise(words(row.entity_type))} ${name ?? `#${row.entity_id ?? '?'}`}`
      : null;
    return record
      ? `${record}: ${row.summary[0].toLowerCase()}${row.summary.slice(1)}`
      : row.summary;
  }

  // Voiding a cash-out is filed under the shift it belongs to.
  if (/\/cash-outs\/[^/]+\/void$/.test(row.route ?? '')) {
    return ok ? 'Voided a cash-out' : 'Tried to void a cash-out';
  }

  const [rawNoun, ...rest] = row.action.split('.');
  const noun = words(rawNoun);
  const verbKey = rest.join('.');
  const verb = VERBS[verbKey];

  let subject: string;
  const report = rawNoun === 'report' ? reportName(row.route) : null;
  if (report) {
    subject = `the ${capitalise(report)} report`;
  } else if (row.entity_label) {
    subject = `${noun} "${row.entity_label}"`;
  } else if (row.entity_id) {
    subject = `${noun} #${row.entity_id}`;
  } else if (verbKey === 'view') {
    subject = rawNoun === 'report' ? 'reports' : `the ${noun} list`;
  } else if (verbKey === 'create') {
    subject = `a new ${noun}`;
  } else {
    subject = noun;
  }

  if (!verb) {
    // An action with no wording yet still has to read as something.
    const what = words(verbKey) || 'activity';
    return ok
      ? `${capitalise(subject)}: ${what}`
      : `Tried: ${what} on ${subject}`;
  }
  return ok ? `${verb[0]} ${subject}` : `Tried to ${verb[1]} ${subject}`;
};

/** `menu_item#12.base_price` → `Menu item #12 · Base price` */
export const fieldLabel = (field: string): string => {
  const dot = field.lastIndexOf('.');
  if (field.includes('#') && dot > 0) {
    return `${capitalise(words(field.slice(0, dot)).replace('#', ' #'))} · ${capitalise(
      words(field.slice(dot + 1))
    )}`;
  }
  return capitalise(words(field));
};

/**
 * "Chrome on Windows" from a user-agent string. Deliberately coarse: enough to
 * tell the till from someone's phone, which is the question being asked.
 */
export const describeDevice = (userAgent: string | null | undefined): string | null => {
  const ua = userAgent ?? '';
  if (!ua.trim()) return null;

  let browser: string | null = null;
  if (/Dart\/|okhttp|CFNetwork/i.test(ua)) browser = 'Mobile app';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/curl|Postman|python|node-fetch|axios/i.test(ua)) browser = 'Script or API tool';

  let system: string | null = null;
  if (/Android/.test(ua)) system = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) system = 'iOS';
  else if (/Windows/.test(ua)) system = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) system = 'macOS';
  else if (/Linux/.test(ua)) system = 'Linux';

  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unrecognised device';
};

export const OUTCOME_STYLES: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  denied: 'bg-amber-50 text-amber-800 border-amber-200',
  failed: 'bg-orange-50 text-orange-700 border-orange-200',
  error: 'bg-red-50 text-red-700 border-red-200',
};

export const ACTOR_STYLES: Record<string, string> = {
  staff: 'bg-blue-50 text-blue-700',
  rider: 'bg-violet-50 text-violet-700',
  customer: 'bg-teal-50 text-teal-700',
  kiosk: 'bg-slate-100 text-slate-600',
  anonymous: 'bg-rose-50 text-rose-700',
  system: 'bg-gray-100 text-gray-600',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** A local calendar day. `toISOString()` is UTC, which is yesterday until 5am here. */
export const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const daysAgoIso = (n: number): string =>
  isoDay(new Date(Date.now() - n * 86_400_000));

export const formatWhen = (iso: string, withYear = false): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** `2026-09-21` → `21 Sept 2026`, read as a local day. */
export const formatDay = (day: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

/** "4m ago" reads faster than a timestamp when scanning for what just happened. */
export const relativeWhen = (iso: string): string => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

export interface ActivityGroup {
  /** Newest row first, as the list is ordered. */
  rows: ActivityLogRow[];
}

const GROUP_WINDOW_MS = 60_000;

/**
 * Folds a burst of reads into one line.
 *
 * Opening a screen fires several requests in the same second — the reports page
 * alone calls five endpoints — and each is a row. They are one act by one
 * person, so they are shown as one line that opens to reveal the rest.
 *
 * Only successful reads by the same person from the same address fold. A
 * change, a refusal or a failure always stands on its own line: those are what
 * someone reading this screen is looking for.
 */
export const groupActivity = (rows: ActivityLogRow[]): ActivityGroup[] => {
  const groups: ActivityGroup[] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    const head = current?.rows[0];
    const foldable = isRead(row) && row.outcome === 'success';
    if (
      head &&
      foldable &&
      isRead(head) &&
      head.outcome === 'success' &&
      head.actor_type === row.actor_type &&
      head.actor_user_id === row.actor_user_id &&
      head.actor_label === row.actor_label &&
      head.ip === row.ip &&
      Math.abs(
        new Date(head.created_at).getTime() - new Date(row.created_at).getTime()
      ) <= GROUP_WINDOW_MS
    ) {
      current.rows.push(row);
    } else {
      groups.push({ rows: [row] });
    }
  }
  return groups;
};

/** One line for a folded group, plus what it contains. */
export const describeGroup = (
  group: ActivityGroup
): { title: string; detail: string | null } => {
  const { rows } = group;
  if (rows.length === 1) return { title: describeActivity(rows[0]), detail: null };

  const sentences = [...new Set(rows.map(describeActivity))];
  if (sentences.length === 1) {
    return { title: sentences[0], detail: `${rows.length} times` };
  }

  // The screen that was opened names the burst better than any one request.
  const opened = rows.find((r) => r.action === 'client.page-view');
  if (opened) {
    return {
      title: describeActivity(opened),
      detail: `${rows.length - 1} related ${rows.length === 2 ? 'read' : 'reads'}`,
    };
  }

  const reports = rows
    .filter((r) => r.action === 'report.view')
    .map((r) => reportName(r.route))
    .filter((name): name is string => name != null);
  if (reports.length === rows.length) {
    const names = [...new Set(reports)].map(capitalise);
    return {
      title: `Viewed ${names.length} reports`,
      detail: names.join(', '),
    };
  }

  return {
    title: sentences[sentences.length - 1],
    detail: `and ${sentences.length - 1} more`,
  };
};
