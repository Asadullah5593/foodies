import React, { useRef, useState, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../hooks/useTypeaheadSuggestions';
import { useViewport } from '../hooks/useViewport';
import TypeaheadDropdown from './TypeaheadDropdown';
import InactiveBadge from './InactiveBadge';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Rendered but not selectable (e.g. a rider who fails an availability check). */
  disabled?: boolean;
  /** Tooltip explaining why the option is disabled. */
  title?: string;
  /**
   * The record behind this option is deactivated. Still selectable (an existing
   * assignment must remain editable), but marked so a deactivated brand or
   * category is not mistaken for a live one. Search still matches `label`, so
   * the marker never interferes with typing a name.
   */
  inactive?: boolean;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  /** Placeholder for the search field inside the open panel */
  searchPlaceholder?: string;
  label?: string;
  className?: string;
  id?: string;
  /** Optional min width for the trigger (e.g. min-w-[160px]) */
  minWidth?: string;
  disabled?: boolean;
  /** Replaces the default trigger styling wholesale (for pages with their own look). */
  triggerClassName?: string;
  /**
   * Names the control for assistive tech when the filter bar shows no visible
   * label. Rendered as "<ariaLabel>: <selected option>" so the value is
   * announced too.
   */
  ariaLabel?: string;
}

const baseTriggerClass =
  'w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between gap-2';

const panelClass =
  'rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg overflow-hidden';

/** Where the portalled panel sits below lg (viewport coordinates). */
interface PanelFrame {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Searchable dropdown for filter bars and anywhere long option lists need search.
 *
 * Desktop (≥ lg) renders the panel in flow, absolutely positioned under the trigger, exactly as
 * it always has. Below lg the panel is portalled to <body> and placed from the trigger's
 * rectangle: in a modal or a scrolling filter bar the in-flow panel is clipped, and anchored
 * left it runs off the right edge of a phone. Touch devices also don't autofocus the search
 * box, which would pop the keyboard over the list.
 */
const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  label,
  className = '',
  id,
  minWidth = 'min-w-[140px]',
  disabled = false,
  triggerClassName,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { isDesktop, isCoarsePointer } = useViewport();
  const portalPanel = !isDesktop;
  const [frame, setFrame] = useState<PanelFrame | null>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );
  const selectedLabel = selectedOption?.label ?? (value ? value : '');

  const filteredOptions = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, debouncedSearch]);

  const typeaheadOptions = useMemo(
    () => options.map((o) => ({ id: o.value, label: o.label, inactive: o.inactive })),
    [options],
  );
  const { open: sugOpen, setOpen: setSugOpen, suggestions, activeIndex, setActiveIndex } =
    useTypeaheadSuggestions({ query: debouncedSearch, options: typeaheadOptions, minChars: 2, limit: 8 });

  // Below lg: place the panel under (or, near the bottom of the screen, above) the trigger,
  // at least 200px wide, clamped inside the viewport with an 8px margin.
  const placePanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(Math.max(r.width, 200), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, r.left), Math.max(margin, window.innerWidth - width - margin));
    const below = window.innerHeight - r.bottom - margin - 4;
    const above = r.top - margin - 4;
    const wanted = 320;
    const openUp = below < 200 && above > below;
    const maxHeight = Math.max(160, Math.min(wanted, openUp ? above : below));
    const top = openUp ? Math.max(margin, r.top - 4 - maxHeight) : r.bottom + 4;
    setFrame({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (open && portalPanel) placePanel();
  }, [open, portalPanel, placePanel]);

  useEffect(() => {
    if (!open || !portalPanel) return;
    // Anything scrolling under the fixed panel moves the trigger, so follow it.
    const onMove = () => placePanel();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, portalPanel, placePanel]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      setSearch('');
      setSugOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
        setSugOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleSelect = (opt: SearchableSelectOption) => {
    if (opt.disabled) return;
    setOpen(false);
    setSearch('');
    setSugOpen(false);
    onChange(opt.value);
  };

  const onKeyDownSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      }
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length > 0) {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
    } else if (e.key === 'Enter') {
      if (suggestions.length > 0) {
        e.preventDefault();
        const s = suggestions[activeIndex];
        const opt = options.find((o) => o.value === s.id);
        if (opt) handleSelect(opt);
      }
    } else if (e.key === 'Escape') {
      setSugOpen(false);
    }
    e.stopPropagation();
  };

  const panelBody = (
    <>
      <div className="p-2 border-b border-gray-100 dark:border-slate-600 flex-none">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none max-lg:py-2.5"
          autoFocus={!isCoarsePointer}
          onKeyDown={onKeyDownSearch}
        />
      </div>
      <div className="relative">
        <TypeaheadDropdown
          open={sugOpen && debouncedSearch.trim().length >= 2}
          suggestions={suggestions}
          activeIndex={activeIndex}
          onHoverIndex={setActiveIndex}
          onSelect={(s) => {
            const opt = options.find((o) => o.value === s.id);
            if (opt) handleSelect(opt);
          }}
          onClose={() => setSugOpen(false)}
        />
      </div>
      <ul className={portalPanel ? 'min-h-0 flex-1 overflow-y-auto py-1' : 'max-h-60 overflow-y-auto py-1'}>
        {filteredOptions.length === 0 ? (
          <li className="px-3 py-2 text-sm text-gray-500 dark:text-slate-400">No matches</li>
        ) : (
          filteredOptions.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              aria-disabled={opt.disabled || undefined}
              title={opt.title}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(opt);
              }}
              className={`flex items-center gap-2 px-3 py-2 text-sm max-lg:py-3 ${
                opt.disabled
                  ? 'cursor-not-allowed text-gray-400 dark:text-slate-500'
                  : opt.value === value
                    ? 'cursor-pointer bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 font-medium'
                    : 'cursor-pointer text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.inactive && <InactiveBadge />}
            </li>
          ))
        )}
      </ul>
    </>
  );

  return (
    <div ref={containerRef} className={`relative ${className} max-sm:w-full`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1" htmlFor={id}>
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`${triggerClassName ?? baseTriggerClass} ${minWidth} max-lg:min-h-[44px] ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${selectedLabel || placeholder}` : undefined}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{selectedLabel || placeholder}</span>
          {selectedOption?.inactive && <InactiveBadge />}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-gray-500 dark:text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && !portalPanel && (
        <div className={`absolute z-[200] mt-1 w-full min-w-[200px] ${panelClass}`} role="listbox">
          {panelBody}
        </div>
      )}
      {open &&
        portalPanel &&
        frame &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className={`fixed z-[200] flex flex-col ${panelClass}`}
            style={{ top: frame.top, left: frame.left, width: frame.width, maxHeight: frame.maxHeight }}
          >
            {panelBody}
          </div>,
          document.body,
        )}
    </div>
  );
};

export default SearchableSelect;
