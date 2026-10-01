import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../../services/api';
import type { CustomerBreakdownLine } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import { LoyaltyWalletList, pointsTotal } from '../../components/LoyaltyWallets';
import CustomerVouchersModal from '../../components/CustomerVouchersModal';
import CustomerFormModal from '../../components/CustomerFormModal';
import { useHasPermission, useHasRestriction } from '../../hooks/useHasPermission';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import { useAuth } from '../../contexts/AuthContext';
import { canAccessPath } from '../../lib/pathPermissions';
import { NO_TOTALS_PERMISSION } from '../../lib/orderStatusPermissions';
import { CUSTOMER_SOURCE_BADGE, CUSTOMER_SOURCE_BORDER, customerSourceLabel } from '../../utils/customerSources';
import { customerOrdersPath } from '../../utils/customerOrdersPath';
import { orderSourceLabel } from '../../utils/orderSources';
import { formatOrderType } from '../../utils/format';
import { formatPhone, formatPoints, formatRs, nameInitials } from '../../utils/customerDisplay';
import { daysAgoLabel, formatDay } from '../../utils/dateDisplay';
import { customerStatus, type CustomerStatus } from '../../utils/customerFilters';
import { cu, STATUS_PILL, STATUS_TEXT } from './customersUi';

const cardCls = `${cu.card} rounded-[16px]`;
const titleCls = `text-[15.5px] font-bold ${cu.strong}`;

/** "Lapsed · 69 days since last order" — where the customer stands, in words. */
function statusText(status: CustomerStatus, lastOrderAt: string | null): string {
  if (status.key === 'never') return 'Never ordered';
  if (status.key === 'active') return `Active · last order ${daysAgoLabel(lastOrderAt)}`;
  return `${status.key === 'lapsed' ? 'Lapsed' : 'Lapsing'} · ${status.days} days since last order`;
}

const iconProps = {
  width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
};
const PhoneIcon = () => (
  <svg {...iconProps}><path d="M5.2 2.8h2.5l1.2 3.4-1.7 1.3a10 10 0 0 0 5.3 5.3l1.3-1.7 3.4 1.2v2.5a1.7 1.7 0 0 1-1.9 1.7A14.6 14.6 0 0 1 3.5 4.7 1.7 1.7 0 0 1 5.2 2.8z" /></svg>
);
const CalendarIcon = () => (
  <svg {...iconProps}><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.8v3M13 2.8v3" /></svg>
);

/**
 * Phone and registration date. These are what staff come to this page to read
 * off, so each gets a label, an icon and large type of its own rather than a
 * line of small print under the name. Email is deliberately not shown on this
 * page: it had a card here, which was removed at the client's request.
 */
const Contact: React.FC<{
  testId: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}> = ({ testId, icon, label, value, sub }) => (
  <div
    data-testid={testId}
    className="flex min-w-0 items-center gap-3 rounded-[12px] border border-[#EEEFF2] bg-[#F6F7F9] px-4 py-3 dark:border-slate-600 dark:bg-slate-700/50"
  >
    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-[#ECEDF0] bg-white text-[#DC2A2A] dark:border-slate-600 dark:bg-slate-800 dark:text-red-400">
      {icon}
    </span>
    <div className="min-w-0">
      <dt className={cu.label}>{label}</dt>
      <dd className={`mt-0.5 truncate text-[18px] font-extrabold leading-tight tabular-nums ${cu.strong}`}>{value}</dd>
      {sub ? <dd className={`mt-0.5 truncate text-[12px] font-semibold ${cu.muted}`}>{sub}</dd> : null}
    </div>
  </div>
);

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub: string; valueCls?: string; subCls?: string }> = ({
  label,
  value,
  sub,
  valueCls = cu.strong,
  subCls = 'text-[#9AA1AD] dark:text-slate-400',
}) => (
  <div className={`${cu.card} rounded-[14px] px-[18px] py-4`} data-testid={`kpi-${label}`}>
    <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9AA1AD] dark:text-slate-400">{label}</div>
    <div className={`mt-[7px] whitespace-nowrap text-[21px] font-black tracking-[-.01em] tabular-nums ${valueCls}`}>{value}</div>
    <div className={`mt-1 whitespace-nowrap text-[12px] font-semibold ${subCls}`}>{sub}</div>
  </div>
);

/**
 * One customer in full: who they are, where and how often they order — a line
 * per brand + branch ("12 completed at Fireaway · Pine Avenue"), each opening
 * those very orders in the Orders module — and the points they hold.
 *
 * Figures follow the server's rules: only finished orders count, spend is
 * completed orders only, and they cover the orders this viewer may read.
 */
