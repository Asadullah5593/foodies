import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from './TypeaheadDropdown';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Rendered but not selectable (e.g. a rider who fails an availability check). */
  disabled?: boolean;
  /** Tooltip explaining why the option is disabled. */
  title?: string;
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
}

const baseTriggerClass =
  'w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 text-left flex items-center justify-between gap-2';

/**
 * Searchable dropdown for filter bars and anywhere long option lists need search.
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
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? (value ? value : ''),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, debouncedSearch]);

  const typeaheadOptions = useMemo(
    () => options.map((o) => ({ id: o.value, label: o.label })),
    [options],
  );
  const { open: sugOpen, setOpen: setSugOpen, suggestions, activeIndex, setActiveIndex } =
    useTypeaheadSuggestions({ query: debouncedSearch, options: typeaheadOptions, minChars: 2, limit: 8 });

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
        setSugOpen(false);
      }
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

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1" htmlFor={id}>
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`${baseTriggerClass} ${minWidth} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-gray-500 dark:text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute z-[200] mt-1 w-full min-w-[200px] rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg overflow-hidden"
          role="listbox"
        >
          <div className="p-2 border-b border-gray-100 dark:border-slate-600">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
              autoFocus
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
          <ul className="max-h-60 overflow-y-auto py-1">
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
                  className={`px-3 py-2 text-sm truncate ${
                    opt.disabled
                      ? 'cursor-not-allowed text-gray-400 dark:text-slate-500'
                      : opt.value === value
                        ? 'cursor-pointer bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 font-medium'
                        : 'cursor-pointer text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
