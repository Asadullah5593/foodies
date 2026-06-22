import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../services/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from './TypeaheadDropdown';

export type CustomerOption = { id: number; name: string | null; phone: string };

interface CustomerSearchSelectProps {
  value: { name: string; phone: string };
  onChange: (customer: { name: string; phone: string }) => void;
  onAddClick: (query?: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const CustomerSearchSelect: React.FC<CustomerSearchSelectProps> = ({
  value,
  onChange,
  onAddClick,
  placeholder = 'Search customer by name or phone...',
  className = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: adminService.getCustomers,
  });

  const list = useMemo(() => {
    const raw = (customers as Array<{ id: number; name: string | null; phone: string }>) ?? [];
    return raw.map((c) => ({ id: c.id, name: c.name ?? '', phone: c.phone }));
  }, [customers]);

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return list;
    const q = debouncedSearch.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return list.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.phone && qDigits.length > 0 && c.phone.replace(/\D/g, '').includes(qDigits)),
    );
  }, [list, debouncedSearch]);

  const typeaheadOptions = useMemo(
    () =>
      list.map((c) => ({
        id: String(c.id),
        label: (c.name ?? '').trim() || '—',
      })),
    [list],
  );
  const { open: sugOpen, setOpen: setSugOpen, suggestions, activeIndex, setActiveIndex } =
    useTypeaheadSuggestions({ query: debouncedSearch, options: typeaheadOptions, minChars: 2, limit: 8 });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasSelection = Boolean(value.name?.trim() && value.phone?.trim());
  const displayLabel = hasSelection
    ? `${value.name!.trim()} (${value.phone})`
    : '';

  const inputValue = open ? search : displayLabel;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSearch(v);
    setOpen(true);
    setSugOpen(true);
    if (hasSelection && v !== displayLabel) {
      onChange({ name: '', phone: '' });
    }
  };

  const handleFocus = () => {
    setOpen(true);
    if (hasSelection) setSearch('');
  };

  const handleSelect = (c: { id: number; name: string; phone: string }) => {
    onChange({ name: c.name ?? '', phone: c.phone });
    setSearch('');
    setOpen(false);
    setSugOpen(false);
    inputRef.current?.blur();
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
        const c = list.find((x) => x.id === id);
        if (c) handleSelect(c);
      }
    } else if (e.key === 'Escape') {
      setSugOpen(false);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex gap-1">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={onKeyDownSearch}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className={`flex-1 px-3 py-2 border rounded-lg bg-white min-h-[42px] ${
            open ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''} focus:outline-none`}
        />
        <button
          type="button"
          onClick={() => onAddClick(open ? search : '')}
          disabled={disabled}
          title="Add new customer"
          className="flex-shrink-0 w-10 h-[42px] flex items-center justify-center border border-gray-300 rounded-lg bg-white hover:bg-gray-50 hover:border-blue-400 text-gray-600 hover:text-blue-600 font-bold text-lg disabled:opacity-50"
        >
          +
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 flex flex-col overflow-hidden">
          <div className="relative">
            <TypeaheadDropdown
              open={sugOpen && debouncedSearch.trim().length >= 2}
              suggestions={suggestions}
              activeIndex={activeIndex}
              onHoverIndex={setActiveIndex}
              onSelect={(s) => {
                const id = parseInt(s.id, 10);
                const c = list.find((x) => x.id === id);
                if (c) handleSelect(c);
              }}
              onClose={() => setSugOpen(false)}
            />
          </div>
          <ul className="overflow-y-auto flex-1 py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No customers found</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(c);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                  >
                    <span className="font-medium text-gray-800">{c.name || '—'}</span>
                    <span className="text-gray-500 ml-1">({c.phone})</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CustomerSearchSelect;
