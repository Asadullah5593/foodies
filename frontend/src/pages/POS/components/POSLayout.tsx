import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MdOutlineShoppingCart, MdClose } from 'react-icons/md';

export type POSLayoutProps = {
  /** Center: search + menu grid */
  centerSection: React.ReactNode;
  /** Right panel / drawer content: cart, customer, payment */
  checkoutSection: React.ReactNode;
  /** For touch: cart item count shown on FAB */
  cartItemCount?: number;
  /** For touch: drawer open state */
  isDrawerOpen?: boolean;
  onDrawerOpen?: () => void;
  onDrawerClose?: () => void;
};

const CHECKOUT_PANEL_WIDTH = '30rem';

/**
 * Responsive POS shell.
 * Desktop (lg+): 2-pane — center (menu), right (checkout).
 * Touch: top bar + menu; checkout in bottom sheet, opened via Cart FAB.
 */
const POSLayout: React.FC<POSLayoutProps> = ({
  centerSection,
  checkoutSection,
  cartItemCount = 0,
  isDrawerOpen = false,
  onDrawerOpen,
  onDrawerClose,
}) => {
  // App has a sticky navbar (h-16). Keep POS within remaining viewport to avoid double scrollbars.
  return (
    <div className="flex h-[calc(100vh-4rem)] bg-foodies-surfaceMuted dark:bg-slate-900">
      {/* Desktop: 3-pane (lg and up) */}
      <div className="hidden lg:flex flex-1 min-w-0 w-full h-full">
        {/* Center — menu */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-foodies-surface dark:bg-slate-800 shadow-sm border-r border-transparent dark:border-slate-700">
          {centerSection}
        </div>
        {/* Right — checkout */}
        <div
          className="flex-shrink-0 flex flex-col border-l border-foodies-border dark:border-slate-700 bg-foodies-surfaceMuted dark:bg-slate-900 overflow-hidden"
          style={{ width: CHECKOUT_PANEL_WIDTH, minWidth: CHECKOUT_PANEL_WIDTH, maxWidth: '32rem' }}
        >
          {checkoutSection}
        </div>
      </div>

      {/* Touch: single column + bottom sheet */}
      <div className="flex flex-col w-full h-full lg:hidden">
        {/* Top + menu */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-foodies-surface dark:bg-slate-800">
          {centerSection}
        </div>
        {/* Cart FAB */}
        <button
          type="button"
          onClick={onDrawerOpen}
          className="fixed bottom-6 right-6 z-20 flex items-center justify-center w-14 h-14 rounded-full text-white shadow-lg !bg-[linear-gradient(135deg,#000000_0%,#B91C1C_50%,#000000_100%)] hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-2 focus:ring-foodies-primary focus:ring-offset-2"
          aria-label="Open cart"
        >
          <span className="relative">
            <MdOutlineShoppingCart className="h-6 w-6" />
            {cartItemCount > 0 && (
              <span className="absolute -top-2 -right-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-foodies-primary px-1 text-xs font-bold text-white">
                {cartItemCount > 99 ? '99+' : cartItemCount}
              </span>
            )}
          </span>
        </button>
        {/* Bottom sheet overlay */}
        <AnimatePresence>
          {isDrawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-30 bg-black/40 lg:hidden"
                onClick={onDrawerClose}
                aria-hidden
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'tween', duration: 0.25 }}
                className="fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col rounded-t-2xl bg-foodies-surfaceMuted dark:bg-slate-900 border-t border-foodies-border dark:border-slate-700 shadow-2xl lg:hidden overflow-hidden"
                role="dialog"
                aria-label="Cart and checkout"
              >
                <div className="flex-shrink-0 flex items-center justify-end px-4 py-3 border-b border-foodies-border dark:border-slate-700 bg-foodies-surface dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={onDrawerClose}
                    className="p-2 rounded-lg text-foodies-textSecondary dark:text-slate-400 hover:bg-foodies-surfaceMuted dark:hover:bg-slate-700 hover:text-foodies-textPrimary dark:hover:text-slate-100"
                    aria-label="Close"
                  >
                    <MdClose />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {checkoutSection}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default POSLayout;
