import React, { useState } from 'react';
import { MdSearch } from 'react-icons/md';
import { adminService } from '../services/api/adminService';
import { formatCurrency } from '../utils/currency';

type LookupResult = Awaited<ReturnType<typeof adminService.lookupBankCardBin>>;
type LookupMatch = LookupResult['matches'][number];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "10% off (up to Rs. 500, min Rs. 1,000)" / "Rs. 200 off". */
function offerSummary(m: LookupMatch): string {
  if (!m.has_offer || m.discount_value == null) return '';
  const base =
    m.discount_type === 'percentage'
      ? `${Number(m.discount_value)}% off`
      : `${formatCurrency(Number(m.discount_value))} off`;
  const caveats: string[] = [];
  if (m.discount_type === 'percentage' && m.max_discount_amount != null)
    caveats.push(`up to ${formatCurrency(Number(m.max_discount_amount))}`);
  if (m.min_order_amount != null) caveats.push(`min order ${formatCurrency(Number(m.min_order_amount))}`);
  return caveats.length ? `${base} (${caveats.join(', ')})` : base;
}

/** Human text for the offer's recurring window, e.g. "Mon, Tue · 12:00–15:00". */
function scheduleText(m: LookupMatch): string {
  const parts: string[] = [];
  if (m.valid_days_of_week?.length) parts.push(m.valid_days_of_week.map((d) => DAY_NAMES[d] ?? d).join(', '));
  if (m.valid_time_start || m.valid_time_end) {
    const t = (v: string | null) => (v ? v.slice(0, 5) : '…');
    parts.push(`${t(m.valid_time_start)}–${t(m.valid_time_end)}`);
  }
  return parts.join(' · ');
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

/**
 * "Does the customer's card have a discount?" — the cashier types the first
 * digits (BIN) of the card and gets a yes/no with the offer's terms. Used on
 * the Bank Cards admin page and inside the POS payment panel. `branchId`
 * (when known, e.g. at POS) evaluates time-of-day windows in branch time.
 */
const BankCardBinLookup: React.FC<{ branchId?: number | null; compact?: boolean }> = ({
  branchId = null,
  compact = false,
}) => {
  const [bin, setBin] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSearch = bin.length >= 4 && !loading;

  const search = async () => {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await adminService.lookupBankCardBin(bin, branchId));
    } catch (e) {
      setResult(null);
      setError(
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
          'Lookup failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const matchRow = (m: LookupMatch) => {
    const summary = offerSummary(m);
    const schedule = scheduleText(m);
    const until = m.valid_until ? `till ${fmtDate(m.valid_until)}` : '';
    let badge: React.ReactNode;
    if (!m.has_offer) {
      badge = (
        <span className="rounded-md bg-gray-200 px-2 py-0.5 text-[11px] font-bold text-gray-600 dark:bg-slate-600 dark:text-slate-200">
          NO DISCOUNT
        </span>
      );
    } else if (m.available_now === true) {
      badge = (
        <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
          DISCOUNT AVAILABLE
        </span>
      );
    } else if (m.available_now === false) {
      badge = (
        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
          HAS DISCOUNT — NOT AVAILABLE NOW
        </span>
      );
    } else {
      badge = (
        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-200">
          DISCOUNT — CHECK WINDOW
        </span>
      );
    }
    return (
      <div
        key={m.id}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
      >
        <span className="font-semibold text-gray-800 dark:text-slate-100">
          {m.bank ? `${m.bank} — ${m.name}` : m.name}
        </span>
        <span className="text-xs text-gray-400">BIN {m.matched_prefix}</span>
        {badge}
        {summary && <span className="text-sm text-gray-700 dark:text-slate-200">{summary}</span>}
        {(schedule || until) && (
          <span className="text-xs text-gray-500 dark:text-slate-400">{[schedule, until].filter(Boolean).join(' · ')}</span>
        )}
      </div>
    );
  };

  const inputEl = (
    <input
      value={bin}
      onChange={(e) => {
        setBin(e.target.value.replace(/\D/g, '').slice(0, 8));
        setResult(null);
        setError(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void search();
        }
      }}
      inputMode="numeric"
      placeholder="First 6–8 digits, e.g. 455670"
      aria-label="Card BIN"
      className={
        compact
          ? 'w-full max-w-[220px] rounded-xl border-2 border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-red-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100'
          : 'w-full rounded-[10px] border-[1.5px] border-gray-200 bg-white px-[13px] py-[11px] text-sm text-gray-800 outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/10'
      }
    />
  );

  const buttonEl = (
    <button
      type="button"
      onClick={() => void search()}
      disabled={!canSearch}
      className={
        compact
          ? 'rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white'
          : 'flex-none rounded-[10px] bg-red-600 px-5 py-[11px] text-[13.5px] font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300'
      }
    >
      {loading ? 'Checking…' : 'Check'}
    </button>
  );

  const results = (
    <>
      {error && <p className="mt-2 w-full text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 w-full space-y-2">
          {result.matches.length === 0 ? (
            <p className="text-sm font-medium text-gray-600 dark:text-slate-300">
              No card matches BIN {result.bin} — <span className="font-bold">no discount</span>.
            </p>
          ) : (
            result.matches.map(matchRow)
          )}
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <div>
        <div className="flex gap-2">
          {inputEl}
          {buttonEl}
        </div>
        {results}
      </div>
    );
  }

  // Full variant: one inline bar — what it's for on the left, the field and the
  // Check button to the right, matches listed underneath.
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-2xl border border-gray-200 bg-white px-[18px] py-3.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-gray-100 text-gray-500">
        <MdSearch size={18} />
      </span>
      <div className="flex-none">
        <div className="text-[13.5px] font-bold text-gray-800">Check a customer&apos;s card</div>
        <div className="text-[12px] text-gray-400">Enter the first digits (BIN) to see which card it matches</div>
      </div>
      <div className="min-w-[220px] max-w-[340px] flex-1">{inputEl}</div>
      {buttonEl}
      {results}
    </div>
  );
};

export default BankCardBinLookup;
