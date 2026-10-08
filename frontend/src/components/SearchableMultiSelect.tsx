import React, { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../hooks/useTypeaheadSuggestions';
import { useViewport } from '../hooks/useViewport';
import TypeaheadDropdown from './TypeaheadDropdown';
import InactiveBadge from './InactiveBadge';
import { isEntityInactive } from '../utils/entityStatus';

export interface SearchableMultiSelectOption {
  id: number;
  name: string;
  code?: string;
  /**
   * The record is deactivated. Still selectable — an existing selection has to
   * stay editable — but marked so it is not mistaken for a live one.
   *
   * Callers pass entity payloads straight through here (`options={branches}`),
   * so this is usually left unset and read off the payload's own is_active /
   * isActive / status field instead. Set it explicitly only to override that.
   */
  inactive?: boolean;
}

interface SearchableMultiSelectProps {
  options: SearchableMultiSelectOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  maxHeight?: string;
  /** Display name for option (e.g. show code in parentheses) */
  getOptionLabel?: (opt: SearchableMultiSelectOption) => string;
}

/** Where the portalled panel sits below lg (viewport coordinates). */
interface PanelFrame {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Multi-select with search, used by the offer editors and deals.
 *
 * Desktop (≥ lg) renders exactly as it always has: an in-flow panel under the trigger with an
 * autofocused search box. Below lg the panel is portalled to <body> and placed from the
 * trigger's rectangle — inside the offer editors' scrolling body the in-flow panel was clipped
 * — touch devices don't autofocus the search box (it popped the keyboard over the list), and
 * rows and buttons are at least 44px tall.
 */
const SearchableMultiSelect: React.FC<SearchableMultiSelectProps> = ({
  options,
  selectedIds,
  onChange,
  placeholder = 'Search and select...',
  label,
  required = false,
  maxHeight = '12rem',
  getOptionLabel = (o) => (o.code ? `${o.name} (${o.code})` : o.name),
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { isDesktop, isCoarsePointer } = useViewport();
  const portalPanel = !isDesktop;
  const [frame, setFrame] = useState<PanelFrame | null>(null);

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return options;
    const q = debouncedSearch.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.code && o.code.toLowerCase().includes(q)),
    );
  }, [options, debouncedSearch]);

  const typeaheadOptions = useMemo(
    () =>
      options.map((o) => ({
        id: String(o.id),
        label: getOptionLabel(o),
        inactive: o.inactive ?? isEntityInactive(o),
      })),
    [options, getOptionLabel],
  );
  const { open: sugOpen, setOpen: setSugOpen, suggestions, activeIndex, setActiveIndex } =
    useTypeaheadSuggestions({ query: debouncedSearch, options: typeaheadOptions, minChars: 2, limit: 8 });

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet],
  );

  const toggle = (id: number) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
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
        const id = parseInt(s.id, 10);
        if (!Number.isNaN(id)) toggle(id);
      }
    } else if (e.key === 'Escape') {
      setSugOpen(false);
    }
  };

  const selectAll = () => {
    const ids = filtered.map((o) => o.id);
    const newSet = new Set([...selectedIds, ...ids]);
    onChange(Array.from(newSet));
  };

  const clearAll = () => {
    if (filtered.length === 0) return;
    const filteredSet = new Set(filtered.map((o) => o.id));
    onChange(selectedIds.filter((id) => !filteredSet.has(id)));
  };

  // Below lg: under the trigger, or above it when there's more room there; at least 240px wide
  // and clamped 8px inside the viewport.
  const placePanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(Math.max(r.width, 240), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, r.left), Math.max(margin, window.innerWidth - width - margin));
    const below = window.innerHeight - r.bottom - margin - 4;
    const above = r.top - margin - 4;
    const openUp = below < 260 && above > below;
    const maxH = Math.max(200, Math.min(420, openUp ? above : below));
    const top = openUp ? Math.max(margin, r.top - 4 - maxH) : r.bottom + 4;
    setFrame({ top, left, width, maxHeight: maxH });
  }, []);

  useLayoutEffect(() => {
    if (open && portalPanel) placePanel();
  }, [open, portalPanel, placePanel]);

  useEffect(() => {
    if (!open || !portalPanel) return;
    const onMove = () => placePanel();
    // Capture phase + stopPropagation: Escape closes this panel only, not the offer editor
    // (OfferModal closes itself on a window-level Escape).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, portalPanel, placePanel]);

  const summary =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? getOptionLabel(selectedOptions[0])
        : `${selectedOptions.length} selected`;

  const touch = portalPanel; // below lg: 44px rows and buttons

  const searchArea = (
    <div className={`p-2 border-b border-gray-100 bg-white rounded-t-lg ${portalPanel ? 'flex-none' : 'sticky top-0'}`}>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Type to filter..."
        className={`w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${touch ? 'min-h-[44px]' : ''}`}
        autoFocus={!(portalPanel && isCoarsePointer)}
        onKeyDown={onKeyDownSearch}
      />
      <div className="relative">
        <TypeaheadDropdown
          open={sugOpen && debouncedSearch.trim().length >= 2}
          suggestions={suggestions}
          activeIndex={activeIndex}
          onHoverIndex={setActiveIndex}
          onSelect={(s) => {
            const id = parseInt(s.id, 10);
            if (!Number.isNaN(id)) toggle(id);
          }}
          onClose={() => setSugOpen(false)}
        />
      </div>
      <div className={`flex gap-2 mt-2 ${touch ? 'gap-4' : ''}`}>
        <button
          type="button"
          onClick={selectAll}
          className={`text-xs text-blue-600 hover:text-blue-800 ${touch ? 'min-h-[44px] px-1 text-sm' : ''}`}
        >
          Select all in list
        </button>
        <button
          type="button"
          onClick={clearAll}
          className={`text-xs text-gray-500 hover:text-gray-700 ${touch ? 'min-h-[44px] px-1 text-sm' : ''}`}
        >
          Clear selection
        </button>
        {touch && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto min-h-[44px] px-3 text-sm font-semibold text-blue-700"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );

  const optionList = (
    <ul
      className={portalPanel ? 'min-h-0 flex-1 overflow-y-auto py-1' : 'overflow-y-auto py-1'}
      style={portalPanel ? undefined : { maxHeight }}
      role="listbox"
    >
      {filtered.length === 0 ? (
        <li className="px-4 py-3 text-sm text-gray-500">
          No matches
        </li>
      ) : (
        filtered.map((opt) => (
          <li
            key={opt.id}
            role="option"
            aria-selected={selectedSet.has(opt.id)}
            onClick={() => toggle(opt.id)}
            className={`px-4 py-2.5 text-sm cursor-pointer flex items-center gap-2 ${touch ? 'min-h-[44px]' : ''} ${
              selectedSet.has(opt.id)
                ? 'bg-blue-50 text-blue-800'
                : 'hover:bg-gray-50 text-gray-800'
            }`}
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                selectedSet.has(opt.id)
                  ? 'bg-blue-600 border-blue-600'
                  : 'border-gray-300'
              }`}
            >
              {selectedSet.has(opt.id) && (
                <svg
                  className="w-3 h-3 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">{getOptionLabel(opt)}</span>
            {(opt.inactive ?? isEntityInactive(opt)) && <InactiveBadge />}
          </li>
        ))
      )}
    </ul>
  );

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 text-left border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex items-center justify-between gap-2 min-h-[42px] max-lg:min-h-[44px]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={
            selectedIds.length === 0 ? 'text-gray-500' : 'text-gray-800'
          }
        >
          {summary}
        </span>
        <svg
          className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && !portalPanel && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg"
            style={{ maxHeight: `calc(${maxHeight} + 4rem)` }}
          >
            {searchArea}
            {optionList}
          </div>
        </>
      )}

      {open &&
        portalPanel &&
        frame &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[199]" aria-hidden="true" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[200] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
              style={{ top: frame.top, left: frame.left, width: frame.width, maxHeight: frame.maxHeight }}
            >
              {searchArea}
              {optionList}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};

export default SearchableMultiSelect;
