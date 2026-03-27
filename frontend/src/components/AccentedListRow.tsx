import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

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
  /** Action buttons or links (e.g. Edit, Delete) */
  actions: React.ReactNode;
  /** Index for stagger animation delay */
  animationIndex?: number;
  /** Optional content below the row (e.g. sub-list); renders inside same card with border-t */
  footer?: React.ReactNode;
}

const accentBarClass: Record<AccentVariant, string> = {
  active: 'bg-emerald-500 dark:bg-emerald-500',
  inactive: 'bg-rose-500 dark:bg-rose-500',
};

const statusPillClass: Record<AccentVariant, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  inactive: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
};

const statusDotClass: Record<AccentVariant, string> = {
  active: 'bg-emerald-500',
  inactive: 'bg-rose-500',
};

const AvatarImage: React.FC<{ imageUrl?: string | null; initial: string }> = ({
  imageUrl,
  initial,
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
    <div className="relative flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden ring-2 ring-white dark:ring-slate-800 shadow-sm">
      {showInitial && (
        <span className="text-xl sm:text-2xl font-bold text-gray-500 dark:text-slate-400 uppercase tracking-tight">
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
  actions,
  animationIndex = 0,
  footer,
}) => {
  const showDualStatus = orderStatusLabel != null || deliveryStatusLabel != null;
  const statusContent = showDualStatus ? (
    <span className="hidden sm:flex items-center gap-2 flex-wrap">
      {orderStatusLabel != null && orderStatusLabel !== '' && (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${statusPillClass[statusVariant]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass[statusVariant]}`} />
          Order: {orderStatusLabel}
        </span>
      )}
      {deliveryStatusLabel != null && deliveryStatusLabel !== '' && (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${statusPillClass[statusVariant]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass[statusVariant]}`} />
          Delivery: {deliveryStatusLabel}
        </span>
      )}
    </span>
  ) : statusLabel != null && statusLabel !== '' ? (
    <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${statusPillClass[statusVariant]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass[statusVariant]}`} />
      {statusLabel}
    </span>
  ) : null;

  return (
    <motion.li
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ delay: animationIndex * 0.04, duration: 0.25 }}
      className={`group rounded-xl bg-white dark:bg-slate-800/80 border border-gray-200/80 dark:border-slate-700/80 overflow-hidden hover:border-gray-300 dark:hover:border-slate-600 hover:shadow-md transition-all duration-200 ${footer ? 'flex flex-col' : ''}`}
    >
      <div className="flex items-center gap-4 sm:gap-6 min-h-[4rem]">
        <div
          className={`flex-shrink-0 w-1.5 sm:w-2 self-stretch min-h-[4rem] ${accentBarClass[accent]}`}
          aria-hidden
        />
        <AvatarImage imageUrl={imageUrl} initial={initial} />
        <div className="flex-1 min-w-0 py-4">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100 text-base sm:text-lg truncate" title={title}>
            {title}
          </h3>
          {subtitle != null && subtitle !== '' && (
            <div className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 space-y-0.5 [&>p]:leading-tight">
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-3 py-4 pr-4 sm:pr-6">
          {statusContent}
          <div className="flex gap-2">{actions}</div>
        </div>
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