const CustomerDetail: React.FC = () => {
  useSensitivePageView('customers');
  const { id } = useParams<{ id: string }>();
  const customerId = /^[1-9]\d*$/.test(id ?? '') ? Number(id) : null;
  const { user } = useAuth();
  const canViewOrders = canAccessPath(user, '/admin/orders');
  const canEdit = useHasPermission('customers:edit');
  const hideTotals = useHasRestriction(NO_TOTALS_PERMISSION);
  const [showVouchers, setShowVouchers] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-summary', customerId],
    queryFn: () => adminService.getCustomerSummary(customerId!),
    enabled: customerId != null,
    retry: false,
  });

  const back = (
    <Link
      to="/admin/customers"
      className="mb-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#6B7280] hover:text-[#B5121B] dark:text-slate-400 dark:hover:text-red-300"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 8H3M6.5 4.5L3 8l3.5 3.5" />
      </svg>
      All customers
    </Link>
  );

  if (customerId != null && isLoading) return <Loader fullScreen text="Loading customer..." />;

  if (customerId == null || isError || !data) {
    return (
      <div className={cu.page}>
        {back}
        <div className={`${cardCls} p-12 text-center text-[14px] ${cu.muted}`}>Customer not found.</div>
      </div>
    );
  }

  const c = data;
  const stats = c.orderStats;
  const who = { id: c.id, name: c.name, phone: c.phone };
  const source = String(c.source ?? 'pos');
  const status = customerStatus(stats.last_order_at);
  const finished = stats.completed_count + stats.cancelled_count;
  const totalPoints = pointsTotal(c.loyaltyWallets);
  const registeredAgo = daysAgoLabel(c.createdAt);

  const spentCell = (line: { spent: number | null; completed_count: number }) =>
    line.spent != null && line.completed_count > 0 ? formatRs(line.spent) : <span className={cu.faint}>—</span>;

  /** A count that opens those orders, when the viewer can open Orders at all. */
  const countLink = (n: number, kind: 'completed' | 'cancelled', narrow: { brandId?: number | null; branchId?: number | null } = {}) => {
    const red = kind === 'cancelled' && n > 0;
    if (n === 0) return <span className={cu.faint}>0</span>;
    if (!canViewOrders) return <span className={`font-extrabold ${red ? cu.danger : cu.strong}`}>{n}</span>;
    return (
      <Link
        to={customerOrdersPath(who, { ...narrow, status: kind })}
        title={`Open these ${n} ${kind} order${n === 1 ? '' : 's'}`}
        className={cu.link}
      >
        {n}
      </Link>
    );
  };

  const mixTable = (title: string, firstCol: string, lines: CustomerBreakdownLine[], labelOf: (l: CustomerBreakdownLine) => string) => (
    <div>
      <h2 className={`mb-3 ${titleCls}`}>{title}</h2>
      {lines.length === 0 ? (
        <p className={`text-[13px] ${cu.muted}`}>No finished orders yet.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={`rounded-l-[9px] bg-[#FBFBFC] px-3 py-[9px] text-left dark:bg-slate-900/40 ${cu.label}`}>{firstCol}</th>
              <th scope="col" className={`bg-[#FBFBFC] px-3 py-[9px] text-right dark:bg-slate-900/40 ${cu.label}`}>Completed</th>
              <th scope="col" className={`bg-[#FBFBFC] px-3 py-[9px] text-right dark:bg-slate-900/40 ${cu.label} ${hideTotals ? 'rounded-r-[9px]' : ''}`}>Cancelled</th>
              {!hideTotals && <th scope="col" className={`rounded-r-[9px] bg-[#FBFBFC] px-3 py-[9px] text-right dark:bg-slate-900/40 ${cu.label}`}>Spent</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={labelOf(l)} className={cu.row}>
                <td className={`px-3 py-[11px] text-[13.5px] font-bold ${cu.strong}`}>{labelOf(l)}</td>
                <td className={`px-3 py-[11px] text-right text-[13.5px] tabular-nums ${l.completed_count > 0 ? cu.text : cu.faint}`}>{l.completed_count}</td>
                <td className={`px-3 py-[11px] text-right text-[13.5px] tabular-nums ${l.cancelled_count > 0 ? `font-bold ${cu.danger}` : cu.faint}`}>{l.cancelled_count}</td>
                {!hideTotals && <td className={`whitespace-nowrap px-3 py-[11px] text-right text-[13.5px] font-bold tabular-nums ${cu.strong}`}>{spentCell(l)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className={cu.page}>
      {back}

      {/* Who */}
      <div className={`${cardCls} mb-4 px-6 py-5`}>
        <div className="flex flex-wrap items-center gap-[18px]">
          <span aria-hidden="true" className="flex h-[58px] w-[58px] flex-none items-center justify-center rounded-[16px] bg-[#FCEEEE] text-[22px] font-extrabold text-[#DC2A2A] dark:bg-red-900/30 dark:text-red-300">
            {nameInitials(c.name)}
          </span>
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[25px] font-extrabold tracking-[-.02em] text-[#1F2430] dark:text-slate-100">{c.name?.trim() || 'No name'}</h1>
              <span
                data-testid="source-pill"
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${CUSTOMER_SOURCE_BADGE[source] ?? CUSTOMER_SOURCE_BADGE.pos} ${CUSTOMER_SOURCE_BORDER[source] ?? CUSTOMER_SOURCE_BORDER.pos}`}
              >
                {customerSourceLabel(source)}
              </span>
              <span data-testid="status-pill" className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${STATUS_PILL[status.key]}`}>
                {statusText(status, stats.last_order_at)}
              </span>
            </div>
          </div>
          <div className="flex flex-none flex-wrap gap-[9px]">
            {canViewOrders && (
              <Link to={customerOrdersPath(who)} className={cu.btnOutline}>Orders</Link>
            )}
            <button type="button" onClick={() => setShowVouchers(true)} className={cu.btnOutline}>Vouchers</button>
            {canEdit && <button type="button" onClick={() => setShowEdit(true)} className={cu.btnPrimary}>Edit</button>}
          </div>
        </div>

        <dl className="mt-[18px] grid gap-3 border-t border-[#F1F2F5] pt-[18px] sm:grid-cols-2 dark:border-slate-700">
          <Contact testId="contact-phone" icon={<PhoneIcon />} label="Phone" value={formatPhone(c.phone)} />
          <Contact
            testId="contact-registered"
            icon={<CalendarIcon />}
            label="Registered"
            value={formatDay(c.createdAt)}
            sub={[registeredAgo, `via ${customerSourceLabel(source)}`].filter(Boolean).join(' · ')}
          />
        </dl>
      </div>

      {/* Figures */}
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
        <Kpi
          label="Completed orders"
          value={stats.completed_count}
          sub={stats.cancelled_count > 0 ? `of ${finished} finished orders` : 'finished orders'}
        />
        <Kpi
          label="Cancelled orders"
          value={stats.cancelled_count}
          valueCls={stats.cancelled_count > 0 ? cu.danger : cu.strong}
          sub={stats.cancelled_count > 0 ? `${Math.round((stats.cancelled_count / finished) * 100)}% of finished orders` : 'none cancelled'}
        />
        {!hideTotals && <Kpi label="Spent" value={stats.spent != null ? formatRs(stats.spent) : '—'} sub="Completed orders only" />}
        <Kpi
          label="Last order"
          value={stats.last_order_at ? formatDay(stats.last_order_at) : 'Never'}
          sub={stats.last_order_at ? daysAgoLabel(stats.last_order_at) : 'no completed order yet'}
          subCls={stats.last_order_at ? STATUS_TEXT[status.key] : undefined}
        />
        <Kpi
          label="First order"
          value={stats.first_order_at ? formatDay(stats.first_order_at) : '—'}
          sub={stats.first_order_at ? daysAgoLabel(stats.first_order_at) : 'no completed order yet'}
        />
      </div>

      {/* Where they order */}
      <div className={`${cardCls} mb-4 overflow-hidden`}>
        <div className="px-[22px] pb-3.5 pt-[18px]">
          <h2 className={titleCls}>Where they order</h2>
          <p className={`mt-[3px] text-[12.5px] ${cu.muted}`}>
            One line per brand &amp; branch · finished orders only — an order still in progress is not counted yet.
            {canViewOrders ? ' Click a number to open those orders.' : ''}
          </p>
        </div>
        {c.breakdown.length === 0 ? (
          <p className={`border-t border-[#F1F2F5] px-[22px] py-5 text-[13px] dark:border-slate-700 ${cu.muted}`}>No finished orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse" data-testid="customer-breakdown">
              <thead>
                <tr className="border-y border-[#F1F2F5] bg-[#FBFBFC] dark:border-slate-700 dark:bg-slate-900/40">
                  <th scope="col" className={`px-1.5 py-2.5 pl-[22px] text-left ${cu.label}`}>Brand</th>
                  <th scope="col" className={`px-1.5 py-2.5 text-left ${cu.label}`}>Branch</th>
                  <th scope="col" className={`px-1.5 py-2.5 text-right ${cu.label}`}>Completed</th>
                  <th scope="col" className={`px-1.5 py-2.5 text-right ${cu.label}`}>Cancelled</th>
                  {!hideTotals && <th scope="col" className={`px-1.5 py-2.5 text-right ${cu.label}`}>Spent</th>}
                  <th scope="col" className={`px-1.5 py-2.5 pl-6 text-left ${cu.label}`}>Last order</th>
                  {canViewOrders && <th scope="col" className={`px-1.5 py-2.5 pr-[22px] text-right ${cu.label}`}>Orders</th>}
                </tr>
              </thead>
              <tbody>
                {c.breakdown.map((l) => {
                  const narrow = { brandId: l.brand_id ?? null, branchId: l.branch_id ?? null };
                  return (
                    <tr key={`${l.brand_id ?? 'x'}-${l.branch_id ?? 'x'}`} className={cu.row}>
                      <td className={`whitespace-nowrap px-1.5 py-3 pl-[22px] text-[13.5px] font-bold ${cu.strong}`}>{l.brand_name ?? '—'}</td>
                      <td className={`px-1.5 py-3 text-[13px] ${cu.soft}`}>{l.branch_name ?? '—'}</td>
                      <td className="px-1.5 py-3 text-right text-[13.5px] tabular-nums">{countLink(l.completed_count, 'completed', narrow)}</td>
                      <td className="px-1.5 py-3 text-right text-[13.5px] tabular-nums">{countLink(l.cancelled_count, 'cancelled', narrow)}</td>
                      {!hideTotals && <td className={`whitespace-nowrap px-1.5 py-3 text-right text-[13.5px] font-bold tabular-nums ${cu.strong}`}>{spentCell(l)}</td>}
                      <td className={`whitespace-nowrap px-1.5 py-3 pl-6 text-[13px] ${cu.text}`}>
                        {l.last_order_at ? formatDay(l.last_order_at) : <span className={cu.faint}>—</span>}
                      </td>
                      {canViewOrders && (
                        <td className="px-1.5 py-3 pr-[22px] text-right">
                          <Link
                            to={customerOrdersPath(who, narrow)}
                            className="inline-block whitespace-nowrap rounded-[8px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-[7px] text-[12px] font-semibold text-[#374151] hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            View all
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Points */}
      <div className={`${cardCls} mb-4 px-[22px] py-[18px]`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1">
          <h2 className={`whitespace-nowrap ${titleCls}`}>Loyalty points</h2>
          <div className="whitespace-nowrap" data-testid="points-total">
            <span className={`text-[20px] font-black tabular-nums ${cu.strong}`}>{formatPoints(totalPoints)}</span>{' '}
            <span className="text-[12px] text-[#9AA1AD] dark:text-slate-400">pts total</span>
          </div>
        </div>
        <div className="mt-3.5">
          <LoyaltyWalletList wallets={c.loyaltyWallets} />
        </div>
        <div className="mt-3.5 flex items-start gap-2 border-t border-[#F1F2F5] pt-[13px] dark:border-slate-700">
          <span aria-hidden="true" className="mt-px flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full bg-[#EEF0F3] text-[10px] font-bold text-[#8A92A0] dark:bg-slate-700 dark:text-slate-300">i</span>
          <p className={`text-[12px] leading-[1.5] ${cu.muted}`}>
            POS points belong to one brand and are spent on its POS &amp; call-centre orders. App points are one shared balance for mobile app orders.
          </p>
        </div>
      </div>

      {/* How they order */}
      <div className={`${cardCls} px-[22px] pb-5 pt-[18px]`}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-x-[34px] gap-y-5">
          {mixTable('By order type', 'Type', c.by_order_type, (l) => formatOrderType(l.order_type))}
          {mixTable('By channel', 'Channel', c.by_source, (l) => orderSourceLabel(l.source))}
        </div>
      </div>

      <CustomerVouchersModal customer={showVouchers ? who : null} onClose={() => setShowVouchers(false)} />
      <CustomerFormModal isOpen={showEdit} customer={who} onClose={() => setShowEdit(false)} />
    </div>
  );
};

export default CustomerDetail;
