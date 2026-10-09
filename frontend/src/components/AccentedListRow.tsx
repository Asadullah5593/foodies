import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useViewport } from '../hooks/useViewport';

export type AccentVariant = 'active' | 'inactive';

export interface AccentedListRowProps {
  /** Color of the left accent bar */
  accent: AccentVariant;
  /** Optional image URL for avatar (full URL; fallback to initial on error) */
  imageUrl?: string | null;
  /** Fallback letter when no image or image fails */
  initial: string;
  /** Main title (e.g. name) */
  title: string;
  /** Optional subtitle or extra lines (string or ReactNode) */
  subtitle?: React.ReactNode;
  /** Status pill label (e.g. "active") — hidden on small screens if provided; used when order/delivery not provided */
  statusLabel?: string;
  /** Order status shown as "Order: X" when provided */
  orderStatusLabel?: string;
  /** Delivery status shown as "Delivery: X" when provided */
  deliveryStatusLabel?: string;
  /** Style for status pill(s) */
  statusVariant?: AccentVariant;
  /**
   * Optional value rendered in its own fixed-width column between the text
   * block and the actions, so it lines up down the list instead of being
   * another line inside the subtitle (e.g. the Customers page's source badge).
   * Omitted by every other list, which keeps their layout unchanged.
   */
  meta?: React.ReactNode;
  /**
   * Action buttons or links (e.g. Edit, Delete). Below lg the FIRST one is the card's own
   * full-width button and the rest open from a ⋯ sheet, so order them primary-first.
   */
  actions: React.ReactNode;
  /** Below lg only: extra status chips beside the status pill, under the title (e.g. "Online open"). Desktop ignores it. */
  chips?: React.ReactNode;
  /** Below lg only: shown on the card in place of `subtitle` (e.g. a label / value grid). Desktop ignores it. */
  mobileSubtitle?: React.ReactNode;
  /** Index for stagger animation delay */
  animationIndex?: number;
  /** Optional content below the row (e.g. sub-list); renders inside same card with border-t */
  footer?: React.ReactNode;
}

const accentBarClass: Record<AccentVariant, string> = {
  active: 'bg-emerald-500 dark:bg-emerald-500',
  inactive: 'bg-rose-500 dark:bg-rose-500',
};

/**
 * A one-line row whose title column would get less than this switches to the two-line layout
 * (the phone/tablet one) at any screen width. With the sidebar open, laptop and iPad-landscape
 * widths (1024–1279px) squeezed rows with 5–6 actions until the name was 0px wide.
 */
const MIN_TITLE_WIDTH = 220;
// One-line layout from sm up: 1px borders + accent bar 8 + gap 24 + avatar 64 + gap 24
// | title | gap 24 + [meta 128 + gap 24] + right block (status + 12 + actions) + right padding 24.
const ONE_LINE_FIXED = 2 + 8 + 24 + 64 + 24 + 24 + 24;
const META_COLUMN = 128 + 24;

/** True for null / false / '' / an empty fragment — e.g. Deliveries passes `actions={<></>}`. */
const isEmptyNode = (node: React.ReactNode): boolean => {
  if (node == null || node === false || node === '') return true;
  if (React.isValidElement(node) && node.type === React.Fragment) {
    return React.Children.toArray((node.props as { children?: React.ReactNode }).children).length === 0;
  }
  return false;
};

/**
 * The action nodes a page passes, flattened through nested fragments (pages often wrap a permission
 * group in its own `<>…</>`), re-keyed by position so the card and its sheet can render them apart.
 */
const flattenActions = (node: React.ReactNode): React.ReactNode[] =>
  React.Children.toArray(node)
    .flatMap((child) =>
      React.isValidElement(child) && child.type === React.Fragment
        ? flattenActions((child.props as { children?: React.ReactNode }).children)
        : [child],
    )
    .map((child, i) => (React.isValidElement(child) ? React.cloneElement(child, { key: `action-${i}` }) : child));

/** Below lg the accent is the card's own left border (spans the wrapped row). */
const accentBorderClass: Record<AccentVariant, string> = {
  active: 'border-l-emerald-500 hover:border-l-emerald-500 dark:border-l-emerald-500 dark:hover:border-l-emerald-500',
  inactive: 'border-l-rose-500 hover:border-l-rose-500 dark:border-l-rose-500 dark:hover:border-l-rose-500',
};

