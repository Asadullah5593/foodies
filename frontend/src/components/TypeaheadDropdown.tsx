import { useEffect, useRef } from 'react';
import type { TypeaheadOption } from '../hooks/useTypeaheadSuggestions';

export default function TypeaheadDropdown({
  open,
  suggestions,
  activeIndex,
  onHoverIndex,
  onSelect,
  onClose,
}: {
  open: boolean;
  suggestions: TypeaheadOption[];
  activeIndex: number;
  onHoverIndex: (idx: number) => void;
  onSelect: (opt: TypeaheadOption) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || suggestions.length === 0) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [open, suggestions.length, onClose]);

  if (!open || suggestions.length === 0) return null;
  return (
    <div
      ref={rootRef}
      className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg overflow-hidden"
      role="listbox"
    >
      <ul className="max-h-56 overflow-y-auto py-1">
        {suggestions.map((opt, idx) => (
          <li key={opt.id} role="option" aria-selected={idx === activeIndex}>
            <button
              type="button"
              onMouseEnter={() => onHoverIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(opt);
              }}
            >
              <span
                className={`flex w-full px-3 py-2 text-left text-sm truncate ${
                  idx === activeIndex
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 font-medium'
                    : 'text-gray-800 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
