import React from 'react';
import { useQuery } from '@tanstack/react-query';

export interface SortOrderMap {
  taken: number[];
  suggested: number;
}

/** Collapse [1,2,3,5,8,9] to "1-3, 5, 8-9" so a long menu's hint stays readable. */
export const formatTakenRanges = (taken: number[]): string => {
  const sorted = [...new Set(taken)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const n of sorted) {
    if (start === null) {
      start = n;
    } else if (prev !== null && n !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = n;
    }
    prev = n;
  }
  if (start !== null && prev !== null) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
};

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** null while the scope is unknown (no brand/category picked yet) — the hint is skipped. */
  scopeKey: string | null;
  fetchMap: () => Promise<SortOrderMap>;
  /**
   * The number this row already holds, when editing. It comes back from the
   * server as taken, but the row is allowed to keep it, so it is filtered out.
   */
  ownSortOrder?: number | null;
  /** Server-side 409 text, shown in place of the hint. */
  error?: string | null;
  label?: string;
}

/**
 * Numbers-only sort order input with a "what's already used" hint.
 *
 * 0 (or empty) means not numbered yet, which sorts last — so the field is
 * genuinely optional and an empty box is never an error.
 */
const SortOrderField: React.FC<Props> = ({
  value,
  onChange,
  scopeKey,
  fetchMap,
  ownSortOrder,
  error,
  label = 'Sort order',
}) => {
  const { data, isLoading } = useQuery<SortOrderMap>({
    queryKey: ['sort-order-map', scopeKey],
    queryFn: fetchMap,
    enabled: scopeKey != null,
    // The hint is only useful if it reflects what other tabs/users just saved.
    staleTime: 0,
  });

  const own = ownSortOrder != null && ownSortOrder > 0 ? ownSortOrder : null;
  const taken = React.useMemo(
    () => (data?.taken ?? []).filter((n) => n !== own),
    [data?.taken, own],
  );

  const entered = value.trim() === '' ? null : Number(value);
  const isDuplicate = entered != null && entered > 0 && taken.includes(entered);
  // Server suggests one past the highest overall; if that number belonged to
  // this row it is still the right thing to offer back.
  const suggested = data?.suggested ?? 1;

  let hint: React.ReactNode;
  if (error) {
    hint = <span className="text-red-600">{error}</span>;
  } else if (scopeKey == null) {
    hint = <span className="text-gray-400">Pick a brand and category to see which numbers are free.</span>;
  } else if (isLoading) {
    hint = <span className="text-gray-400">Checking which numbers are free…</span>;
  } else if (isDuplicate) {
    hint = (
      <span className="text-red-600">
        {entered} is already taken. Next available: {suggested}.
      </span>
    );
  } else if (taken.length === 0) {
    hint = <span className="text-gray-500">Nothing numbered yet · suggested: {suggested}</span>;
  } else {
    hint = (
      <span className="text-gray-500">
        {formatTakenRanges(taken)} taken · suggested: {suggested}
      </span>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        // Numbers only: type="number" still admits these, and a decimal or
        // exponent here would be rejected by the server as a whole-number field.
        onKeyDown={(e) => {
          if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault();
        }}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="Leave empty to keep it unsorted"
        aria-invalid={isDuplicate || !!error}
        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
          isDuplicate || error ? 'border-red-400' : 'border-gray-300'
        }`}
      />
      <div className="mt-1 flex items-center gap-2">
        <p className="text-xs">{hint}</p>
        {scopeKey != null && !isLoading && String(suggested) !== value.trim() && (
          <button
            type="button"
            onClick={() => onChange(String(suggested))}
            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
          >
            Use {suggested}
          </button>
        )}
      </div>
    </div>
  );
};

export default SortOrderField;
