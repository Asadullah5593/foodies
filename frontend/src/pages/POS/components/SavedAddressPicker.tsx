import React from 'react';
import { ResolvedPlace } from '../../../utils/googlePlaces';

export interface SavedAddress {
  id: number;
  label: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  times_used: number;
  last_used_at: string | null;
}

/** "today", "yesterday", "3 days ago", "12 Aug" — enough to ask "still there?". */
function lastUsedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Where this number has had deliveries before.
 *
 * Picking one restores the ADDRESS AND ITS COORDINATES together — the order
 * taker never sees the difference, but a delivery order is refused without a
 * point, the fee is priced by distance from it, and the rider navigates to it.
 * Handing back the text alone would look like it worked and quietly misprice
 * the order.
 */
const SavedAddressPicker: React.FC<{
  addresses: SavedAddress[];
  selectedId: number | null;
  onPick: (address: SavedAddress) => void;
  onUseNew: () => void;
}> = ({ addresses, selectedId, onPick, onUseNew }) => {
  if (addresses.length === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-foodies-border bg-foodies-surfaceAlt/60 p-2 dark:border-slate-600 dark:bg-slate-700/40">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foodies-textSecondary dark:text-slate-300">
          Delivered here before ({addresses.length})
        </span>
        {selectedId != null && (
          <button
            type="button"
            onClick={onUseNew}
            className="text-xs font-semibold text-foodies-primary hover:underline"
          >
            Use a different address
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {addresses.map((a) => {
          const picked = a.id === selectedId;
          const when = lastUsedLabel(a.last_used_at);
          return (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() => onPick(a)}
                className={`w-full rounded-md border px-2.5 py-2 text-left text-sm transition ${
                  picked
                    ? 'border-foodies-primary bg-foodies-primary/10 text-foodies-textPrimary'
                    : 'border-transparent bg-white text-foodies-textPrimary hover:border-foodies-border dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                <span className="block truncate font-medium">
                  {a.label ? `${a.label} · ` : ''}
                  {a.address}
                </span>
                {(when || a.times_used > 1) && (
                  <span className="mt-0.5 block text-[11px] text-foodies-textSecondary dark:text-slate-400">
                    {when ? `Last used ${when}` : ''}
                    {when && a.times_used > 1 ? ' · ' : ''}
                    {a.times_used > 1 ? `${a.times_used} orders` : ''}
                  </span>
                )}
                {a.notes && (
                  <span className="mt-0.5 block text-[11px] italic text-foodies-textSecondary dark:text-slate-400">
                    {a.notes}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** The place a saved address stands for, so the order carries its point. */
export function placeFromSavedAddress(a: SavedAddress): ResolvedPlace | null {
  if (a.latitude == null || a.longitude == null) return null;
  return {
    placeId: `saved:${a.id}`,
    address: a.address,
    latitude: a.latitude,
    longitude: a.longitude,
  };
}

export default SavedAddressPicker;
