import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useViewport } from '../hooks/useViewport';

export interface FilterChip {
  key: string;
  label: string;
  /** Tapping the chip removes this filter (shown with a ✕). */
  onRemove?: () => void;
  /** A shortcut rather than an applied filter (e.g. "Needs rider 3"): tapping applies it. */
  onSelect?: () => void;
  tone?: 'default' | 'alert';
}

export interface FilterField {
  key: string;
  /** Section heading in the sheet. */
  label?: string;
  node: React.ReactNode;
}

export interface FilterBarProps {
  /** Desktop (≥ 1024px) renders exactly this — the page's own filter markup, untouched. */
  children: React.ReactNode;
  /** Below lg: stays on screen beside the Filters button (e.g. the search box). */
  primary?: React.ReactNode;
  /** Below lg: what is applied, as removable chips (plus optional shortcut chips). */
  chips?: FilterChip[];
  /** The sheet's sections, top to bottom. They hold the page's own controls and state. */
  fields: FilterField[];
  /** "Clear all" in the sheet. Omit to hide it. */
  onClearAll?: () => void;
  /** Sheet button, e.g. "Show 15 orders". Filters apply as they change; the button just closes. */
  resultLabel?: string;
  /** Badge on the Filters button. Defaults to the number of removable chips. */
  activeCount?: number;
  /** Wrapper spacing below lg. */
  className?: string;
}

const FilterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);

/**
 * Filters for phones and tablets: a one-row bar (primary control + "Filters (n)" button + the
 * applied filters as chips) that opens a bottom sheet with every control full width. Desktop
 * renders `children` — the page's existing filter markup — and nothing else.
 */
const FilterBar: React.FC<FilterBarProps> = ({
  children,
  primary,
  chips = [],
  fields,
  onClearAll,
  resultLabel,
  activeCount,
  className = 'mb-4',
}) => {
  const { isDesktop, isPhone } = useViewport();
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Desktop never shows the sheet; a rotation past lg closes it.
  useEffect(() => {
    if (isDesktop) setOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const opener = openerRef.current;
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  if (isDesktop) return <>{children}</>;

  const applied = chips.filter((c) => c.onRemove);
  const count = activeCount ?? applied.length;

  const chipList = chips.map((c) =>
        c.onRemove ? (
          <button
            key={c.key}
            type="button"
            onClick={c.onRemove}
            aria-label={`Remove filter: ${c.label}`}
            className="inline-flex min-h-[38px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] border-red-200 bg-red-50 px-3.5 text-[13px] font-bold text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300"
          >
            {c.label}
            <span aria-hidden className="text-[15px] leading-none">✕</span>
          </button>
        ) : !c.onSelect ? (
          // Context, not a filter you can drop (e.g. the kitchen's branch): a plain label.
          <span
            key={c.key}
            className="inline-flex min-h-[38px] flex-none items-center whitespace-nowrap rounded-full border-[1.5px] border-gray-200 bg-gray-50 px-3.5 text-[13px] font-bold text-gray-600 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
          >
            {c.label}
          </span>
        ) : (
          <button
            key={c.key}
            type="button"
            onClick={c.onSelect}
            className={`inline-flex min-h-[38px] flex-none items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-3.5 text-[13px] font-bold ${
              c.tone === 'alert'
                ? 'border-red-600 bg-white text-red-700 dark:bg-slate-800 dark:text-red-300'
                : 'border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {c.tone === 'alert' && <span aria-hidden className="h-2 w-2 rounded-full bg-red-600" />}
            {c.label}
          </button>
        ),
  );

  const filtersButton = (
    <button
      ref={openerRef}
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="inline-flex min-h-[44px] flex-none items-center gap-2 rounded-xl border-[1.5px] border-gray-200 bg-white px-3.5 text-[14px] font-bold text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
    >
      <FilterIcon />
      Filters
      {count > 0 && (
        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11.5px] font-extrabold text-white">
          {count}
        </span>
      )}
    </button>
  );

  // Same motion as Modal: the backdrop fades; on phones the sheet slides up from the bottom
  // edge, on tablets it rises a little and fades. The positioning wrapper is static so the
  // tablet centring (translate-x) is never fought over with the animated transform.
  const panelMotion = isPhone
    ? { initial: { y: '100%' }, animate: { y: '0%' }, exit: { y: '100%' } }
    : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 24 } };
  const sheet = createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            className="absolute inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 flex sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[min(560px,calc(100%-2rem))] sm:-translate-x-1/2">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              className="flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:rounded-2xl"
              {...panelMotion}
              transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="flex-none pt-2 sm:hidden" aria-hidden>
                <div className="mx-auto h-1 w-10 rounded-full bg-gray-300 dark:bg-slate-600" />
              </div>
              <div className="flex flex-none items-center justify-between gap-3 px-4 pt-2">
                <h2 className="text-[17px] font-extrabold text-gray-900 dark:text-slate-50">Filters</h2>
                <div className="flex items-center gap-1">
                  {onClearAll && (
                    <button
                      type="button"
                      onClick={onClearAll}
                      className="min-h-[44px] px-2 text-[13.5px] font-bold text-red-600 dark:text-red-400"
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close filters"
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
                {fields.map((f) => (
                  <section key={f.key} className="border-b border-gray-100 py-3 last:border-0 dark:border-slate-700">
                    {f.label && (
                      <div className="mb-2 text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-gray-400 dark:text-slate-500">
                        {f.label}
                      </div>
                    )}
                    {/* Native controls go full width and 44px tall in the sheet. */}
                    <div className="filter-sheet-fields [&_select]:min-h-[44px] [&_select]:w-full [&_input[type=date]]:min-h-[44px] [&_input[type=time]]:min-h-[44px]">
                      {f.node}
                    </div>
                  </section>
                ))}
              </div>
              <div className="flex-none border-t border-gray-100 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-[48px] w-full rounded-xl text-[15px] font-extrabold text-white !bg-[linear-gradient(90deg,#000000_0%,#B91C1C_50%,#000000_100%)]"
                >
                  {resultLabel ?? 'Show results'}
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );

  return (
    <div className={className}>
      {/* Chips wrap rather than scroll: one pushed off-screen could not be seen or tapped. */}
      {primary ? (
        <>
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">{primary}</div>
            {filtersButton}
          </div>
          {chips.length > 0 && <div className="mt-2.5 flex flex-wrap gap-2">{chipList}</div>}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {filtersButton}
          {chipList}
        </div>
      )}
      {sheet}
    </div>
  );
};

export default FilterBar;
