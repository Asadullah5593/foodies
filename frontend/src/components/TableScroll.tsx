import React, { useEffect, useRef, useState } from 'react';
import { useViewport } from '../hooks/useViewport';

interface TableScrollProps {
  children: React.ReactNode;
  /** The wrapper's classes — the page's own `overflow-x-auto …` string, kept as is. */
  className?: string;
}

/**
 * A sideways-scrolling wrapper for a table wider than the screen. Below lg it fades the edge
 * that still has columns to show, so a phone or tablet user can tell the table continues;
 * desktop (≥ 1024px) renders the plain wrapper the page always had.
 */
const TableScroll: React.FC<TableScrollProps> = ({ children, className = 'overflow-x-auto' }) => {
  const { isDesktop } = useViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    if (isDesktop) return;
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
    // Re-measure whenever the content changes (rows load, filters narrow the table).
  }, [isDesktop, children]);

  if (isDesktop) return <div className={className}>{children}</div>;

  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      {more.right && (
        <div
          aria-hidden
          data-testid="scroll-more-right"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-[inherit] bg-gradient-to-l from-white to-transparent dark:from-slate-800"
        />
      )}
      {more.left && (
        <div
          aria-hidden
          data-testid="scroll-more-left"
          className="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-l-[inherit] bg-gradient-to-r from-white to-transparent dark:from-slate-800"
        />
      )}
    </div>
  );
};

export default TableScroll;
