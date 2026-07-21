import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../services/api/adminService';
import Modal from './Modal';
import Button from './Button';
import NoRidersForBrandNotice from './NoRidersForBrandNotice';

/** Short chip text for the status pill; the full sentence renders under the row. */
const REASON_LABELS: Record<string, string> = {
  user_inactive: 'Account inactive',
  not_checked_in: 'Not checked in',
  paused: 'On break',
  checked_in_elsewhere: 'At another branch',
  heartbeat_stale: 'App offline',
  location_unknown: 'No location',
  location_stale: 'Location stale',
  outside_premises: 'Outside premises',
  priority_locked: 'On a priority order',
  active_order_cap: 'At capacity',
  not_assigned_to_branch: 'Not at this branch',
};

function reasonChip(reasons: string[]): string {
  const first = reasons[0];
  if (!first) return 'Unavailable';
  return REASON_LABELS[first] ?? first.replace(/_/g, ' ');
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

interface AssignRiderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** "Assign rider", "Change rider", "Assign rider to group", … */
  title: string;
  /** Line under the title naming what is being assigned, e.g. "Order #001". */
  subject: string;
  /** Confirm button text — "Assign" or "Change". */
  confirmLabel: string;
  /** Order's brand; riders not linked to it are never offered. */
  brandId: number | null;
  brandName: string | null;
  /**
   * Order being assigned. Supplying it makes the list availability-aware: riders
   * who fail a dispatch check (not checked in, outside the branch premises, at
   * capacity) are shown greyed out with the reason instead of being offered and
   * then rejected on save.
   */
  orderId?: number | null;
  selectedRiderId: number | null;
  onSelectRider: (riderId: number | null) => void;
  onConfirm: () => void;
  isPending?: boolean;
}

/** Show the search box only once the list is long enough to need it. */
const SEARCH_THRESHOLD = 4;

/**
 * The one assign-rider modal, shared by Admin Orders and FOH Packing so the two
 * cannot drift apart. Owns the brand-scoped rider fetch: passing brandId is what
 * keeps the list to riders who can actually take the order (the backend rejects
 * the rest on save anyway).
 *
 * Riders render as a flat list rather than a dropdown: every rider carries a
 * status, a distance and possibly a full sentence explaining why they are
 * blocked, which a single-line <option> truncates into uselessness.
 */
const AssignRiderModal: React.FC<AssignRiderModalProps> = ({
  isOpen,
  onClose,
  title,
  subject,
  confirmLabel,
  brandId,
  brandName,
  orderId = null,
  selectedRiderId,
  onSelectRider,
  onConfirm,
  isPending = false,
}) => {
  const [search, setSearch] = useState('');

  const {
    data: riders,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['assign-rider-riders', brandId, orderId],
    queryFn: () => adminService.getRiders(brandId ?? undefined, orderId ?? undefined),
    enabled: isOpen,
    // Presence and position go stale in seconds, so never serve a cached verdict.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Available riders first; the rest keep their name order underneath.
  const rows = useMemo(
    () =>
      (riders ?? [])
        .map((r) => ({ ...r, blocked: r.is_eligible === false }))
        .sort((a, b) => Number(a.blocked) - Number(b.blocked)),
    [riders],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || (r.phone ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const hasRiders = rows.length > 0;
  const availableCount = rows.filter((r) => !r.blocked).length;
  // Never let a stale selection through: if the picked rider went unavailable on
  // the last refresh, the backend would reject the assign anyway.
  const selectedRow = rows.find((r) => r.id === selectedRiderId);
  const canConfirm = selectedRiderId != null && !selectedRow?.blocked && !isPending;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="large">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-500 dark:text-slate-400">{subject}</p>
        {hasRiders && orderId != null && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex-none text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 dark:text-red-400"
          >
            {isFetching ? 'Refreshing…' : '↻ Refresh availability'}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Loading riders…</p>
      ) : hasRiders ? (
        <>
          {orderId != null && (
            <div
              className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                availableCount === 0
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300'
                  : 'bg-gray-50 text-gray-600 dark:bg-slate-700/40 dark:text-slate-300'
              }`}
            >
              {availableCount === 0 ? (
                <>
                  <span className="font-semibold">No rider is available right now.</span> A
                  rider becomes available once they are checked in at this branch and inside
                  the branch premises.
                </>
              ) : (
                <>
                  <span className="font-semibold">{availableCount}</span> of {rows.length}{' '}
                  {rows.length === 1 ? 'rider is' : 'riders are'} available for this order.
                </>
              )}
            </div>
          )}

          {rows.length >= SEARCH_THRESHOLD && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search riders by name or phone…"
              aria-label="Search riders"
              className="w-full mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-red-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
          )}

          <ul className="max-h-[45vh] overflow-y-auto -mx-1 px-1 space-y-2 mb-4">
            {visibleRows.length === 0 && (
              <li className="py-6 text-center text-sm text-gray-500 dark:text-slate-400">
                No rider matches “{search.trim()}”.
              </li>
            )}
            {visibleRows.map((r) => {
              const selected = r.id === selectedRiderId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={r.blocked}
                    aria-pressed={selected}
                    onClick={() => onSelectRider(selected ? null : r.id)}
                    className={`w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                      r.blocked
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-70 dark:border-slate-700 dark:bg-slate-800/60'
                        : selected
                          ? 'border-red-500 bg-red-50 ring-2 ring-red-500/30 dark:border-red-500 dark:bg-red-900/20'
                          : 'border-gray-200 bg-white hover:border-red-300 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700/40 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`flex-none w-10 h-10 rounded-full grid place-items-center text-sm font-semibold ${
                        r.blocked
                          ? 'bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      }`}
                      aria-hidden="true"
                    >
                      {initials(r.name)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-gray-900 dark:text-slate-100 truncate">
                          {r.name}
                        </span>
                        {r.is_eligible != null && (
                          <span
                            className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              r.blocked
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            }`}
                          >
                            {r.blocked ? reasonChip(r.ineligible_reasons) : 'Available'}
                          </span>
                        )}
                      </span>

                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-slate-400">
                        {(r.rating_count ?? 0) > 0 && r.rating_average != null && (
                          <span>
                            ★ {r.rating_average.toFixed(1)} ({r.rating_count})
                          </span>
                        )}
                        {r.phone && <span>{r.phone}</span>}
                        {r.distance_m != null && (
                          <span>{formatDistance(r.distance_m)} from branch</span>
                        )}
                      </span>

                      {/* The whole reason, wrapped — a native tooltip hid this. */}
                      {r.blocked && r.ineligible_detail && (
                        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                          {r.ineligible_detail}
                        </span>
                      )}
                    </span>

                    {selected && !r.blocked && (
                      <span className="flex-none text-red-600 dark:text-red-400" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <NoRidersForBrandNotice brandName={brandName} onNavigate={onClose} />
      )}

      <div className="flex gap-2 justify-end border-t border-gray-200 pt-3 dark:border-slate-600">
        <Button variant="outline" onClick={onClose}>
          {!hasRiders && !isLoading ? 'Close' : 'Cancel'}
        </Button>
        {/* Nothing to assign with no riders — the notice above is the only action. */}
        {(hasRiders || isLoading) && (
          <Button
            variant="primary"
            disabled={!canConfirm}
            isLoading={isPending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default AssignRiderModal;