const statusPillClass: Record<AccentVariant, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  inactive: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
};

const statusDotClass: Record<AccentVariant, string> = {
  active: 'bg-emerald-500',
  inactive: 'bg-rose-500',
};

const AvatarImage: React.FC<{ imageUrl?: string | null; initial: string; compact?: boolean }> = ({
  imageUrl,
  initial,
  compact = false,
}) => {
  const [isLoading, setIsLoading] = useState(Boolean(imageUrl));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setIsLoading(Boolean(imageUrl));
    setHasError(false);
  }, [imageUrl]);

  const showImage = Boolean(imageUrl) && !hasError;
  const showInitial = !showImage || (!isLoading && hasError);

  return (
    <div className={`relative flex-shrink-0 ${compact ? 'w-[46px] h-[46px] rounded-xl' : 'w-14 h-14 sm:w-16 sm:h-16 rounded-2xl'} bg-gray-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden ring-2 ring-white dark:ring-slate-800 shadow-sm`}>
      {showInitial && (
        <span className={`${compact ? 'text-base' : 'text-xl sm:text-2xl'} font-bold text-gray-500 dark:text-slate-400 uppercase tracking-tight`}>
          {initial}
        </span>
      )}
      {showImage && (
        <>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-slate-700">
              <div
                className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-transparent dark:border-slate-500 dark:border-t-transparent animate-spin"
                aria-label="Loading image"
              />
            </div>
          )}
          <img
            src={imageUrl as string}
            alt=""
            className={`absolute inset-0 w-full h-full object-contain p-1.5 bg-gray-100 dark:bg-slate-700 transition-opacity duration-150 ${
              isLoading ? 'opacity-0' : 'opacity-100'
            }`}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setHasError(true);
            }}
          />
        </>
      )}
    </div>
  );
};

/**
 * Single row for accented list layout: left bar, avatar (image or initial), title, subtitle, status pill, actions.
 * Use inside AccentedList for consistent layout and animation.
 */
