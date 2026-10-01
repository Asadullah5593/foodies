/**
 * The look of the Customers module — the table and the customer profile — as
 * class strings, so the two pages stay one design. Light values are the
 * design's own; each carries a dark-mode counterpart, which the design does
 * not cover but the app's theme switch requires.
 */
const label = 'text-[10.5px] font-bold uppercase tracking-[.06em] text-[#9AA1AD] dark:text-slate-400';

export const cu = {
  page: 'w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8',
  card: 'border border-[#ECEDF0] bg-white shadow-[0_6px_18px_rgba(15,23,42,.04)] dark:border-slate-700 dark:bg-slate-800',
  strong: 'text-[#20242C] dark:text-slate-100',
  text: 'text-[#374151] dark:text-slate-200',
  soft: 'text-[#5A6473] dark:text-slate-300',
  muted: 'text-[#8A92A0] dark:text-slate-400',
  faint: 'text-[#C7CCD6] dark:text-slate-600',
  danger: 'text-[#DC2A2A] dark:text-red-400',
  good: 'text-[#16A34A] dark:text-emerald-400',
  warn: 'text-[#B45309] dark:text-amber-400',
  label,
  /** A text input or select, as in the filters. */
  input:
    'w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2.5 text-[13.5px] text-[#1F2430] outline-none placeholder:text-[#A9AFB9] focus:border-[#DC2A2A] focus:ring-[3px] focus:ring-[#DC2A2A]/[.12] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500',
  fieldLabel: 'mb-1.5 block text-[11px] font-bold uppercase tracking-[.05em] text-[#9AA1AD] dark:text-slate-400',
  btnPrimary:
    'whitespace-nowrap rounded-[11px] bg-[#DC2A2A] px-[18px] py-[11px] text-[13.5px] font-bold text-white hover:bg-[#C21F1F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2A2A]/40',
  btnOutline:
    'whitespace-nowrap rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-4 py-[11px] text-[13.5px] font-semibold text-[#374151] hover:bg-[#F3F4F6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2A2A]/40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  /** Table header / body cells: 14px between columns, 20px at the edges. */
  th: `whitespace-nowrap px-[7px] py-3 text-left first:pl-5 last:pr-5 ${label}`,
  td: 'px-[7px] py-3 align-middle first:pl-5 last:pr-5',
  headRow: 'border-b border-[#F1F2F5] bg-[#FBFBFC] dark:border-slate-700 dark:bg-slate-900/40',
  row: 'border-b border-[#F4F5F7] last:border-b-0 dark:border-slate-700/70',
  /** Links inside a card: the brand red. */
  link: 'font-extrabold text-[#DC2A2A] hover:text-[#B5121B] hover:underline dark:text-red-400 dark:hover:text-red-300',
} as const;

/** Colour of a "N days ago" line, by how long ago the last order was. */
export const STATUS_TEXT = {
  active: cu.good,
  lapsing: 'text-[#9AA1AD] dark:text-slate-400',
  lapsed: cu.warn,
  never: 'text-[#B6BCC6] dark:text-slate-500',
} as const;

/** The profile's status pill, by the same rule. */
export const STATUS_PILL = {
  active: 'border-[#CDEBD6] bg-[#EAF7EE] text-[#16A34A] dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  lapsing: 'border-[#E2E5EA] bg-[#F1F2F5] text-[#5A6473] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300',
  lapsed: 'border-[#FBE4B8] bg-[#FFF6E6] text-[#B45309] dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  never: 'border-[#E2E5EA] bg-[#F1F2F5] text-[#5A6473] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300',
} as const;
