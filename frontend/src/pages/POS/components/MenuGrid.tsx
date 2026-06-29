import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MenuItem } from '../../../types';
import { getImageFullUrl, MENU_ITEM_PLACEHOLDER } from '../../../utils/imageUrl';
import { formatCurrency } from '../../../utils/currency';

export const MENU_PAGE_SIZE = 10;

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Human label for a menu item's recurring availability window, or null if always available. */
function availabilityLabel(item: MenuItem): string | null {
  const days = item.available_days_of_week ?? null;
  const ts = item.available_time_start ?? null;
  const te = item.available_time_end ?? null;
  if ((!days || days.length === 0) && !ts && !te) return null;
  let dayStr = '';
  if (days && days.length) {
    const key = [...days].sort((a, b) => a - b).join(',');
    if (key === '1,2,3,4,5') dayStr = 'Mon–Fri';
    else if (key === '0,6') dayStr = 'Sat–Sun';
    else if (key === '0,1,2,3,4,5,6') dayStr = '';
    else dayStr = [...days].sort((a, b) => a - b).map((d) => DAY_ABBR[d]).join(', ');
  }
  const t = (v: string) => v.slice(0, 5);
  const timeStr = ts && te ? `${t(ts)}–${t(te)}` : ts ? `from ${t(ts)}` : te ? `until ${t(te)}` : '';
  return [dayStr, timeStr].filter(Boolean).join(' ') || null;
}

export type MenuGridProps = {
  menu: MenuItem[];
  justAddedItemId: number | null;
  onAddItem: (item: MenuItem) => void;
  getBrandName: (brandId: number | null | undefined) => string | null;
  /** Pagination: total number of items (before slicing) */
  totalCount?: number;
  /** 1-based current page */
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
};

const MenuGrid: React.FC<MenuGridProps> = ({
  menu,
  justAddedItemId,
  onAddItem,
  getBrandName,
  totalCount = 0,
  page = 1,
  pageSize = MENU_PAGE_SIZE,
  onPageChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showPagination = totalCount > pageSize && onPageChange;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3.5">
        <AnimatePresence mode="popLayout">
          {menu.map((item, i) => {
            const windowLabel = availabilityLabel(item);
            // Only block when the server explicitly says not-available-now (branch tz).
            const unavailable = item.available_now === false;
            return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: (i % pageSize) * 0.02 }}
              whileHover={unavailable ? undefined : { y: -4, boxShadow: '0 12px 24px -8px rgba(0,0,0,0.12)' }}
              whileTap={unavailable ? undefined : { scale: 0.98 }}
              onClick={() => { if (!unavailable) onAddItem(item); }}
            className={`relative rounded-xl transition-shadow bg-foodies-surface dark:bg-slate-800 overflow-hidden ${
              unavailable
                ? 'cursor-not-allowed opacity-60 grayscale border border-foodies-border dark:border-slate-600'
                : justAddedItemId === item.id
                ? 'cursor-pointer ring-2 ring-foodies-primary ring-offset-2 dark:ring-offset-slate-900 shadow-lg'
                : 'cursor-pointer shadow-md hover:shadow-lg border border-foodies-border dark:border-slate-600'
            }`}
          >
            {unavailable && windowLabel && (
              <div className="absolute top-1.5 left-1.5 z-10 rounded-md bg-amber-500/95 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                {windowLabel}
              </div>
            )}
            <div className="aspect-[16/11] overflow-hidden bg-foodies-surfaceMuted dark:bg-slate-700/50 flex items-center justify-center">
              <img
                src={item.image_url ? getImageFullUrl(item.image_url) : MENU_ITEM_PLACEHOLDER}
                alt=""
                className="max-w-[90%] max-h-full object-contain"
              />
            </div>
            <div className="p-2.5">
              <h3 className="font-semibold text-foodies-textPrimary dark:text-slate-100 text-[13px] leading-tight line-clamp-2 mb-0.5">{item.name}</h3>
              {getBrandName(item.brand_id) && (
                <p className="text-[11px] text-foodies-primary font-medium uppercase tracking-wide mb-0.5">{getBrandName(item.brand_id)}</p>
              )}
              {item.description && (
                <p className="text-[11px] text-foodies-textSecondary dark:text-slate-400 line-clamp-1 mb-1">{item.description}</p>
              )}
              <div className="flex items-center justify-between gap-1 flex-wrap mb-1">
                <p className="text-sm font-bold text-foodies-cta dark:text-red-400">
                  {formatCurrency(item.price || item.base_price || 0)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(typeof item.category === 'object' ? item.category?.name : item.category ? String(item.category) : null) && (
                  <span className="inline-block px-2 py-0.5 text-xs font-medium text-foodies-textPrimary dark:text-slate-200 bg-foodies-border dark:bg-slate-600 rounded-md">
                    {typeof item.category === 'object' ? item.category.name : String(item.category)}
                  </span>
                )}
                {item.variants && item.variants.length > 0 && (
                  <span className="inline-block px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded-md">
                    Variants
                  </span>
                )}
                {item.addons && item.addons.length > 0 && (
                  <span className="inline-block px-2 py-0.5 text-xs font-medium text-emerald-700 bg-emerald-100 rounded-md">
                    Add-ons
                  </span>
                )}
                {item.modifier_groups && item.modifier_groups.length > 0 && (
                  <span className="inline-block px-2 py-0.5 text-xs font-medium text-violet-700 bg-violet-100 rounded-md">
                    Modifiers
                  </span>
                )}
                {!unavailable && windowLabel && (
                  <span className="inline-block px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-100 rounded-md">
                    🕒 {windowLabel}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
          );
          })}
        </AnimatePresence>
      </div>
      {showPagination && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-shrink-0 flex items-center justify-center gap-2 py-4 mt-4 border-t border-foodies-border dark:border-slate-700"
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
            Page {page} of {totalPages} <span className="text-foodies-textPrimary">({totalCount} items)</span>
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
        </motion.div>
      )}
    </div>
  );
};

export default MenuGrid;
