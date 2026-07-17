import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** Shared input / label classes for the offers admin forms (red-accented, light). */
export const offerInput =
  'w-full rounded-[10px] border-[1.5px] border-gray-200 bg-white px-[13px] py-[11px] text-sm text-gray-800 outline-none transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500/10 disabled:bg-gray-100 disabled:text-gray-400';
export const offerLabel = 'mb-[7px] block text-[13px] font-semibold text-gray-700';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  /** Max width in px (matches the mockups: ~960–1040). */
  width?: number;
  /** Size to the content (capped at 92vh) instead of the fixed editor height. */
  autoHeight?: boolean;
  /** Footer content (e.g. Active toggle + Cancel/Save). Omit for editor-style modals. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The offers-admin modal shell: dark overlay, animated white card with a red
 * gradient top bar, an icon header + close button, a flex body region the
 * caller fills (and scrolls), and an optional sticky footer.
 */
const OfferModal: React.FC<Props> = ({ open, onClose, title, subtitle, icon, width = 980, autoHeight, footer, children }) => {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className={`flex w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl ${autoHeight ? 'max-h-[92vh]' : 'h-[88vh] max-h-[760px]'}`}
              style={{ maxWidth: width }}
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 18 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-1.5 flex-none bg-gradient-to-r from-red-500 via-red-600 to-rose-500" />
              <div className="flex flex-none items-center justify-between gap-4 border-b border-gray-100 px-7 py-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-red-50 text-red-600">
                    {icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-lg font-bold tracking-tight text-gray-800">{title}</div>
                    {subtitle && <div className="truncate text-[12.5px] text-gray-400">{subtitle}</div>}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">{children}</div>

              {footer && (
                <div className="flex flex-none items-center justify-between gap-4 border-t border-gray-100 bg-gray-50 px-7 py-4">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default OfferModal;
