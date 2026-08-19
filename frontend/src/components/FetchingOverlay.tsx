import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FetchingOverlayProps {
  /** True while fresh results are being fetched for an already-rendered list
      (e.g. React Query's `isPlaceholderData` after a filter/page change). */
  active: boolean;
  /** Accessible description announced to screen readers while active. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Soft loading treatment for filtered result areas.
 *
 * Wrap the results region (table/cards/report) and pass `active` while a
 * filter-triggered refetch is in flight. The previous results stay mounted —
 * no layout jump — and a translucent veil with a spinner fades in over them.
 * The fade-in is slightly delayed so responses faster than ~150ms never
 * flash a loader at all.
 *
 * The veil also swallows clicks while active, so stale rows can't be acted on.
 */
const FetchingOverlay: React.FC<FetchingOverlayProps> = ({
  active,
  label = 'Updating results…',
  className,
  children,
}) => (
  <div className={`relative ${className ?? ''}`} aria-busy={active}>
    {children}
    <AnimatePresence>
      {active && (
        <motion.div
          key="fetching-veil"
          role="status"
          aria-live="polite"
          aria-label={label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.15, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
          className="absolute inset-0 z-20 flex items-start justify-center rounded-[inherit] bg-white/60 backdrop-blur-[2px] dark:bg-slate-900/60"
        >
          {/* Sticky so the spinner stays in view even when the results area is
              taller than the screen. */}
          <div className="sticky top-[38vh] py-10">
            <motion.div
              className="h-9 w-9 rounded-full border-[3px] border-blue-200 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

export default FetchingOverlay;
