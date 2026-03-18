import React from 'react';

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
};

const PaginationBar: React.FC<PaginationBarProps> = ({
  totalCount,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
  itemLabel = 'items',
  className = '',
}) => {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPagination = totalCount > pageSize;

  if (!showPagination) return null;

  return (
    <div
      className={`flex items-center justify-center gap-2 py-4 mt-4 border-t border-foodies-border ${className}`}
      role="navigation"
      aria-label="Pagination"
    >
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white border border-transparent disabled:opacity-50 disabled:cursor-not-allowed !bg-[linear-gradient(90deg,#000000_0%,#B91C1C_50%,#000000_100%)] hover:brightness-110 active:brightness-95 transition-all"
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
        className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white border border-transparent disabled:opacity-50 disabled:cursor-not-allowed !bg-[linear-gradient(90deg,#000000_0%,#B91C1C_50%,#000000_100%)] hover:brightness-110 active:brightness-95 transition-all"
        aria-label="Next page"
      >
        Next →
      </button>
    </div>
  );
};

export default PaginationBar;
