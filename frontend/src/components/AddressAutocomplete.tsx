import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import DeliveryPinMap from './DeliveryPinMap';
import {
  AddressSuggestion,
  ResolvedPlace,
  createPlacesSession,
  placesConfigured,
} from '../utils/googlePlaces';

const MIN_CHARS = 3;

interface AddressAutocompleteProps {
  value: string;
  /** Free-text edits (typing, on-screen keyboard). */
  onChange: (address: string) => void;
  /** A suggestion was picked and its coordinates fetched. */
  onPick: (place: ResolvedPlace) => void;
  /** The place currently pinned to this address, if any. */
  picked: ResolvedPlace | null;
  /** Fired when the SDK can't be used, so callers can drop the pin requirement. */
  onUnavailable?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  onPick,
  picked,
  onUnavailable,
  placeholder = 'Start typing the address, then pick a suggestion',
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [failed, setFailed] = useState(!placesConfigured);
  const containerRef = useRef<HTMLDivElement>(null);
  const session = useRef(createPlacesSession());

  const debouncedQuery = useDebouncedValue(query, 300);
  const canSearch = !failed && !disabled;
  const enabled = canSearch && open && debouncedQuery.trim().length >= MIN_CHARS;

  const { data: suggestions = [], isFetching, isError } = useQuery({
    queryKey: ['places-autocomplete', debouncedQuery.trim()],
    queryFn: () => session.current.suggest(debouncedQuery.trim()),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!isError) return;
    setFailed(true);
    setOpen(false);
    onUnavailable?.();
  }, [isError, onUnavailable]);

  useEffect(() => {
    if (!placesConfigured) onUnavailable?.();
  }, [onUnavailable]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Tapping the docked on-screen keyboard is still "inside" this field.
      if (target?.closest?.('[data-onscreen-keyboard]')) return;
      if (containerRef.current && !containerRef.current.contains(target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const select = async (suggestion: AddressSuggestion) => {
    setOpen(false);
    setResolving(true);
    try {
      const place = await suggestion.resolve();
      onChange(place.address);
      onPick(place);
    } catch {
      // Coordinates failed; keep the readable text so the order can still go out.
      onChange(suggestion.description);
    } finally {
      setResolving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[activeIndex];
      if (s) void select(s);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // The pin survives edits (the cashier often appends a house or flat number),
  // but we say so out loud when the text no longer matches what Google returned.
  const editedAfterPick = useMemo(
    () => Boolean(picked && value.trim() && value.trim() !== picked.address.trim()),
    [picked, value],
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          if (canSearch) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={failed ? 'Street, area, city' : placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full px-4 py-2.5 border border-foodies-border rounded-xl bg-foodies-surface text-foodies-textPrimary placeholder-foodies-textSecondary focus:ring-2 focus:ring-foodies-primary/50 focus:border-foodies-primary"
      />

      {open && debouncedQuery.trim().length >= MIN_CHARS && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {isFetching && suggestions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">Searching…</p>
          ) : suggestions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matching addresses</p>
          ) : (
            <ul className="py-1">
              {suggestions.map((s, i) => (
                <li key={s.placeId}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void select(s);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm ${
                      i === activeIndex ? 'bg-blue-50 dark:bg-slate-700' : ''
                    }`}
                  >
                    <span className="block font-medium text-gray-800 dark:text-slate-100">{s.primary}</span>
                    {s.secondary && (
                      <span className="block text-xs text-gray-500 dark:text-slate-400">{s.secondary}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resolving ? (
        <p className="mt-1 text-xs text-foodies-textSecondary">Fetching coordinates…</p>
      ) : failed ? (
        <p className="mt-1 text-xs text-foodies-textSecondary">
          Address search unavailable — the order will be sent without map coordinates.
        </p>
      ) : picked ? (
        <>
          <p className="mt-1 text-xs text-green-700">
            ✓ Location pinned ({picked.latitude.toFixed(6)}, {picked.longitude.toFixed(6)})
            {editedAfterPick && (
              <span className="text-amber-600"> · address edited after selection; pin is from the picked place</span>
            )}
          </p>
          <DeliveryPinMap
            latitude={picked.latitude}
            longitude={picked.longitude}
            onMove={({ lat, lng }) => onPick({ ...picked, latitude: lat, longitude: lng })}
          />
        </>
      ) : (
        <p className="mt-1 text-xs text-amber-600">
          Pick an address from the suggestions so the rider gets exact coordinates.
        </p>
      )}
    </div>
  );
};

export default AddressAutocomplete;
