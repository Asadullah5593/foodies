import React, { useState, useRef, useMemo } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../hooks/useTypeaheadSuggestions';
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

  const summary =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? getOptionLabel(selectedOptions[0])
        : `${selectedOptions.length} selected`;

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 text-left border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex items-center justify-between gap-2 min-h-[42px]"
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

      {open && (
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
            <div className="p-2 border-b border-gray-100 sticky top-0 bg-white rounded-t-lg">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to filter..."
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
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
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Select all in list
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear selection
                </button>
              </div>
            </div>
            <ul
              className="overflow-y-auto py-1"
              style={{ maxHeight }}
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
                    className={`px-4 py-2.5 text-sm cursor-pointer flex items-center gap-2 ${
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
          </div>
        </>
      )}
    </div>
  );
};

export default SearchableMultiSelect;
