import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A value in a table cell that has more behind it — "+2 more" brands, a split
 * of point balances — and the list that it stands for.
 *
 * The point of this component is that the user can TELL there is more:
 *  - the trigger carries a dotted underline and a help cursor, the same cue a
 *    browser gives an abbreviation, so it reads as "hover me" before anyone
 *    hovers;
 *  - the list opens at once (a native `title` waits about a second, and many
 *    people never find it), and stays styled like the rest of the page;
 *  - it also opens on keyboard focus and on a tap, where there is no hover.
 *
 * The list is rendered into <body> with fixed positioning: a table that
 * scrolls sideways clips anything absolutely positioned inside it. It holds
 * nothing to click, so it never takes the pointer. Clicks on the trigger are
 * stopped from reaching the row, which opens a profile on click.
 */
/**
 * The "there is more here" cue: a dotted underline. Exported so a trigger that
 * mixes text with tags can put it on its text alone (see `underline`).
 */
export const HOVER_CUE =
  'underline decoration-dotted decoration-[#9AA1AD] decoration-[1.5px] underline-offset-[3px] dark:decoration-slate-500';

const HoverReveal: React.FC<{
  /** What the cell shows — the trigger. */
  children: React.ReactNode;
  /** Heading of the list, e.g. "Brands (3)". */
  heading: string;
  /** The full list. */
  content: React.ReactNode;
  /** What the trigger does, for screen readers: "Show all 3 brands". */
  label: string;
  /**
   * Underline the whole trigger (the default). Pass false when the trigger
   * holds more than text and marks its text with HOVER_CUE itself.
   */
  underline?: boolean;
  className?: string;
}> = ({ children, heading, content, label, underline = true, className = '' }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Under the trigger, left edges aligned; above it when there is no room
  // below, and pulled back inside the window at the right edge.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 120;
    const width = panelRef.current?.offsetWidth ?? 220;
    const below = r.bottom + 6;
    const fitsBelow = below + height <= window.innerHeight - 8;
    setPos({
      top: fitsBelow ? below : Math.max(8, r.top - 6 - height),
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // A fixed panel would drift from its cell as the page moves; close instead.
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        data-hover-reveal=""
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={(e) => {
          // A tap has no hover: it opens the list, and a second tap closes it.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`cursor-help rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#DC2A2A]/40 ${
          underline ? `${HOVER_CUE} hover:decoration-[#DC2A2A] dark:hover:decoration-red-400` : ''
        } ${className}`}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="tooltip"
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="pointer-events-none z-[1000] min-w-[11rem] max-w-[20rem] rounded-[12px] border border-[#ECEDF0] bg-white px-3.5 py-3 text-left shadow-[0_10px_30px_rgba(15,23,42,.14)] dark:border-slate-600 dark:bg-slate-800"
          >
            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[.06em] text-[#9AA1AD] dark:text-slate-400">
              {heading}
            </div>
            {content}
          </div>,
          document.body,
        )}
    </>
  );
};

export default HoverReveal;
