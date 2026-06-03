import React from 'react';
import { formatCurrency } from '../../../utils/currency';
import { STATUS_COLORS, DELIVERY_STATUS_COLORS } from '../../../utils/chartColors';
import type { DashboardSummary, RecentOrder, InventoryAlerts } from './types';

const prettify = (s: string) => s.replace(/_/g, ' ');

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const Stars: React.FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return <span className="text-gray-400 dark:text-slate-500">—</span>;
  const full = Math.round(value);
  return (
    <span className="text-amber-500" aria-label={`${value.toFixed(1)} stars`}>
      {'★'.repeat(full)}
      <span className="text-gray-300 dark:text-slate-600">{'★'.repeat(5 - full)}</span>
    </span>
  );
};

/** Delivery sub-status tiles + live rider presence. */
export const DeliveryStatusPanel: React.FC<{
  delivery: DashboardSummary['delivery'];
}> = ({ delivery }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
        <p className="text-xs text-emerald-700 dark:text-emerald-300">Riders online</p>
        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
          {delivery.active_riders}
        </p>
      </div>
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
        <p className="text-xs text-amber-700 dark:text-amber-300">Paused</p>
        <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
          {delivery.paused_riders}
        </p>
      </div>
    </div>
    {delivery.by_status.length === 0 ? (
      <p className="text-sm text-gray-400 dark:text-slate-500">No delivery orders in range.</p>
    ) : (
      <ul className="space-y-2">
        {delivery.by_status.map((d) => (
          <li key={d.status} className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2 capitalize text-gray-700 dark:text-slate-300">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: DELIVERY_STATUS_COLORS[d.status] ?? '#94A3B8' }}
              />
              {prettify(d.status)}
            </span>
            <span className="font-semibold text-gray-900 dark:text-slate-100">{d.count}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const RatingRow: React.FC<{ name: string; avg: number; count: number }> = ({ name, avg, count }) => (
  <li className="flex items-center justify-between gap-2 text-sm">
    <span className="truncate text-gray-700 dark:text-slate-300">{name}</span>
    <span className="flex shrink-0 items-center gap-1.5">
      <Stars value={avg} />
      <span className="font-semibold text-gray-900 dark:text-slate-100">{avg.toFixed(1)}</span>
      <span className="text-xs text-gray-400 dark:text-slate-500">({count})</span>
    </span>
  </li>
);

/** Per-brand and per-rider ratings + recent comments. */
export const RatingsPanel: React.FC<{
  ratings: DashboardSummary['ratings'];
}> = ({ ratings }) => (
  <div className="space-y-4">
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
        By brand
      </h4>
      {ratings.by_brand.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No brand ratings in range.</p>
      ) : (
        <ul className="space-y-1.5">
          {ratings.by_brand.map((b) => (
            <RatingRow key={b.id} name={b.name} avg={b.avg} count={b.count} />
          ))}
        </ul>
      )}
    </div>
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
        By rider
      </h4>
      {ratings.by_rider.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No rider ratings in range.</p>
      ) : (
        <ul className="space-y-1.5">
          {ratings.by_rider.map((r) => (
            <RatingRow key={r.id} name={r.name} avg={r.avg} count={r.count} />
          ))}
        </ul>
      )}
    </div>
    {ratings.recent_comments.length > 0 && (
      <div>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          Recent comments
        </h4>
        <ul className="space-y-2">
          {ratings.recent_comments.map((c, i) => (
            <li key={i} className="border-l-2 border-amber-400 pl-3">
              <div className="flex items-center gap-2 text-xs">
                <Stars value={c.stars} />
                <span className="uppercase text-gray-400 dark:text-slate-500">{c.type}</span>
                <span className="text-gray-400 dark:text-slate-500">{relativeTime(c.created_at)}</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-slate-300">{c.comment}</p>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

const SOURCE_LABEL: Record<string, string> = {
  pos: 'POS',
  consumer_app: 'App',
  consumer_web: 'Web',
  kiosk: 'Kiosk',
};

/** Most recent orders feed. */
export const RecentOrdersPanel: React.FC<{ orders: RecentOrder[] }> = ({ orders }) => {
  if (orders.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-slate-500">No orders in range.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100 dark:divide-slate-700">
      {orders.map((o) => (
        <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-800 dark:text-slate-100">
              #{o.order_number}
              <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-500">
                {o.customer_name ?? 'Walk-in'}
              </span>
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              <span className="capitalize">{prettify(o.order_type)}</span>
              {' · '}
              {SOURCE_LABEL[o.source] ?? o.source}
              {' · '}
              {relativeTime(o.placed_at)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {formatCurrency(o.total_amount)}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize text-white"
              style={{ background: STATUS_COLORS[o.status] ?? '#64748B' }}
            >
              {o.status}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
};

/** Low-stock alerts + recent wastage. */
export const InventoryAlertsPanel: React.FC<{ data: InventoryAlerts }> = ({ data }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
        Low stock
      </h4>
      {data.low_stock.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">All items above reorder point.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.low_stock.map((it) => (
            <li
              key={`${it.item_id}-${it.branch_id}`}
              className="flex items-center justify-between rounded-md bg-red-50 dark:bg-red-900/20 px-2.5 py-1.5 text-sm"
            >
              <span className="truncate text-gray-700 dark:text-slate-300">{it.name}</span>
              <span className="ml-2 shrink-0 font-semibold text-red-600 dark:text-red-400">
                {it.qty} / {it.reorder_point}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
        Recent wastage
      </h4>
      {data.recent_wastage.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No wastage in range.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.recent_wastage.map((w, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span className="truncate text-gray-700 dark:text-slate-300">
                {w.name}
                <span className="ml-1 text-xs text-gray-400 dark:text-slate-500">({w.reason})</span>
              </span>
              <span className="ml-2 shrink-0 font-semibold text-amber-600 dark:text-amber-400">
                {w.qty}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);
