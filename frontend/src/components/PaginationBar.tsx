import React, { useState } from 'react';

export const DEFAULT_PAGE_SIZE = 10;

export type PaginationBarProps = {
  /** Total number of items (before slicing) */
  totalCount: number;
  /** 1-based current page */
  page: number;
  /** Items per page */
  pageSize?: number;
  /** Called when user changes page */
  onPageChange: (page: number) => void;
  /** Optional label for items (e.g. "orders") */
  itemLabel?: string;
  /** Optional className for the container */
  className?: string;
  /** Selectable rows-per-page values. Pass with onPageSizeChange to show the "Show N entries" picker. */
  pageSizeOptions?: number[];
  /** Called when the user picks a different rows-per-page value. */
  onPageSizeChange?: (size: number) => void;
};

const btnCls =
  'px-3 py-1.5 rounded-lg text-sm font-semibold text-white border border-transparent disabled:opacity-50 disabled:cursor-not-allowed !bg-[linear-gradient(90deg,#000000_0%,#B91C1C_50%,#000000_100%)] hover:brightness-110 active:brightness-95 transition-all';

const PaginationBar: React.FC<PaginationBarProps> = ({
  totalCount,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
  itemLabel = 'items',
  className = '',
  pageSizeOptions,
  onPageSizeChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPager = totalCount > pageSize;
  // The picker stays visible even on a single page — otherwise choosing a large
  // size would hide the control and strand the user unable to go back down.
  const showSizer = !!(pageSizeOptions?.length && onPageSizeChange);
  const [jump, setJump] = useState('');

  if (!showPager && !showSizer) return null;

  const goToJump = () => {
    const n = Math.floor(Number(jump));
    if (!Number.isFinite(n) || n < 1) return;
    const target = Math.min(totalPages, Math.max(1, n));
    if (target !== page) onPageChange(target);
    setJump('');
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-2 py-4 mt-4 border-t border-foodies-border ${className}`}
      role="navigation"
      aria-label="Pagination"
    >
      {showSizer && (
        <div className="flex items-center gap-1.5 mr-auto">
          <span className="text-sm text-foodies-textSecondary">Show</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange!(Number(e.target.value))}
            aria-label="Entries per page"
            className="rounded-lg border border-foodies-border bg-white px-2 py-1.5 text-sm text-foodies-textPrimary outline-none cursor-pointer focus:border-red-500 dark:bg-slate-700 dark:text-slate-100"
          >
            {pageSizeOptions!.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
          <span className="text-sm text-foodies-textSecondary">entries</span>
        </div>
      )}

      {showPager && (
        <>
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className={btnCls}
            aria-label="Previous page"
          >
            ← Prev
          </button>
          <span className="text-sm text-foodies-textSecondary px-2">
            Page {page} of {totalPages}{' '}
            <span className="text-foodies-textPrimary">({totalCount} {itemLabel})</span>
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className={btnCls}
            aria-label="Next page"
          >
            Next →
          </button>

          {/* Jump straight to a page — handy when there are many pages. */}
          {totalPages > 2 && (
            <form
              className="flex items-center gap-1.5 ml-1"
              onSubmit={(e) => {
                e.preventDefault();
                goToJump();
              }}
            >
              <span className="text-sm text-foodies-textSecondary">Go to</span>
              <input
                type="number"
                inputMode="numeric"
                value={jump}
                onChange={(e) => setJump(e.target.value)}
                placeholder={String(page)}
                aria-label={`Go to page (1 to ${totalPages})`}
                title={`Enter a page between 1 and ${totalPages}`}
                className="w-16 rounded-lg border border-foodies-border bg-white px-2 py-1.5 text-sm text-center text-foodies-textPrimary outline-none focus:border-red-500 dark:bg-slate-700 dark:text-slate-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button type="submit" className={btnCls} aria-label="Go to page">
                Go
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
};

export default PaginationBar;
