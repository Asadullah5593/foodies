import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useViewport } from '../hooks/useViewport';

/**
 * The ⋯ sheet a list card opens below lg: the row's name, the page's own action buttons laid out
 * as full-width rows (index.css `.row-action-sheet` restyles whatever classes they carry), and a
 * Cancel button. Any tap inside closes the sheet and the button's own handler still runs. It is
 * rendered into <body>, so a scrolling table or a transformed card never clips it. Phones: it
 * slides up from the bottom edge; tablets: a centred panel that rises a little.
 */
export const ActionsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, children }) => {
  const { isPhone } = useViewport();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const panelMotion = isPhone
    ? { initial: { y: '100%' }, animate: { y: '0%' }, exit: { y: '100%' } }
    : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 24 } };
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
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
              <div className="row-action-sheet flex flex-col" onClickCapture={onClose}>
                {children}
              </div>
              <button
                type="button"
                onClick={onClose}
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
};

/** The 38px ⋯ button that opens an ActionsSheet. Its own click never reaches a clickable card. */
export const MoreActionsButton: React.FC<{
  title: string;
  onClick: () => void;
  expanded: boolean;
  ariaLabel?: string;
  className?: string;
}> = ({ title, onClick, expanded, ariaLabel, className = '' }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-label={ariaLabel ?? `More actions for ${title}`}
    aria-haspopup="dialog"
    aria-expanded={expanded}
    className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white text-[#5A6473] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 ${className}`}
  >
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3.5" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="12.5" cy="8" r="1.4" />
    </svg>
  </button>
);

/**
 * The action nodes a page passes, flattened through nested fragments (pages often wrap a permission
 * group in its own `<>…</>`), re-keyed by position so a card and its sheet can render them apart.
 */
export const flattenActions = (node: React.ReactNode): React.ReactNode[] =>
  React.Children.toArray(node)
    .flatMap((child) =>
      React.isValidElement(child) && child.type === React.Fragment
        ? flattenActions((child.props as { children?: React.ReactNode }).children)
        : [child],
    )
    .map((child, i) => (React.isValidElement(child) ? React.cloneElement(child, { key: `action-${i}` }) : child));
