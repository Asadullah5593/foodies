import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type RowAction = {
  label: string;
  onSelect: () => void;
  /** Destructive — drawn in red, set apart from the rest. */
  danger?: boolean;
};

/**
 * One "Actions" button for a table row, opening a small menu of what can be
 * done with that record. Keeps a row to a single line however many actions it
 * has.
 *
 * The menu is rendered into <body> with fixed positioning: a table that
 * scrolls sideways clips anything absolutely positioned inside it. Clicks are
 * stopped from reaching the row, so a row that opens a detail page on click is
 * not also opened by using its menu.
 */
const RowActionsMenu: React.FC<{ actions: RowAction[]; label?: string; ariaLabel?: string }> = ({
  actions,
  label = 'Actions',
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Place the menu under the button, right edges aligned; flip above when
  // there is no room below.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? actions.length * 40 + 8;
    const menuWidth = menuRef.current?.offsetWidth ?? 176;
    const below = r.bottom + 4;
    const fitsBelow = below + menuHeight <= window.innerHeight - 8;
    setPos({
      top: fitsBelow ? below : Math.max(8, r.top - 4 - menuHeight),
      left: Math.max(8, r.right - menuWidth),
    });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    // A fixed menu would drift from its row as the page moves; close instead.
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#374151] hover:bg-[#F3F4F6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2A2A]/40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        {label}
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="z-[1000] min-w-[11rem] overflow-hidden rounded-[12px] border border-[#ECEDF0] bg-white py-1.5 shadow-[0_10px_30px_rgba(15,23,42,.14)] dark:border-slate-600 dark:bg-slate-800"
          >
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  a.onSelect();
                }}
                className={`block w-full px-4 py-2 text-left text-[13px] font-semibold ${
                  a.danger
                    ? 'mt-1 border-t border-[#F1F2F5] pt-2.5 text-[#DC2A2A] hover:bg-[#FCEEEE] dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-900/30'
                    : 'text-[#374151] hover:bg-[#F3F4F6] dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

export default RowActionsMenu;
