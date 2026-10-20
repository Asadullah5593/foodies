import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdArrowBack, MdOutlineCampaign } from 'react-icons/md';
import type { PushResultRow, PushRun } from '../../../types';
import { pushService } from '../../../services/api';
import { confirmDialog } from '../../../utils/sweetAlert';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import PaginationBar from '../../../components/PaginationBar';
import { formatPhone, formatRs } from '../../../utils/customerDisplay';
import { cu } from '../customersUi';
import { inputInline } from './pushUi';
import PhonePreview from './PhonePreview';
import {
  audienceSummary,
  describeSchedule,
  instantLabel,
  momentLabel,
  percent,
  perCustomerText,
  STATUS_META,
} from './pushText';

const card = `${cu.card} rounded-[16px]`;
const WINDOWS = [
  { key: '24h', label: '24 hours' },
  { key: '72h', label: '3 days' },
  { key: '7d', label: '7 days' },
] as const;
type WindowKey = (typeof WINDOWS)[number]['key'];

const RECIPIENT_STATUS: Record<string, string> = {
  sent: 'Delivered',
  failed: 'Failed',
  unknown: 'Unknown (send interrupted)',
  holdout: 'Held back',
  pending: 'Waiting',
  sending: 'Sending',
  cancelled: 'Cancelled',
};

function errorText(e: unknown): string {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return m ?? 'Something went wrong';
}

interface Group {
  label: string;
  customers: number;
  buyers: number;
  orders: number;
  revenue: number;
}

/** Sum the per-send result rows into one group (all sends, or one version). */
function sumRows(rows: PushResultRow[], w: WindowKey, label: string): Group {
  return rows.reduce<Group>(
    (g, r) => ({
      label,
      customers: g.customers + r.customers,
      buyers: g.buyers + Number(r[`buyers_${w}`]),
      orders: g.orders + Number(r[`orders_${w}`]),
      revenue: g.revenue + Number(r[`revenue_${w}`]),
    }),
    { label, customers: 0, buyers: 0, orders: 0, revenue: 0 },
  );
}

const PushMessageDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const messageId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canSend = useHasPermission('push-notifications:send');
  const [win, setWin] = useState<WindowKey>('72h');
  const [runFilter, setRunFilter] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText, 300);
  const [page, setPage] = useState(1);

  const { data: meta } = useQuery({ queryKey: ['push-meta'], queryFn: pushService.meta });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['push-message', messageId],
    queryFn: () => pushService.detail(messageId),
    refetchInterval: (q) => (q.state.data?.message.status === 'sending' || q.state.data?.runs.some((r) => r.status === 'sending') ? 3000 : false),
  });
  const { data: recipients } = useQuery({
    queryKey: ['push-recipients', messageId, runFilter, statusFilter, search, page],
    queryFn: () =>
      pushService.recipients(messageId, {
        run_id: runFilter || undefined,
        status: statusFilter || undefined,
        search: search || undefined,
        page,
        limit: 25,
      }),
    enabled: !!data && data.runs.length > 0,
  });

  const action = useMutation({
    mutationFn: (a: 'pause' | 'resume' | 'cancel' | 'skip-next' | 'duplicate') => pushService.action(messageId, a),
    onSuccess: (d, a) => {
      qc.invalidateQueries({ queryKey: ['push-messages'] });
      qc.invalidateQueries({ queryKey: ['push-overview'] });
      if (a === 'duplicate') {
        toast.success('Copied as a draft');
        navigate(`/admin/push-notifications/${d.message.id}/edit`);
        return;
      }
      qc.setQueryData(['push-message', messageId], d);
      toast.success(
        { pause: 'Paused', resume: 'Resumed', cancel: 'Cancelled', 'skip-next': 'Next send skipped' }[a as 'pause'] ?? 'Done',
      );
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const removeMutation = useMutation({
    mutationFn: () => pushService.remove(messageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-messages'] });
      toast.success('Deleted');
      navigate('/admin/push-notifications');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const totals = useMemo(() => {
    const runs = data?.runs ?? [];
    return runs.reduce(
      (t, r) => ({
        recipients: t.recipients + r.recipients,
        sent: t.sent + r.sent,
        failed: t.failed + r.failed,
        holdout: t.holdout + r.holdout,
      }),
      { recipients: 0, sent: 0, failed: 0, holdout: 0 },
    );
  }, [data]);

  if (isLoading) return <div className={`${cu.page} text-gray-500`}>Loading…</div>;
  if (isError || !data) return <div className={`${cu.page} text-gray-500`}>This notification was not found.</div>;

  const m = data.message;
  const status = STATUS_META[m.status];
  const results = data.results;
  const sentRows = results.filter((r) => !r.holdout);
  const all = sumRows(sentRows, win, 'Got it');
  const held = sumRows(results.filter((r) => r.holdout), win, 'Held back');
  const versionA = sumRows(sentRows.filter((r) => r.variant === 'A'), win, 'Version A');
  const versionB = sumRows(sentRows.filter((r) => r.variant === 'B'), win, 'Version B');
  const hasAB = !!m.variant_b && (versionA.customers > 0 || versionB.customers > 0);
  const hasHoldout = held.customers > 0;
  const editable = ['draft', 'scheduled', 'active', 'paused'].includes(m.status);
  const tokens = meta?.personal_tokens ?? [];
  const resultsByRun = new Map<number, Group>();
  for (const r of sentRows) {
    const g = resultsByRun.get(r.run_id) ?? { label: '', customers: 0, buyers: 0, orders: 0, revenue: 0 };
    resultsByRun.set(r.run_id, {
      label: '',
      customers: g.customers + r.customers,
      buyers: g.buyers + Number(r[`buyers_${win}`]),
      orders: g.orders + Number(r[`orders_${win}`]),
      revenue: g.revenue + Number(r[`revenue_${win}`]),
    });
  }

  const kpi = (label: string, value: string, sub?: string) => (
    <div className={`${card} px-4 py-3.5`}>
      <p className={cu.fieldLabel}>{label}</p>
      <p className={`text-[22px] font-black tabular-nums ${cu.strong}`}>{value}</p>
      {sub && <p className={`text-[11.5px] ${cu.muted}`}>{sub}</p>}
    </div>
  );

  const rate = (g: Group) => percent(g.buyers, g.customers);
  const compareRow = (g: Group, highlight = false) => (
    <tr key={g.label} className={cu.row}>
      <td className={`${cu.td} font-bold ${highlight ? 'text-red-600 dark:text-red-400' : cu.strong}`}>{g.label}</td>
      <td className={`${cu.td} text-right tabular-nums`}>{g.customers.toLocaleString('en-US')}</td>
      <td className={`${cu.td} text-right tabular-nums`}>{g.buyers.toLocaleString('en-US')}</td>
      <td className={`${cu.td} text-right font-bold tabular-nums ${cu.strong}`}>{rate(g)}</td>
      <td className={`${cu.td} text-right tabular-nums`}>{g.orders.toLocaleString('en-US')}</td>
      <td className={`${cu.td} text-right tabular-nums`}>{formatRs(g.revenue)}</td>
    </tr>
  );

  const runSkips = (r: PushRun) =>
    [
      r.skipped_opt_out && `${r.skipped_opt_out} asked to stop`,
      r.skipped_cap && `${r.skipped_cap} over the limit`,
      r.skipped_in_progress && `${r.skipped_in_progress} order in progress`,
      r.skipped_repeat && `${r.skipped_repeat} already had it`,
      r.skipped_rider && `${r.skipped_rider} rider id`,
    ]
      .filter(Boolean)
      .join(' · ');

  const notes = (r: PushRun) =>
    [runSkips(r) && `Left out: ${runSkips(r)}`, r.holdout ? `${r.holdout} held back` : '', r.note].filter(Boolean).join(' · ');

  const downloadCsv = async () => {
    try {
      const blob = await pushService.recipientsCsv(messageId, { run_id: runFilter || undefined, status: statusFilter || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `push-${messageId}-recipients.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div className={cu.page}>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Link to="/admin/push-notifications" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800" aria-label="Back">
          <MdArrowBack size={20} />
        </Link>
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-900/30">
          <MdOutlineCampaign size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={`text-[22px] font-extrabold tracking-tight ${cu.strong}`}>{m.name || m.title}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${status.pill}`}>{status.label}</span>
          </div>
          <p className={`text-[13px] ${cu.muted}`}>
            {describeSchedule(m)}
            {m.schedule_type === 'repeat' && ` · ${perCustomerText(m.per_customer, m.per_customer_days)}`}
            {m.created_by_name && ` · by ${m.created_by_name}`}
          </p>
        </div>
        {canSend && (
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Link to={`/admin/push-notifications/${m.id}/edit`} className={cu.btnOutline}>
                Edit
              </Link>
            )}
            {m.status === 'active' && (
              <>
                <button type="button" className={cu.btnOutline} onClick={() => action.mutate('skip-next')}>
                  Skip next send
                </button>
                <button type="button" className={cu.btnOutline} onClick={() => action.mutate('pause')}>
                  Pause
                </button>
              </>
            )}
            {m.status === 'paused' && (
              <button type="button" className={cu.btnOutline} onClick={() => action.mutate('resume')}>
                Resume
              </button>
            )}
            {totals.sent > 0 && (
              <Link to={`/admin/push-notifications/new?resend=${m.id}&days=3`} className={cu.btnOutline} title="A new notification to everyone who got this one and did not order within 3 days">
                Send again to non-buyers
              </Link>
            )}
            <button type="button" className={cu.btnOutline} onClick={() => action.mutate('duplicate')}>
              Duplicate
            </button>
            {['scheduled', 'active', 'paused', 'sending'].includes(m.status) && (
              <button
                type="button"
                className={`${cu.btnOutline} text-red-600`}
                onClick={async () => {
                  if (await confirmDialog({ title: 'Cancel this notification?', text: 'Nothing more will be sent. What has gone out stays in the results.', confirmText: 'Cancel it', cancelText: 'Keep it' }))
                    action.mutate('cancel');
                }}
              >
                Cancel
              </button>
            )}
            {(m.status === 'draft' || (m.status === 'cancelled' && m.runs_count === 0)) && (
              <button
                type="button"
                className={`${cu.btnOutline} text-red-600`}
                onClick={async () => {
                  if (await confirmDialog({ title: 'Delete this notification?', confirmText: 'Delete' })) removeMutation.mutate();
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpi('Sends', String(data.runs.length), m.next_run_at ? `next ${instantLabel(m.next_run_at)}` : undefined)}
        {kpi('Customers reached', totals.recipients.toLocaleString('en-US'))}
        {kpi('Phones delivered', totals.sent.toLocaleString('en-US'), totals.failed ? `${totals.failed} failed` : undefined)}
        {kpi('Ordered within 7 days', sumRows(sentRows, '7d', '').buyers.toLocaleString('en-US'), `${percent(sumRows(sentRows, '7d', '').buyers, sumRows(sentRows, '7d', '').customers)} of those reached`)}
        {kpi('Orders', sumRows(sentRows, '7d', '').orders.toLocaleString('en-US'), 'within 7 days')}
        {kpi('Revenue', formatRs(sumRows(sentRows, '7d', '').revenue), 'within 7 days')}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {/* Results */}
          {results.length > 0 && (
            <section className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
                <div>
                  <h2 className={`text-[15.5px] font-bold ${cu.strong}`}>Did it bring orders?</h2>
                  <p className={`text-[12px] ${cu.muted}`}>Orders placed by the people who got it, counted from the moment it reached them.</p>
                </div>
                <div className="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-slate-700" role="radiogroup" aria-label="Within">
                  {WINDOWS.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      role="radio"
                      aria-checked={win === w.key}
                      onClick={() => setWin(w.key)}
                      className={`rounded-md px-2.5 py-1 text-[12px] font-bold ${win === w.key ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className={cu.headRow}>
                      <th className={cu.th}>Group</th>
                      <th className={`${cu.th} text-right`}>Customers</th>
                      <th className={`${cu.th} text-right`}>Ordered</th>
                      <th className={`${cu.th} text-right`}>Rate</th>
                      <th className={`${cu.th} text-right`}>Orders</th>
                      <th className={`${cu.th} text-right`}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody className={`text-[13px] ${cu.text}`}>
                    {hasAB ? [compareRow(versionA), compareRow(versionB)] : compareRow(all, true)}
                    {hasHoldout && compareRow(held)}
                  </tbody>
                </table>
              </div>
              {((hasHoldout && all.customers > 0) || hasAB) && (
                <p className={`border-t border-[#F1F2F5] px-5 py-3 text-[12.5px] dark:border-slate-700 ${cu.soft}`}>
                  {hasHoldout &&
                    all.customers > 0 &&
                    (() => {
                      const lift = (all.customers ? all.buyers / all.customers : 0) - (held.customers ? held.buyers / held.customers : 0);
                      return (
                        <span className="mr-3">
                          <b>Real effect:</b> {rate(all)} of those who got it ordered vs {rate(held)} of those held back —{' '}
                          <b className={lift > 0 ? cu.good : cu.warn}>
                            {lift >= 0 ? '+' : ''}
                            {(lift * 100).toFixed(1)} points
                          </b>
                          .
                        </span>
                      );
                    })()}
                  {hasAB && (
                    <span>
                      <b>A/B:</b> version {versionB.customers && versionB.buyers / versionB.customers > (versionA.customers ? versionA.buyers / versionA.customers : 0) ? 'B' : 'A'} is ahead so far.
                    </span>
                  )}
                </p>
              )}
            </section>
          )}

          {/* Sends */}
          <section className={`${card} overflow-hidden`}>
            <h2 className={`px-5 pb-3 pt-4 text-[15.5px] font-bold ${cu.strong}`}>Sends</h2>
            {data.runs.length === 0 ? (
              <p className={`border-t border-[#F1F2F5] px-5 py-4 text-[13px] dark:border-slate-700 ${cu.muted}`}>
                {m.status === 'draft' ? 'Not sent — it is a draft.' : m.next_run_at ? `First send ${instantLabel(m.next_run_at)}.` : 'Nothing has been sent.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] border-collapse">
                  <thead>
                    <tr className={cu.headRow}>
                      <th className={cu.th}>When</th>
                      <th className={`${cu.th} text-right`}>Matched</th>
                      <th className={`${cu.th} text-right`}>With app</th>
                      <th className={`${cu.th} text-right`}>Sent to</th>
                      <th className={`${cu.th} text-right`}>Phones ✓ / ✕</th>
                      <th className={`${cu.th} text-right`}>Ordered</th>
                    </tr>
                  </thead>
                  <tbody className={`text-[13px] ${cu.text}`}>
                    {data.runs.map((r) => {
                      const g = resultsByRun.get(r.id);
                      return (
                        <React.Fragment key={r.id}>
                        <tr className={notes(r) ? '' : cu.row}>
                          <td className={`${cu.td} whitespace-nowrap`}>
                            {instantLabel(r.started_at ?? r.scheduled_for)}
                            {r.status === 'sending' && <span className="ml-1.5 text-sky-600">sending…</span>}
                            {r.status === 'failed' && <span className="ml-1.5 text-red-600">failed</span>}
                            {r.status === 'skipped' && <span className="ml-1.5 text-amber-600">skipped</span>}
                          </td>
                          <td className={`${cu.td} text-right tabular-nums`}>{r.matched.toLocaleString('en-US')}</td>
                          <td className={`${cu.td} text-right tabular-nums`}>{r.with_app.toLocaleString('en-US')}</td>
                          <td className={`${cu.td} text-right font-bold tabular-nums ${cu.strong}`}>{r.recipients.toLocaleString('en-US')}</td>
                          <td className={`${cu.td} text-right tabular-nums`}>
                            <span className={cu.good}>{r.sent}</span> / <span className={r.failed ? cu.danger : cu.faint}>{r.failed}</span>
                          </td>
                          <td className={`${cu.td} text-right tabular-nums`}>{g ? `${g.buyers} (${percent(g.buyers, g.customers)})` : '—'}</td>
                        </tr>
                        {notes(r) && (
                          <tr className={cu.row}>
                            <td colSpan={6} className={`${cu.td} pt-0 text-[12px] ${cu.muted}`}>
                              {notes(r)}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recipients */}
          {data.runs.length > 0 && (
            <section className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-end justify-between gap-2 px-5 pb-3 pt-4">
                <h2 className={`text-[15.5px] font-bold ${cu.strong}`}>Who got it</h2>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={`${inputInline} w-[180px]`}
                    placeholder="Name or phone"
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Search recipients"
                  />
                  {data.runs.length > 1 && (
                    <select className={inputInline} value={runFilter} onChange={(e) => { setRunFilter(e.target.value ? Number(e.target.value) : ''); setPage(1); }} aria-label="Send">
                      <option value="">All sends</option>
                      {data.runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {instantLabel(r.started_at ?? r.scheduled_for)}
                        </option>
                      ))}
                    </select>
                  )}
                  <select className={inputInline} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Status">
                    <option value="">Any status</option>
                    {Object.entries(RECIPIENT_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={cu.btnOutline} onClick={() => void downloadCsv()}>
                    Export CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead>
                    <tr className={cu.headRow}>
                      <th className={cu.th}>Customer</th>
                      <th className={cu.th}>Status</th>
                      {m.variant_b && <th className={cu.th}>Version</th>}
                      <th className={`${cu.th} text-right`}>Phones</th>
                      <th className={cu.th}>Sent</th>
                      <th className={cu.th}>Ordered after</th>
                    </tr>
                  </thead>
                  <tbody className={`text-[13px] ${cu.text}`}>
                    {(recipients?.data ?? []).map((r) => (
                      <tr key={r.id} className={cu.row}>
                        <td className={cu.td}>
                          <Link to={`/admin/customers/${r.customer_id}`} className="font-semibold hover:text-red-600">
                            {r.customer_name || 'No name'}
                          </Link>
                          <span className={`block text-[12px] ${cu.muted}`}>{formatPhone(r.phone)}</span>
                        </td>
                        <td className={cu.td}>
                          <span className={r.status === 'sent' ? cu.good : r.status === 'failed' ? cu.danger : cu.muted}>{RECIPIENT_STATUS[r.status] ?? r.status}</span>
                          {r.error && <span className={`block max-w-[220px] truncate text-[11.5px] ${cu.muted}`} title={r.error}>{r.error}</span>}
                        </td>
                        {m.variant_b && <td className={cu.td}>{r.variant ?? '—'}</td>}
                        <td className={`${cu.td} text-right tabular-nums`}>{r.status === 'holdout' ? '—' : `${r.sent}/${r.phones}`}</td>
                        <td className={`${cu.td} whitespace-nowrap`}>{instantLabel(r.sent_at)}</td>
                        <td className={`${cu.td} whitespace-nowrap`}>
                          {r.first_order_id ? (
                            <span className={cu.good}>
                              {instantLabel(r.first_order_at)} · {formatRs(Number(r.first_order_total))}
                              {r.first_order_brand ? ` · ${r.first_order_brand}` : ''}
                            </span>
                          ) : (
                            <span className={cu.faint}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {recipients && recipients.data.length === 0 && (
                      <tr>
                        <td colSpan={6} className={`${cu.td} ${cu.muted}`}>No one matches.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {recipients && recipients.total > 25 && (
                <PaginationBar totalCount={recipients.total} page={page} pageSize={25} onPageChange={setPage} itemLabel="customers" className="px-5 py-3" />
              )}
            </section>
          )}
        </div>

        {/* Right column */}
        <aside className="min-w-0 space-y-5">
          <section className={`${card} p-5`}>
            <h2 className={`mb-3 text-[15.5px] font-bold ${cu.strong}`}>Message</h2>
            <PhonePreview title={m.title} body={m.body} imageUrl={m.image_url} tokens={tokens} caption={m.variant_b ? 'Version A' : undefined} />
            {m.variant_b && (
              <div className="mt-4">
                <PhonePreview title={m.variant_b.title} body={m.variant_b.body} imageUrl={m.image_url} tokens={tokens} caption={`Version B · ${m.ab_split ?? 50}% of the audience`} />
              </div>
            )}
          </section>
          <section className={`${card} p-5`}>
            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className={cu.fieldLabel}>Audience</dt>
                <dd className={cu.text}>
                  {m.audience_name ? <b>{m.audience_name}: </b> : null}
                  {audienceSummary(m.audience, meta)}
                </dd>
              </div>
              <div>
                <dt className={cu.fieldLabel}>Left out</dt>
                <dd className={cu.text}>
                  {[m.skip_order_in_progress && 'customers with an order in progress', m.respect_cap && 'anyone over the per-customer limit', 'anyone who asked to stop']
                    .filter(Boolean)
                    .join(', ')}
                </dd>
              </div>
              <div>
                <dt className={cu.fieldLabel}>Expires after</dt>
                <dd className={cu.text}>
                  {m.expiry_hours} hours{m.replace_previous ? ' · replaces the previous promo' : ''}
                  {m.holdout_percent ? ` · ${m.holdout_percent}% held back` : ''}
                </dd>
              </div>
              {data.upcoming.length > 0 && (
                <div>
                  <dt className={cu.fieldLabel}>Next sends</dt>
                  <dd className={cu.text}>
                    <ul className="space-y-0.5">
                      {data.upcoming.map((u) => (
                        <li key={u.at}>
                          {momentLabel(u)}
                          {u.held_until && <span className={`ml-1 ${cu.warn}`}>(waits for quiet hours to end)</span>}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {m.skip_dates.length > 0 && (
                <div>
                  <dt className={cu.fieldLabel}>Skipped days</dt>
                  <dd className={cu.text}>{m.skip_dates.join(', ')}</dd>
                </div>
              )}
            </dl>
          </section>
          {data.by_brand.length > 0 && (
            <section className={`${card} p-5`}>
              <h2 className={`mb-2 text-[15.5px] font-bold ${cu.strong}`}>Orders by brand (7 days)</h2>
              <ul className="space-y-1.5 text-[13px]">
                {data.by_brand.map((b) => (
                  <li key={b.id ?? 'none'} className="flex justify-between gap-2">
                    <span className={cu.text}>{b.name ?? '—'}</span>
                    <span className={`tabular-nums ${cu.soft}`}>
                      {b.orders} · {formatRs(b.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};

export default PushMessageDetail;
