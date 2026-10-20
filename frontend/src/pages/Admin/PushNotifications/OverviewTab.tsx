import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdRefresh } from 'react-icons/md';
import { pushService } from '../../../services/api';
import { formatRs } from '../../../utils/customerDisplay';
import { cu } from '../customersUi';
import { AUTOMATION_PRESETS, instantLabel, PLATFORM_LABEL } from './pushText';

const card = `${cu.card} rounded-[16px]`;

const OverviewTab: React.FC<{ canSend: boolean; canSettings: boolean }> = ({ canSend, canSettings }) => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['push-overview'], queryFn: pushService.overview });
  const sync = useMutation({
    mutationFn: pushService.syncDevices,
    onSuccess: (r) => {
      toast.success(`Phone list refreshed: ${r.synced} registrations`);
      qc.invalidateQueries({ queryKey: ['push-overview'] });
      qc.invalidateQueries({ queryKey: ['push-meta'] });
    },
    onError: () => toast.error('Could not refresh the phone list'),
  });

  if (isLoading || !data) return <p className="py-10 text-center text-gray-500">Loading…</p>;

  const tile = (label: string, value: string, sub?: string) => (
    <div className={`${card} px-4 py-3.5`}>
      <p className={cu.fieldLabel}>{label}</p>
      <p className={`text-[24px] font-black tabular-nums ${cu.strong}`}>{value}</p>
      {sub && <p className={`text-[11.5px] ${cu.muted}`}>{sub}</p>}
    </div>
  );
  const platforms = data.reach.platforms
    .map((p) => `${p.n} ${PLATFORM_LABEL[p.platform ?? ''] ?? 'other'}`)
    .join(' · ');

  return (
    <div className="space-y-5">
      {!data.firebase_configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Firebase is not set up on this server, so notifications cannot be sent from here.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile('Customers with the app', data.reach.customers_with_app.toLocaleString('en-US'), platforms || undefined)}
        {tile('Reachable now', data.reach.reachable.toLocaleString('en-US'), `${data.reach.phones.toLocaleString('en-US')} phones${data.reach.opted_out ? ` · ${data.reach.opted_out} asked to stop` : ''}`)}
        {tile('Sends (30 days)', data.last_30_days.sends.toLocaleString('en-US'))}
        {tile('Customers reached (30 days)', data.last_30_days.recipients.toLocaleString('en-US'), `${data.last_30_days.delivered.toLocaleString('en-US')} phones delivered`)}
        {tile('Orders from them', data.last_30_days.orders.toLocaleString('en-US'), 'within 7 days of a notification')}
        {tile('Revenue from them', formatRs(data.last_30_days.revenue), 'within 7 days of a notification')}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={`${card} p-5`}>
          <h2 className={`mb-3 text-[15.5px] font-bold ${cu.strong}`}>Coming up</h2>
          {data.upcoming.length === 0 ? (
            <p className={`text-[13px] ${cu.muted}`}>Nothing scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {data.upcoming.map((u) => (
                <li key={u.id} className="flex items-baseline justify-between gap-3">
                  <Link to={`/admin/push-notifications/${u.id}`} className={`min-w-0 truncate text-[13.5px] font-semibold ${cu.strong} hover:text-red-600`}>
                    {u.name || u.title}
                  </Link>
                  <span className={`flex-none text-[12.5px] ${cu.muted}`}>{instantLabel(u.next_run_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} p-5`}>
          <h2 className={`mb-3 text-[15.5px] font-bold ${cu.strong}`}>Best performers (90 days)</h2>
          {data.top.length === 0 ? (
            <p className={`text-[13px] ${cu.muted}`}>Results show here once notifications have gone out.</p>
          ) : (
            <ul className="space-y-2">
              {data.top.map((t) => (
                <li key={t.id} className="flex items-baseline justify-between gap-3">
                  <Link to={`/admin/push-notifications/${t.id}`} className={`min-w-0 truncate text-[13.5px] font-semibold ${cu.strong} hover:text-red-600`}>
                    {t.name || t.title}
                  </Link>
                  <span className={`flex-none text-[12.5px] tabular-nums ${cu.soft}`}>
                    {t.orders} orders · {formatRs(t.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canSend && (
        <section className={`${card} p-5`}>
          <h2 className={`mb-1 text-[15.5px] font-bold ${cu.strong}`}>Ready-made automations</h2>
          <p className={`mb-3 text-[12.5px] ${cu.muted}`}>One click fills in the message, audience and schedule — change anything before you start it.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {AUTOMATION_PRESETS.map((p) => (
              <Link
                key={p.key}
                to={`/admin/push-notifications/new?preset=${p.key}`}
                className="rounded-xl border border-gray-200 p-3.5 transition-colors hover:border-red-300 hover:bg-red-50/40 dark:border-slate-700 dark:hover:bg-red-900/10"
              >
                <p className={`text-[13.5px] font-bold ${cu.strong}`}>{p.label}</p>
                <p className={`mt-1 text-[12px] leading-snug ${cu.muted}`}>{p.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className={`flex flex-wrap items-center gap-2 text-[12px] ${cu.muted}`}>
        Phone list from the app last refreshed {data.devices_synced_at ? instantLabel(data.devices_synced_at) : 'never'} (it refreshes every 3 hours, and before every send).
        {canSettings && (
          <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending} className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline disabled:opacity-60">
            <MdRefresh size={14} />
            {sync.isPending ? 'Refreshing…' : 'Refresh now'}
          </button>
        )}
      </p>
    </div>
  );
};

export default OverviewTab;