export const AccentedListRow: React.FC<AccentedListRowProps> = ({
  accent,
  imageUrl,
  initial,
  title,
  subtitle,
  statusLabel,
  orderStatusLabel,
  deliveryStatusLabel,
  statusVariant = accent,
  meta,
  actions,
  chips,
  mobileSubtitle,
  animationIndex = 0,
  footer,
}) => {
  // Below lg the row is a card: a small avatar, the title with its status chips and a ⋯ button on
  // the first line, the details under them, and ONE full-width action — the rest of the page's
  // buttons open from a bottom sheet. Desktop (≥ lg) keeps its one-line row, and its own
  // too-narrow fallback (`stacked`), with the original class strings untouched.
  const { isDesktop, isPhone } = useViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasMeta = meta != null && meta !== '';
  // Desktop rows stack only when their own one-line layout would leave the title too little
  // room — measured from this row's real buttons, so rows that fit are left exactly as they were.
  const rowRef = useRef<HTMLLIElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [tooNarrow, setTooNarrow] = useState(false);
  const measureRef = useRef<() => void>(() => undefined);
  measureRef.current = () => {
    const li = rowRef.current;
    // Not laid out yet (hidden, or a test DOM with no layout): nothing to measure.
    if (!li || !isDesktop || li.offsetWidth === 0) return;
    const acts = actionsRef.current;
    const kids = acts ? (Array.from(acts.children) as HTMLElement[]) : [];
    const actionsWidth = kids.reduce((w, k) => w + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * 8;
    const statusWidth = statusRef.current && statusRef.current.offsetWidth > 0 ? statusRef.current.offsetWidth + 12 : 0;
    const titleRoom = li.offsetWidth - ONE_LINE_FIXED - (hasMeta ? META_COLUMN : 0) - statusWidth - actionsWidth;
    setTooNarrow(titleRoom < MIN_TITLE_WIDTH);
  };
  // Every render (labels such as Set active / Set inactive change button widths) …
  useLayoutEffect(() => measureRef.current());
  // … and whenever the row is resized (window, sidebar collapse).
  useEffect(() => {
    if (!isDesktop || typeof ResizeObserver === 'undefined' || !rowRef.current) return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [isDesktop]);
  const card = !isDesktop;
  const stacked = isDesktop && tooNarrow;
  const compact = stacked || card;
  // Card pills are small rounded chips; the desktop pill string is the original one.
  const pillShape = card ? 'px-2 py-[3px] rounded-full text-[11px] font-bold capitalize' : 'px-2.5 py-1 rounded-md text-xs font-medium';
  // Second line starts under the title: avatar (56px / 64px from sm) + the 12px gap.
  const indent = isPhone ? 'pl-[4.25rem]' : 'pl-[4.75rem]';

  const showDualStatus = orderStatusLabel != null || deliveryStatusLabel != null;
  const statusContent = showDualStatus ? (
    <span ref={statusRef} className={`${compact ? 'flex' : 'hidden sm:flex'} items-center gap-2 flex-wrap`}>
      {orderStatusLabel != null && orderStatusLabel !== '' && (
        <span className={`inline-flex items-center gap-1.5 ${pillShape} ${statusPillClass[statusVariant]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass[statusVariant]}`} />
          Order: {orderStatusLabel}
        </span>
      )}
      {deliveryStatusLabel != null && deliveryStatusLabel !== '' && (
        <span className={`inline-flex items-center gap-1.5 ${pillShape} ${statusPillClass[statusVariant]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass[statusVariant]}`} />
          Delivery: {deliveryStatusLabel}
        </span>
      )}
    </span>
  ) : statusLabel != null && statusLabel !== '' ? (
    <span ref={statusRef} className={`${compact ? 'inline-flex' : 'hidden sm:inline-flex'} items-center gap-1.5 ${pillShape} ${statusPillClass[statusVariant]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass[statusVariant]}`} />
      {statusLabel}
    </span>
  ) : null;

  if (card) {
    // The page's buttons as given: the first stays on the card, the rest go to the sheet.
    const actionNodes = flattenActions(actions);
    const [primaryAction, ...moreActions] = actionNodes;
    const details = mobileSubtitle ?? subtitle;
    const panelMotion = isPhone
      ? { initial: { y: '100%' }, animate: { y: '0%' }, exit: { y: '100%' } }
      : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 24 } };
    const sheet = createPortal(
      <AnimatePresence>
        {sheetOpen && moreActions.length > 0 && (
          <div className="fixed inset-0 z-[60]">
            <motion.div
              className="absolute inset-0 bg-black/45"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSheetOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-x-0 bottom-0 flex sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[min(480px,calc(100%-2rem))] sm:-translate-x-1/2">
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={`Actions for ${title}`}
                className="w-full rounded-t-[20px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2.5 shadow-2xl dark:bg-slate-800 sm:rounded-2xl"
                {...panelMotion}
                transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-gray-300 dark:bg-slate-600 sm:hidden" aria-hidden />
                <div className="mb-1 truncate text-[14px] font-extrabold text-gray-900 dark:text-slate-50">{title}</div>
                {/* The page's own buttons laid out as rows (index.css .row-action-sheet). Any tap
                    closes the sheet; the button's own handler still runs. */}
                <div className="row-action-sheet flex flex-col" onClickCapture={() => setSheetOpen(false)}>
                  {moreActions}
                </div>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="mt-2 min-h-[48px] w-full rounded-xl bg-gray-100 text-[14px] font-bold text-gray-700 dark:bg-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>,
      document.body,
    );
    return (
      <motion.li
        ref={rowRef}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={{ delay: animationIndex * 0.04, duration: 0.25 }}
        className={`rounded-[14px] border border-l-4 border-gray-200/80 bg-white dark:border-slate-700/80 dark:bg-slate-800/80 ${accentBorderClass[accent]} overflow-hidden`}
        data-testid="list-card"
      >
        <div className="px-[13px] pb-3 pt-[13px]">
          <div className="flex items-start gap-3">
            <AvatarImage imageUrl={imageUrl} initial={initial} compact />
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-[15.5px] font-extrabold leading-tight text-gray-900 dark:text-slate-100" title={title}>
                {title}
              </h3>
              {(statusContent != null || (chips != null && chips !== '')) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {statusContent}
                  {chips}
                </div>
              )}
            </div>
            {moreActions.length > 0 && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`More actions for ${title}`}
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white text-[#5A6473] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
              >
                <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <circle cx="3.5" cy="8" r="1.4" />
                  <circle cx="8" cy="8" r="1.4" />
                  <circle cx="12.5" cy="8" r="1.4" />
                </svg>
              </button>
            )}
          </div>
          {details != null && details !== '' && (
            <div className="mt-2.5 text-[12px] text-gray-500 dark:text-slate-400 [&>p]:leading-tight">{details}</div>
          )}
          {hasMeta && <div className="mt-2 flex items-center">{meta}</div>}
          {primaryAction != null && (
            <div className="mt-3 flex [&>*]:min-h-[42px] [&>*]:w-full [&>*]:flex-1 [&>*]:rounded-[10px] [&>*]:border-[1.5px] [&>*]:border-[#E2E5EA] [&>*]:text-[13.5px] [&>*]:font-bold dark:[&>*]:border-slate-600">
              {primaryAction}
            </div>
          )}
        </div>
        {footer != null && footer !== '' && (
          <div className="border-t border-gray-100 dark:border-slate-600 bg-gray-50/50 dark:bg-slate-700/30">
            {footer}
          </div>
        )}
        {sheet}
      </motion.li>
    );
  }

  return (
    <motion.li
      ref={rowRef}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ delay: animationIndex * 0.04, duration: 0.25 }}
      className={`group rounded-xl bg-white dark:bg-slate-800/80 border border-gray-200/80 dark:border-slate-700/80 overflow-hidden hover:border-gray-300 dark:hover:border-slate-600 hover:shadow-md transition-all duration-200 ${footer ? 'flex flex-col' : ''}${
        stacked ? ` border-l-[6px] ${accentBorderClass[accent]}` : ''
      }`}
    >
      <div className={stacked ? 'flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3' : 'flex items-center gap-4 sm:gap-6 min-h-[4rem]'}>
        {!stacked && (
          <div
            className={`flex-shrink-0 w-1.5 sm:w-2 self-stretch min-h-[4rem] ${accentBarClass[accent]}`}
            aria-hidden
          />
        )}
        <AvatarImage imageUrl={imageUrl} initial={initial} />
        <div className={stacked ? 'flex-1 min-w-0' : 'flex-1 min-w-0 py-4'}>
          <h3
            className={`font-semibold text-gray-900 dark:text-slate-100 ${
              stacked ? 'text-base leading-snug line-clamp-2' : 'text-base sm:text-lg truncate'
            }`}
            title={title}
          >
            {title}
          </h3>
          {subtitle != null && subtitle !== '' && (
            <div className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 space-y-0.5 [&>p]:leading-tight">
              {subtitle}
            </div>
          )}
        </div>
        {hasMeta && (
          <div className={stacked ? `basis-full flex items-center ${indent}` : 'flex-shrink-0 w-24 sm:w-32 py-4 flex items-center'}>
            {meta}
          </div>
        )}
        {/* Stacked rows skip the second line entirely when it would be empty (no pill, no
            actions) — an empty flex line still adds the row gap below the title. */}
        {(!stacked || statusContent != null || !isEmptyNode(actions)) && (
          <div className={stacked ? `basis-full flex flex-wrap items-center gap-2 ${indent}` : 'flex-shrink-0 flex items-center gap-3 py-4 pr-4 sm:pr-6'}>
            {statusContent}
            <div ref={actionsRef} className={stacked ? 'flex flex-wrap gap-2' : 'flex gap-2'}>{actions}</div>
          </div>
        )}
      </div>
      {footer != null && footer !== '' && (
        <div className="border-t border-gray-100 dark:border-slate-600 bg-gray-50/50 dark:bg-slate-700/30">
          {footer}
        </div>
      )}
    </motion.li>
  );
};

export interface AccentedListProps {
  children: React.ReactNode;
  className?: string;
}

/** Wrapper for a list of AccentedListRow. Use with AnimatePresence when items can be removed. */
export const AccentedList: React.FC<AccentedListProps> = ({ children, className = '' }) => (
  <ul className={`space-y-3 list-none p-0 m-0 ${className}`}>{children}</ul>
);

export default AccentedListRow;
