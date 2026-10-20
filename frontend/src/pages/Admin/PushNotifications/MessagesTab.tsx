import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PushListTab, PushMessageListRow, PushMeta } from '../../../types';
import { pushService } from '../../../services/api';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import PaginationBar from '../../../components/PaginationBar';
import { formatRs } from '../../../utils/customerDisplay';
import { cu } from '../customersUi';
import { audienceSummary, describeSchedule, instantLabel, STATUS_META } from './pushText';

const TABS: Array<{ key: PushListTab | ''; label: string }> = [
  { key: '', label: 'All' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'repeating', label: 'Repeating' },
  { key: 'sent', label: 'Sent' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAGE = 20;

function whenLine(m: PushMessageListRow): string {
  if (m.status === 'draft') return 'Draft';
  if (m.next_run_at && ['scheduled', 'active'].includes(m.status)) return `Next: ${instantLabel(m.next_run_at)}`;
  if (m.status === 'paused') return 'Paused';
  if (m.last_run_at) return `Last sent ${instantLabel(m.last_run_at)}`;
  return '—';
}

const MessagesTab: React.FC<{ meta: PushMeta | undefined; canSend: boolean }> = ({ meta, canSend }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<PushListTab | ''>('');
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText, 300);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['push-messages', tab, search, page],
    queryFn: () => pushService.list({ status: tab, search: search || undefined, page, limit: PAGE }),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (q.state.data?.data.some((m) => m.status === 'sending') ? 4000 : false),
  });
  const counts = data?.counts;
  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Status">
          {TABS.map((t) => {
            const n = t.key ? (counts?.[t.key] ?? 0) : total;
            return (
              <button
                key={t.key || 'all'}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
                  tab === t.key
                    ? 'border-gray-800 bg-gray-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                    : 'border-[#E2E5EA] bg-white text-[#374151] hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {t.label} <span className="ml-0.5 opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
        <input
          className={`${cu.input} max-w-[260px]`}
          placeholder="Search title or text"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setPage(1);
          }}
          aria-label="Search notifications"
        />
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-gray-500">Loading…</p>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center dark:border-slate-600 dark:bg-slate-800/50">
          <p className={`text-[15px] font-semibold ${cu.strong}`}>{search || tab ? 'Nothing here' : 'No notifications yet'}</p>
          <p className={`mt-1 text-[13px] ${cu.muted}`}>
            {search || tab ? 'Try another tab or search.' : 'Send your first one — to everyone with the app, or to just the customers you pick.'}
          </p>
          {canSend && !search && !tab && (
            <Link to="/admin/push-notifications/new" className={`${cu.btnPrimary} mt-4 inline-block`}>
              New notification
            </Link>
          )}
        </div>
      ) : (
        <div className={`${cu.card} overflow-hidden rounded-[16px]`}>
          {/* Desktop table */}
          <table className="w-full border-collapse max-lg:hidden">
            <thead>
              <tr className={cu.headRow}>
                <th className={cu.th}>Notification</th>
                <th className={cu.th}>Status</th>
                <th className={cu.th}>Audience</th>
                <th className={cu.th}>When</th>
                <th className={`${cu.th} text-right`}>Reached</th>
                <th className={`${cu.th} text-right`}>Orders (7 days)</th>
              </tr>
            </thead>
            <tbody className={`text-[13px] ${cu.text}`}>
              {data.data.map((m) => (
                <tr
                  key={m.id}
                  className={`${cu.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40`}
                  onClick={() => navigate(`/admin/push-notifications/${m.id}`)}
                >
                  <td className={`${cu.td} max-w-[360px]`}>
                    <Link to={`/admin/push-notifications/${m.id}`} className={`block truncate font-bold ${cu.strong} hover:text-red-600`} onClick={(e) => e.stopPropagation()}>
                      {m.name || m.title}
                    </Link>
                    <span className={`block truncate text-[12px] ${cu.muted}`}>
                      {m.name ? `${m.title} — ` : ''}
                      {m.body}
                    </span>
                    {(m.brand_name || m.ab_test) && (
                      <span className={`text-[11px] ${cu.muted}`}>
                        {m.brand_name}
                        {m.brand_name && m.ab_test ? ' · ' : ''}
                        {m.ab_test ? 'A/B test' : ''}
                      </span>
                    )}
                  </td>
                  <td className={cu.td}>
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${STATUS_META[m.status].pill}`}>{STATUS_META[m.status].label}</span>
                  </td>
                  <td className={`${cu.td} max-w-[240px]`}>
                    <span className="line-clamp-2 text-[12.5px]">{m.audience_name ? `${m.audience_name}` : audienceSummary(m.audience, meta)}</span>
                  </td>
                  <td className={`${cu.td} text-[12.5px]`}>
                    <span className="block">{whenLine(m)}</span>
                    {m.schedule_type === 'repeat' && m.repeat && <span className={`block ${cu.muted}`}>{describeSchedule(m)}</span>}
                  </td>
                  <td className={`${cu.td} text-right tabular-nums`}>
                    {m.recipients ? m.recipients.toLocaleString('en-US') : <span className={cu.faint}>—</span>}
                    {m.failed > 0 && <span className={`block text-[11px] ${cu.danger}`}>{m.failed} failed</span>}
                  </td>
                  <td className={`${cu.td} text-right tabular-nums`}>
                    {m.orders_7d ? (
                      <>
                        <b className={cu.strong}>{m.orders_7d}</b>
                        <span className={`block text-[11.5px] ${cu.muted}`}>{formatRs(m.revenue_7d)}</span>
                      </>
                    ) : (
                      <span className={cu.faint}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone / tablet cards */}
          <ul className="divide-y divide-[#F4F5F7] lg:hidden dark:divide-slate-700">
            {data.data.map((m) => (
              <li key={m.id}>
                <Link to={`/admin/push-notifications/${m.id}`} className="block px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`min-w-0 truncate text-[14px] font-bold ${cu.strong}`}>{m.name || m.title}</span>
                    <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_META[m.status].pill}`}>{STATUS_META[m.status].label}</span>
                  </div>
                  <p className={`mt-0.5 line-clamp-2 text-[12.5px] ${cu.soft}`}>{m.body}</p>
                  <p className={`mt-1 text-[12px] ${cu.muted}`}>
                    {whenLine(m)}
                    {m.recipients ? ` · reached ${m.recipients}` : ''}
                    {m.orders_7d ? ` · ${m.orders_7d} orders` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {data.total > PAGE && (
            <PaginationBar totalCount={data.total} page={page} pageSize={PAGE} onPageChange={setPage} itemLabel="notifications" className="border-t border-[#F1F2F5] px-5 py-3 dark:border-slate-700" />
          )}
        </div>
      )}
    </div>
  );
};

export default MessagesTab;
