import { useEffect, useMemo, useState } from 'react';

export type TypeaheadOption = {
  id: string;
  label: string;
  /**
   * The record behind this suggestion is deactivated. Carried through so the
   * suggestion overlay marks it exactly like the list underneath — otherwise
   * typing two characters hides the very status the list was showing.
   */
  inactive?: boolean;
};

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export function useTypeaheadSuggestions({
  query,
  options,
  minChars = 2,
  limit = 8,
}: {
  query: string;
  options: TypeaheadOption[];
  minChars?: number;
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    const q = normalize(query);
    if (q.length < minChars) return [];
    const startsWith = options.filter((o) => normalize(o.label).startsWith(q));
    return startsWith.slice(0, limit);
  }, [query, options, minChars, limit]);

  useEffect(() => {
    setActiveIndex(0);
    setOpen(suggestions.length > 0);
  }, [query, suggestions.length]);

  return {
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    suggestions,
  };
}

