import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Floating "back to top" button (bottom-right). Renders only while the page
 * actually has a vertical scrollbar; clicking smooth-scrolls back to the top.
 *
 * Drop it anywhere inside the page content. It resolves the real scroller
 * dynamically on every check, because our screens scroll differently:
 * - Inside <Layout> (e.g. FOH Packing) an inner `<main class="overflow-auto">`
 *   scrolls and the window never does.
 * - Full-screen pages (e.g. Customer Display) have `min-h-screen` roots whose
 *   overflow-auto <main> grows instead of scrolling, so the WINDOW scrolls.
 * A static "nearest overflow-auto ancestor" would pick the wrong element in
 * the second case — hence: nearest ancestor that is scrollable AND currently
 * overflowing, else the document.
 */
const ScrollToTopButton: React.FC = () => {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);

  /** Nearest ancestor with overflow-y auto/scroll that is actually overflowing. */
  const findScroller = useCallback((): HTMLElement | null => {
    let el = anchorRef.current?.parentElement ?? null;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 1
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null; // the window/document scrolls (or nothing does)
  }, []);

  useEffect(() => {
    const check = () => {
      const de = document.documentElement;
      setVisible(findScroller() != null || de.scrollHeight > de.clientHeight + 1);
    };
    check();
    // Content height changes as orders load / poll in. Watch the page's own
    // root (the anchor's parent grows with content even when its scroll
    // container keeps a fixed box) plus the body for window-scroll pages.
    const observed: Element[] = [];
    const parent = anchorRef.current?.parentElement;
    if (parent) observed.push(parent);
    if (document.body) observed.push(document.body);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    observed.forEach((el) => ro?.observe(el));
    window.addEventListener('resize', check);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [findScroller]);

  const scrollToTop = () => {
    const scroller = findScroller();
    if (scroller) {
      if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: 0, behavior: 'smooth' });
      else scroller.scrollTop = 0;
    } else {
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden />
      <AnimatePresence>
        {visible && (
          <motion.button
            key="scroll-to-top"
            type="button"
            onClick={scrollToTop}
            aria-label="Scroll to top"
            title="Scroll to top"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition-colors hover:bg-gray-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 13V3" />
              <path d="M3.5 7.5L8 3l4.5 4.5" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
};

export default ScrollToTopButton;
