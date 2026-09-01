import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isEntityInactive } from '../utils/entityStatus';

export interface BrandLockOption {
  id: number;
  name: string;
  is_active?: boolean | null;
  isActive?: boolean | null;
  status?: string | null;
}

/**
 * Which brands a branch assignment locks someone to. An empty selection means
 * "all brands" — the same thing the single brand column meant by null — so the
 * All row is not a brand, it is the absence of a lock, and picking it clears
 * the rest.
 *
 * A one-line trigger rather than a row of chips: this sits in a table cell
 * beside the role picker, and laying four brands out inline stretched every row
 * to the height of the brand list. The panel is portalled to the body because
 * the table it lives in scrolls (`overflow-y-auto`), which would otherwise clip
 * a dropdown opening near the bottom row.
 */
const BrandLockSelect: React.FC<{
  brands: BrandLockOption[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  allLabel?: string;
  /** Accessible name, e.g. "Brands for Ali" — several of these share a table. */
  ariaLabel?: string;
}> = ({ brands, value, onChange, disabled = false, allLabel = 'All brands', ariaLabel }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = new Set(value);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 190);
    // Guess the panel height from the row count so a trigger near the bottom of
    // the screen opens upward instead of off it.
    const height = Math.min(36 * (brands.length + 1) + 16, 260);
    const below = window.innerHeight - r.bottom;
    const top = below < height + 8 && r.top > height + 8 ? r.top - height - 4 : r.bottom + 4;
    setPos({
      top,
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      width,
    });
  }, [brands.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Anything scrolling under a fixed panel moves the trigger out from under
    // it, so follow the trigger rather than leaving the panel stranded.
    const onScroll = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next].sort((a, b) => a - b));
  };

  const chosen = brands.filter((b) => selected.has(b.id));
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length === 1
        ? chosen[0].name
        : `${chosen.length} brands`;

  const row = (key: string, checked: boolean, label: React.ReactNode, onPick: () => void) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onPick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] font-bold ${
          checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={chosen.length > 1 ? chosen.map((b) => b.name).join(', ') : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="flex w-[150px] items-center justify-between gap-1 rounded border border-gray-300 px-2 py-1 text-left text-sm text-gray-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="flex-none text-[10px] text-gray-400">
          ▼
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[1000] max-h-[260px] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {row('__all', selected.size === 0, allLabel, () => onChange([]))}
            <div className="my-1 border-t border-gray-100" />
            {brands.map((b) =>
              row(String(b.id), selected.has(b.id), (
                <>
                  {b.name}
                  {isEntityInactive(b) && (
                    <span className="ml-1 text-xs text-rose-600">(Inactive)</span>
                  )}
                </>
              ), () => toggle(b.id)),
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default BrandLockSelect;
