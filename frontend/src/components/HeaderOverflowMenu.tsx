import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MdMoreVert } from 'react-icons/md';

export interface HeaderMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Navigate here (rendered as a Link). Without it the row is a plain action button. */
  to?: string;
  onSelect?: () => void;
  /** Current state for toggles, shown on the right, e.g. "On". */
  hint?: string;
}

/**
 * The phone/tablet header's "more" menu. Below `lg` the header has no room for the quick icons
 * the desktop header shows (POS, Orders, keyboard, theme) next to the title and the bell, so
 * they move in here. The Layout renders it only below `lg`; the desktop header is unchanged.
 */
const HeaderOverflowMenu: React.FC<{ items: HeaderMenuItem[]; userName?: string | null }> = ({ items, userName }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0 && !userName) return null;

  const rowClass =
    'flex w-full items-center gap-3 px-4 min-h-[44px] text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors';

  const rowBody = (item: HeaderMenuItem) => (
    <>
      <span className="flex h-5 w-5 items-center justify-center text-slate-500 dark:text-slate-400">{item.icon}</span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.hint && <span className="text-xs text-slate-400 dark:text-slate-500">{item.hint}</span>}
    </>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <MdMoreVert className="h-6 w-6" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-60 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-1 shadow-xl z-50"
        >
          {userName && (
            <div className="truncate border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              {userName}
            </div>
          )}
          {items.map((item) =>
            item.to ? (
              <Link
                key={item.key}
                to={item.to}
                role="menuitem"
                className={rowClass}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {rowBody(item)}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={rowClass}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {rowBody(item)}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderOverflowMenu;
